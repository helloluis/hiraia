/**
 * Degradation-ladder monitor (PRD §14.2.1). Decides which rung the app is on from the browser's online flag,
 * measured response times/failures, the teacher's Data Saver switch, and a read-only reason set by the session.
 * Server trouble looks like bad signal (RES-12): 5xx / network failures push us to rung 3 for a while.
 */
export type Rung = 'full' | 'low' | 'offline' | 'readonly';

export interface NetworkState {
  rung: Rung;
  online: boolean;
  slow: boolean;
  dataSaver: boolean;
  serverTrouble: boolean;
  readOnlyReason: 'session_lapsed' | 'storage_full' | 'update_required' | null;
  /** Rough bytes transferred this week (RES-10), counted from response Content-Length when present. */
  bytesThisWeek: number;
}

type Listener = (s: NetworkState) => void;

const SLOW_MS = 4000;
const TROUBLE_TTL_MS = 30_000;
const USAGE_KEY = 'tala.data-usage';

function readUsage(): { week: string; bytes: number } {
  try {
    const v = JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? 'null');
    if (v && typeof v.bytes === 'number' && typeof v.week === 'string') return v;
  } catch {
    /* ignore */
  }
  return { week: '', bytes: 0 };
}

function weekKey(d = new Date()): string {
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  return monday.toISOString().slice(0, 10);
}

class NetworkMonitor {
  private listeners = new Set<Listener>();
  private slowUntil = 0;
  private troubleUntil = 0;
  private dataSaver = false;
  private readOnlyReason: NetworkState['readOnlyReason'] = null;
  private usage = { week: '', bytes: 0 };
  private initialised = false;

  private init() {
    if (this.initialised || typeof window === 'undefined') return;
    this.initialised = true;
    this.usage = readUsage();
    window.addEventListener('online', () => this.emit());
    window.addEventListener('offline', () => this.emit());
  }

  state(): NetworkState {
    this.init();
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    const now = Date.now();
    const serverTrouble = this.troubleUntil > now;
    const slow = this.slowUntil > now || this.dataSaver;
    const rung: Rung = this.readOnlyReason
      ? 'readonly'
      : !online || serverTrouble
        ? 'offline'
        : slow
          ? 'low'
          : 'full';
    const week = weekKey();
    const bytesThisWeek = this.usage.week === week ? this.usage.bytes : 0;
    return {
      rung,
      online,
      slow,
      dataSaver: this.dataSaver,
      serverTrouble,
      readOnlyReason: this.readOnlyReason,
      bytesThisWeek,
    };
  }

  subscribe(l: Listener): () => void {
    this.init();
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  setDataSaver(on: boolean) {
    this.dataSaver = on;
    this.emit();
  }
  setReadOnly(reason: NetworkState['readOnlyReason']) {
    this.readOnlyReason = reason;
    this.emit();
  }
  /** Called by the sync loop when the server responds normally again. */
  noteHealthy() {
    if (this.troubleUntil) {
      this.troubleUntil = 0;
      this.emit();
    }
  }
  noteTrouble() {
    this.troubleUntil = Date.now() + TROUBLE_TTL_MS;
    this.emit();
  }

  private addBytes(n: number) {
    const week = weekKey();
    if (this.usage.week !== week) this.usage = { week, bytes: 0 };
    this.usage.bytes += n;
    try {
      window.localStorage.setItem(USAGE_KEY, JSON.stringify(this.usage));
    } catch {
      /* ignore */
    }
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    this.init();
    const started = Date.now();
    try {
      const res = await globalThis.fetch(input, init);
      const took = Date.now() - started;
      if (took > SLOW_MS) this.slowUntil = Date.now() + 60_000;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len) this.addBytes(len);
      if (init?.body && typeof init.body === 'string') this.addBytes(init.body.length);
      if (res.status >= 500) this.noteTrouble();
      else this.noteHealthy();
      this.emit();
      return res;
    } catch (err) {
      if (!init?.signal?.aborted) this.noteTrouble();
      throw err;
    }
  };
}

export const networkMonitor = new NetworkMonitor();
