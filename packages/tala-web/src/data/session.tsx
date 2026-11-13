'use client';
/**
 * Session: the signed-in user, the per-account sync engine on IndexedDB, the background sync loop and the
 * degradation rung. Saved data first (RES-1): a cached user and local records render before any network call.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSyncEngine } from '@hiraia/tala-core/sync';
import { TalaApiError, type ClientConfig, type Lang, type SyncEngine, type SyncStatus, type User } from '@hiraia/tala-core/contracts';
import { createIdbCache, createMemoryCache, type KvCache } from './cache';
import { getClient } from './client';
import { createIdbStore, deleteDatabase } from './idb-store';
import { newId } from './ids';
import { networkMonitor, type NetworkState } from './network';

export type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

export interface SessionValue {
  status: SessionStatus;
  user: User | null;
  engine: SyncEngine | null;
  cache: KvCache;
  config: ClientConfig | null;
  sync: SyncStatus;
  network: NetworkState;
  /** The server no longer accepts this session; saved data stays readable (rung 4). */
  sessionLapsed: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string, uiLanguage: Lang): Promise<void>;
  signOut(): Promise<void>;
  refreshUser(): Promise<User | null>;
  syncNow(): Promise<void>;
  setDataSaver(on: boolean): void;
}

const Ctx = createContext<SessionValue | null>(null);
const USER_KEY = 'auth.user';
const CONFIG_KEY = 'client.config';
const DEVICE_KEY = 'tala.device-id';
const IDLE_SYNC_MS = 30_000;
const CHANGE_DEBOUNCE_MS = 1500;

function deviceId(): string {
  try {
    let v = window.localStorage.getItem(DEVICE_KEY);
    if (!v) {
      v = newId();
      window.localStorage.setItem(DEVICE_KEY, v);
    }
    return v;
  } catch {
    return newId();
  }
}

function dbName(userId: string) {
  return `tala-${userId}`;
}

export function SessionProvider({ children, cacheImpl }: { children: ReactNode; cacheImpl?: KvCache }) {
  // Server render has no IndexedDB; nothing reads the cache there (effects do not run), so a throwaway memory cache is fine.
  const cache = useMemo(() => cacheImpl ?? (typeof indexedDB === 'undefined' ? createMemoryCache() : createIdbCache()), [cacheImpl]);
  const client = getClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: 'idle', pending: 0, conflicts: 0, lastSyncedAt: null });
  // First client render must match the server (no banner); the real rung arrives in an effect.
  const [network, setNetwork] = useState<NetworkState>({ rung: 'full', online: true, slow: false, dataSaver: false, serverTrouble: false, readOnlyReason: null, bytesThisWeek: 0 });
  const [sessionLapsed, setSessionLapsed] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    setNetwork(networkMonitor.state());
    return networkMonitor.subscribe(setNetwork);
  }, []);

  const attach = useCallback((u: User) => {
    const store = createIdbStore({ name: dbName(u.id) });
    const eng = createSyncEngine({ store, transport: client.syncTransport, deviceId: deviceId(), now: () => new Date(), newId });
    engineRef.current = eng;
    setEngine(eng);
    setUser(u);
    setStatus('signedIn');
    return eng;
  }, [client]);

  const refreshStatus = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setSync(await eng.status());
  }, []);

  const runSync = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSync(s => ({ ...s, state: 'syncing' }));
    const weeksBack = config?.offline.windowWeeksBack ?? 4;
    const weeksAhead = config?.offline.windowWeeksAhead ?? 8;
    const today = new Date();
    const from = new Date(today.getTime() - weeksBack * 7 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + weeksAhead * 7 * 86400_000).toISOString().slice(0, 10);
    const report = await eng.sync({ windowFrom: from, windowTo: to });
    if (report.error === 'unauthenticated') {
      setSessionLapsed(true);
      networkMonitor.setReadOnly('session_lapsed');
    } else if (report.ok) {
      failures.current = 0;
      if (sessionLapsed) {
        setSessionLapsed(false);
        networkMonitor.setReadOnly(null);
      }
    } else {
      failures.current += 1;
    }
    await refreshStatus();
    // Next attempt: idle interval when healthy, exponential backoff (capped at 60 s) after trouble (RES-4).
    const delay = report.ok ? IDLE_SYNC_MS : Math.min(60_000, 1000 * 2 ** failures.current) * (0.5 + Math.random() / 2);
    timer.current = setTimeout(() => void runSync(), delay);
  }, [config, refreshStatus, sessionLapsed]);

  // Boot: cached user → engine → background verification.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cachedConfig = await cache.get<ClientConfig>(CONFIG_KEY);
      if (cachedConfig && !cancelled) setConfig(cachedConfig);
      const cached = await cache.get<User>(USER_KEY);
      if (cancelled) return;
      if (cached) attach(cached);
      else setStatus('signedOut');
      client
        .call('config.get')
        .then(c => {
          if (cancelled) return;
          setConfig(c);
          void cache.set(CONFIG_KEY, c);
        })
        .catch(() => {});
      if (cached) {
        client
          .call('auth.me')
          .then(r => {
            if (cancelled) return;
            setUser(r.user);
            void cache.set(USER_KEY, r.user);
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            if (err instanceof TalaApiError && err.code === 'unauthenticated') {
              setSessionLapsed(true);
              networkMonitor.setReadOnly('session_lapsed');
            }
          });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync loop: start on engine, re-run on local change (debounced) and when the browser comes back online.
  useEffect(() => {
    if (!engine) return;
    void runSync();
    const unsub = engine.subscribe(() => {
      void refreshStatus();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void runSync(), CHANGE_DEBOUNCE_MS);
    });
    const onOnline = () => void runSync();
    window.addEventListener('online', onOnline);
    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [engine, runSync, refreshStatus]);

  const finishAuth = useCallback(
    async (u: User) => {
      const previous = await cache.get<User>(USER_KEY);
      if (previous && previous.id !== u.id) await deleteDatabase(dbName(previous.id)).catch(() => {});
      await cache.set(USER_KEY, u);
      setSessionLapsed(false);
      networkMonitor.setReadOnly(null);
      attach(u);
    },
    [attach, cache],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await client.call('auth.login', { body: { email, password, deviceLabel: deviceLabel() } });
      await finishAuth(r.user);
    },
    [client, finishAuth],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string, uiLanguage: Lang) => {
      const r = await client.call('auth.register', { body: { email, password, displayName, uiLanguage, deviceLabel: deviceLabel() } });
      await finishAuth(r.user);
    },
    [client, finishAuth],
  );

  const signOut = useCallback(async () => {
    const eng = engineRef.current;
    if (eng && networkMonitor.state().online) {
      try {
        await eng.sync();
      } catch {
        /* unsent work is kept with the account's database until the next sign-in */
      }
    }
    try {
      await client.call('auth.logout');
    } catch {
      /* offline: the cookie dies with the session on the server side later */
    }
    if (timer.current) clearTimeout(timer.current);
    engineRef.current = null;
    setEngine(null);
    const u = user;
    setUser(null);
    setStatus('signedOut');
    setSessionLapsed(false);
    networkMonitor.setReadOnly(null);
    await cache.remove(USER_KEY);
    if (u) await deleteDatabase(dbName(u.id)).catch(() => {});
  }, [cache, client, user]);

  const refreshUser = useCallback(async () => {
    try {
      const r = await client.call('auth.me');
      setUser(r.user);
      await cache.set(USER_KEY, r.user);
      return r.user;
    } catch {
      return null;
    }
  }, [cache, client]);

  const syncNow = useCallback(async () => {
    await runSync();
  }, [runSync]);

  const setDataSaver = useCallback((on: boolean) => networkMonitor.setDataSaver(on), []);

  const value = useMemo<SessionValue>(
    () => ({ status, user, engine, cache, config, sync, network, sessionLapsed, signIn, register, signOut, refreshUser, syncNow, setDataSaver }),
    [status, user, engine, cache, config, sync, network, sessionLapsed, signIn, register, signOut, refreshUser, syncNow, setDataSaver],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web';
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /CrOS/i.test(ua) ? 'ChromeOS' : 'Web';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`.slice(0, 80);
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Engine for signed-in screens. Throws if used before sign-in; guard with status first. */
export function useEngine(): SyncEngine {
  const { engine } = useSession();
  if (!engine) throw new Error('No sync engine: not signed in');
  return engine;
}
