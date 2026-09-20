/**
 * In-app updates, phase 1: the app is SIDELOADED (no Play Store), so nothing tells an
 * installed phone that a newer APK exists. This store asks the website's manifest
 * (`/api/app/manifest`, derived from packages/web/src/config/download.ts — the same source
 * of truth the landing page renders) and drives the "Update available!" ribbon on the feed:
 *
 *   idle ──check──▶ checking ──newer──▶ available ──tap──▶ downloading ──verified──▶ ready ──tap──▶ (Android installer)
 *                      │                   │  ✕                 │ error                  │ error
 *                      └─same/older/error──┘  ▼                 ▼                        ▼
 *                           (back to idle)  snoozed           failed ◀──────────────────┘
 *                                          (24 h)              │ tap = retry (download again, or re-open the installer)
 *
 * WHEN IT CHECKS (and when it must not):
 *   • once per launch, AFTER the feed is hydrated and the title sheet is gone — the fetch
 *     is deferred behind InteractionManager + a short delay, so it never competes with the
 *     first paint (`startUpdateChecks`, wired in app/_layout.tsx);
 *   • again at most every RECHECK_MS (6 h) while the app is foregrounded: on every
 *     AppState 'active' transition, and on a 6 h tick for a tablet that never leaves the
 *     foreground — all gated on `lastCheckedAt` (a check that never reached the manifest
 *     does not count; it is retried after FAILED_RETRY_MS instead, see `checkDue`);
 *   • NEVER while a model download is in flight (engineStore.readyStage in connect /
 *     download / verify): the 1.27 GB base model is the transfer that matters on a metered
 *     link, and a manifest fetch is the wrong thing to race it with. A launch check that
 *     hits the gate is deferred until the stage clears (one-shot subscription), not lost.
 *   • never from a state that already owns the manifest (checking / downloading / ready).
 *
 * WHAT IT DOWNLOADS WITH: `ensureRemoteAsset` — the exact chunked-Range, resume-from-disk,
 * size + MD5 gated path the model files use, pointed at the CACHE directory. That is why
 * the manifest carries an md5 next to the landing page's sha256. On launch any cached APK
 * whose versionCode is not newer than the running app is deleted (cache hygiene).
 *
 * NOTHING HERE THROWS TO A CALLER. The ribbon is a courtesy; a failed check is logged and
 * the feed carries on. Only the download / install steps surface a `failed` state, and
 * only because the reader asked for them.
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import {
  cacheDirectory,
  deleteAsync,
  getContentUriAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import { AppState, InteractionManager, Platform } from 'react-native';
import { create } from 'zustand';

import { getSetting, setSetting } from '../db/repo';
import { ensureRemoteAsset } from '../engine/modelDownload';
import { errorCategory, track } from '../telemetry';
import { useEngineStore, type ReadyStage } from './engineStore';
import { useAssetUpdateStore } from './assetUpdateStore';

/** Override at build time for staging. Must be https. */
export const MANIFEST_URL =
  process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL || 'https://hiraia.org/api/app/manifest';

/** The manifest fetch's hard timeout — a captive portal or a dead link must not hang the store. */
const FETCH_TIMEOUT_MS = 8_000;
/** How long the ✕ hides the banner: a WEEK — dismissing is a real answer, not a nag reset.
 * Keyed to the versionCode it hid, so a NEWER release still shows at once. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum spacing between two checks while the app stays in use. */
const RECHECK_MS = 6 * 60 * 60 * 1000;
/**
 * A check that never reached the manifest (offline, timeout, 5xx) does not count as a
 * check: this app is launched offline far more often than not, and a 6 h lockout would
 * hide an update from a reader who reaches Wi-Fi ten minutes later. The failure is still
 * backed off so a phone with no data does not fetch on every foreground transition.
 */
const FAILED_RETRY_MS = 15 * 60 * 1000;
/** Launch check: after interactions settle, wait this long more so the first cards paint first. */
const LAUNCH_DELAY_MS = 2_500;
/** Where APKs land. Cache, not documents: the installer hand-off is the file's whole life. */
const UPDATES_DIR = `${cacheDirectory}updates/`;
/** `hiraia-v<versionCode>.apk` (+ `.part`): the versionCode is in the NAME so hygiene needs no index. */
const APK_NAME = /^hiraia-v(\d+)\.apk(?:\.part)?$/;

/** Settings keys (db/repo.ts settings table). Both are written together by `snooze`. */
const KEY_SNOOZE_UNTIL = 'update.snoozeUntil';
const KEY_SNOOZE_VERSION = 'update.snoozeVersionCode';

/** Engine stages during which a model transfer owns the network. */
const MODEL_TRANSFER_STAGES: ReadonlySet<ReadyStage> = new Set(['connect', 'download', 'verify']);

/** Android: FLAG_GRANT_READ_URI_PERMISSION — lets the installer read our content:// URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const APK_MIME = 'application/vnd.android.package-archive';

const LOG = (m: string) => console.log(`[update] ${m}`);

/** The `app` block of the manifest, schema 1 (see packages/web/src/app/api/app/manifest/route.ts). */
export interface AppManifest {
  versionCode: number;
  versionName: string;
  url: string;
  bytes: number;
  sha256: string;
  md5: string;
  minSupportedVersionCode: number;
  publishedAt: string;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'snoozed';

interface UpdateState {
  status: UpdateStatus;
  /** The newer release on offer (set from 'available' onward; null while idle). */
  manifest: AppManifest | null;
  /** Download progress 0–100 (meaningful while 'downloading'; 99 = verifying on disk). */
  pct: number;
  /** Telemetry category of the last failure (never raw text — see errorCategory). */
  error: string | null;
  /** Epoch ms of the last check that reached the network (0 = never this process). */
  lastCheckedAt: number;
  /** Installed versionCode as reported by the build, or null when unreadable (then no checks). */
  installedVersionCode: number | null;
  /** Local path (no scheme) of the verified APK once 'ready' — kept through a failed install for retry. */
  localPath: string | null;
  /** installed < manifest.minSupportedVersionCode: the ribbon cannot be snoozed. */
  forced: boolean;

  /** Ask the manifest. Silent on every failure. `reason` is for the log only. */
  checkForUpdate: (reason: 'launch' | 'foreground' | 'tick' | 'deferred' | 'manual') => Promise<void>;
  /** 'available' | 'failed' → 'downloading' → 'ready' | 'failed'. */
  startDownload: () => Promise<void>;
  /** 'ready' → hands the APK to Android's installer (the user confirms there). */
  install: () => Promise<void>;
  /** 'failed' → whichever step failed. */
  retry: () => Promise<void>;
  /**
   * Settings → "Check for updates": the reader asked, so gates that exist for politeness
   * (snooze, recheck spacing) do not apply. Resolves to what the row should say. 'busy'
   * = a model/content transfer owns the network right now; 'error' = the manifest was
   * unreachable (offline being the normal case).
   */
  manualCheck: () => Promise<'available' | 'uptodate' | 'busy' | 'error'>;
  /** The ✕: hide this versionCode for SNOOZE_MS. No-op when `forced`. */
  snooze: () => Promise<void>;
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/**
 * The running build's android.versionCode — from the INSTALLED PACKAGE
 * (expo-application's `nativeBuildVersion`, real PackageInfo), not from the app.json copy
 * that expo-constants freezes into the JS bundle — including `Constants.nativeBuildVersion`,
 * which in the bare workflow is derived from that same embedded config, not the package. The two are normally identical, but they
 * skew whenever build.gradle and app.json drift (found 2026-09-16: a build whose gradle
 * said 10 while the bundle's expoConfig still said 11 judged itself "up to date" against
 * a v11 manifest). The package number is what Android's installer actually compares, so
 * it is the only correct side of the versionCode comparison. expoConfig stays as the
 * fallback; null in a dev client / Expo Go, where "update" has no meaning anyway.
 */
export function installedVersionCode(): number | null {
  const native = Number(Application.nativeBuildVersion);
  if (Number.isInteger(native) && native > 0) return native;
  const vc = Constants.expoConfig?.android?.versionCode;
  return typeof vc === 'number' && Number.isInteger(vc) && vc > 0 ? vc : null;
}

const isHex = (s: unknown, len: number): s is string =>
  typeof s === 'string' && new RegExp(`^[0-9a-f]{${len}}$`).test(s.toLowerCase());
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/**
 * Validate the manifest body. Returns the `app` block when it is a fully-pinned APK, or
 * null when the server offers nothing (`app: null`) or the shape is wrong — an unpinned
 * URL is not an update we can verify, so it is not an update. Unknown keys (and the
 * reserved `content` / `models`) are ignored: the schema is allowed to GROW.
 */
export function parseManifest(body: unknown): AppManifest | null {
  if (!body || typeof body !== 'object') return null;
  const { schema, app } = body as { schema?: unknown; app?: unknown };
  if (schema !== 1) return null;
  if (!app || typeof app !== 'object') return null;
  const a = app as Record<string, unknown>;
  if (!isPosInt(a.versionCode) || !isPosInt(a.bytes)) return null;
  if (typeof a.url !== 'string' || !a.url.startsWith('https://')) return null;
  if (!isHex(a.md5, 32) || !isHex(a.sha256, 64)) return null;
  return {
    versionCode: a.versionCode,
    versionName: typeof a.versionName === 'string' ? a.versionName : String(a.versionCode),
    url: a.url,
    bytes: a.bytes,
    sha256: a.sha256.toLowerCase(),
    md5: a.md5.toLowerCase(),
    minSupportedVersionCode: isPosInt(a.minSupportedVersionCode) ? a.minSupportedVersionCode : 1,
    publishedAt: typeof a.publishedAt === 'string' ? a.publishedAt : '',
  };
}

async function fetchManifest(manual = false): Promise<AppManifest | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MANIFEST_URL, {
      method: 'GET',
      // No `cache` option: RN's RequestInit has none, and the route answers
      // `Cache-Control: no-store`, which is what OkHttp honours.
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      // Cast: onnxruntime's types drag @types/node into the program, and Node's
      // AbortSignal is not structurally RN's. Same object at runtime either way.
      signal: controller.signal as RequestInit['signal'],
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body || body.schema !== 1 || !Object.prototype.hasOwnProperty.call(body, 'app')) throw new Error('Invalid update manifest');
    // A bad optional asset catalog must not suppress an APK update.
    await useAssetUpdateStore.getState().acceptManifest(body.assets, manual).catch(() => {});
    const app = parseManifest(body);
    if (body.app !== null && !app) throw new Error('Invalid APK update metadata');
    return app;
  } finally {
    clearTimeout(timeout);
  }
}

const apkFilename = (versionCode: number) => `hiraia-v${versionCode}.apk`;

/** Size of a local file, or null when absent. */
async function statSize(uri: string): Promise<number | null> {
  try {
    const info = await getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Cache hygiene: delete any cached APK (or partial) whose versionCode is not newer than
 * the running app — it was either installed (so it is now the app) or superseded. With
 * `keep` (the versionCode the manifest currently offers) every OTHER newer file goes too:
 * a v2 fetched last month is dead weight once the mirror serves v3, and nothing else would
 * ever remove it before v3 is installed.
 */
export async function pruneStaleApks(installed: number, keep?: number): Promise<void> {
  try {
    const dirInfo = await getInfoAsync(UPDATES_DIR);
    if (!dirInfo.exists) return;
    const names = await readDirectoryAsync(UPDATES_DIR);
    for (const name of names) {
      const m = APK_NAME.exec(name);
      if (!m) continue;
      const vc = Number(m[1]);
      if (vc <= installed || (keep !== undefined && vc !== keep)) {
        LOG(`pruning stale ${name} (installed v${installed}${keep !== undefined ? `, offered v${keep}` : ''})`);
        await deleteAsync(`${UPDATES_DIR}${name}`, { idempotent: true });
      }
    }
  } catch (e) {
    LOG(`prune skipped — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * expo-intent-launcher's Android entry is `requireNativeModule('ExpoIntentLauncher')`,
 * evaluated at IMPORT — in a binary built without the module linked (a dev client from
 * before this feature, a release built without `pnpm prebuild`) a static import would
 * throw while this module loads, and this module loads with the root layout: the whole
 * app would crash at launch over a ribbon. Loaded lazily at the one call that needs it,
 * inside `install`'s try/catch, so a missing native module is a `failed` chip, not a crash.
 */
async function loadIntentLauncher() {
  return import('expo-intent-launcher');
}

async function readSnooze(): Promise<{ until: number; versionCode: number } | null> {
  try {
    const [until, vc] = await Promise.all([getSetting(KEY_SNOOZE_UNTIL), getSetting(KEY_SNOOZE_VERSION)]);
    if (!until || !vc) return null;
    const u = Number(until);
    const v = Number(vc);
    return Number.isFinite(u) && Number.isFinite(v) ? { until: u, versionCode: v } : null;
  } catch {
    return null;
  }
}

const modelTransferInFlight = () => MODEL_TRANSFER_STAGES.has(useEngineStore.getState().readyStage);

/**
 * One manifest fetch at a time. A module flag rather than the 'checking' status, because
 * a RE-check (6 h later, from 'available' / 'failed' / 'snoozed') must not flip the status
 * — the ribbon keys on it, and 'checking' would blank the bar for the fetch's duration on
 * every recheck. 'checking' is only ever shown from 'idle', where there is nothing to blank.
 */
let checkInFlight = false;
/** Epoch ms of the last check that did NOT reach the manifest (0 = none). See FAILED_RETRY_MS. */
let lastFailedAt = 0;

/** Is a check allowed now by the cadence? (Successful: RECHECK_MS; failed: FAILED_RETRY_MS.) */
function checkDue(): boolean {
  const now = Date.now();
  if (now - useUpdateStore.getState().lastCheckedAt < RECHECK_MS) return false;
  return now - lastFailedAt >= FAILED_RETRY_MS;
}

// ---------------------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------------------

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  manifest: null,
  pct: 0,
  error: null,
  lastCheckedAt: 0,
  installedVersionCode: installedVersionCode(),
  localPath: null,
  forced: false,

  checkForUpdate: async (reason) => {
    if (Platform.OS !== 'android') return;
    const { status, installedVersionCode: installed } = get();
    if (installed === null) {
      LOG(`${reason}: installed versionCode unreadable (dev client?) — not checking`);
      return;
    }
    // These states own the manifest already; re-checking under them would only fight the UI.
    if (checkInFlight || status === 'checking' || status === 'downloading' || status === 'ready') return;
    if (modelTransferInFlight()) {
      LOG(`${reason}: model transfer in flight — deferring`);
      deferUntilModelIdle();
      return;
    }
    checkInFlight = true;
    // Only an idle store visibly enters 'checking'; a visible ribbon keeps its status (and
    // its chip stays live) while the recheck runs, so the bar never blinks.
    if (status === 'idle') set({ status: 'checking' });
    try {
      const manifest = await fetchManifest(reason === 'manual');
      const now = Date.now();
      lastFailedAt = 0;
      // The fetch yielded: the reader may have tapped download meanwhile. Their state wins.
      if (get().status === 'downloading' || get().status === 'ready') {
        set({ lastCheckedAt: now });
        return;
      }
      if (!manifest || manifest.versionCode <= installed) {
        LOG(
          `${reason}: ${manifest ? `manifest v${manifest.versionCode}` : 'nothing offered'} vs installed v${installed} — up to date`
        );
        set({ status: 'idle', manifest: null, lastCheckedAt: now, forced: false, localPath: null, error: null });
        return;
      }
      const forced = installed < manifest.minSupportedVersionCode;
      const snooze = await readSnooze();
      const snoozed =
        !forced && snooze !== null && snooze.versionCode === manifest.versionCode && now < snooze.until;
      if (snoozed) {
        LOG(`${reason}: v${manifest.versionCode} available but snoozed until ${new Date(snooze!.until).toISOString()}`);
        set({ status: 'snoozed', manifest, lastCheckedAt: now, forced });
        return;
      }
      // A cached APK for any OTHER version is dead weight now that the mirror names this one.
      void pruneStaleApks(installed, manifest.versionCode);
      // Already fetched and verified on an earlier launch? Offer the install straight away.
      const localUri = `${UPDATES_DIR}${apkFilename(manifest.versionCode)}`;
      const cached = (await statSize(localUri)) === manifest.bytes;
      LOG(`${reason}: v${manifest.versionCode} (${manifest.versionName}) available${cached ? ', already on disk' : ''}`);
      track('update_available', {
        version_code: manifest.versionCode,
        installed_version_code: installed,
        cached,
        forced,
      });
      set({
        status: cached ? 'ready' : 'available',
        manifest,
        pct: cached ? 100 : 0,
        error: null,
        lastCheckedAt: now,
        localPath: cached ? localUri.replace(/^file:\/\//, '') : null,
        forced,
      });
    } catch (e) {
      // Silent by contract: no network is the normal case for this app's users. The status
      // is untouched (a visible ribbon stays; an idle store leaves 'checking') and
      // `lastCheckedAt` is NOT stamped — see FAILED_RETRY_MS.
      LOG(`${reason}: check failed — ${e instanceof Error ? e.message : String(e)}`);
      lastFailedAt = Date.now();
      if (get().status === 'checking') set({ status: 'idle' });
    } finally {
      checkInFlight = false;
    }
  },

  startDownload: async () => {
    if (useAssetUpdateStore.getState().status === 'downloading' || modelTransferInFlight()) return;
    const { status, manifest } = get();
    if (!manifest || (status !== 'available' && status !== 'failed')) return;
    set({ status: 'downloading', pct: 0, error: null });
    track('update_download_started', { version_code: manifest.versionCode, bytes: manifest.bytes });
    try {
      const path = await ensureRemoteAsset(
        {
          url: manifest.url,
          filename: apkFilename(manifest.versionCode),
          bytes: manifest.bytes,
          md5: manifest.md5,
          label: `Hiraia APK v${manifest.versionCode}`,
          dir: UPDATES_DIR,
        },
        (pct) => set({ pct })
      );
      track('update_download_done', { version_code: manifest.versionCode });
      set({ status: 'ready', pct: 100, localPath: path });
    } catch (e) {
      const error = errorCategory(e);
      LOG(`download failed — ${e instanceof Error ? e.message : String(e)}`);
      track('update_failed', { version_code: manifest.versionCode, step: 'download', error });
      set({ status: 'failed', error });
    }
  },

  install: async () => {
    const { status, manifest, localPath } = get();
    if (status !== 'ready' || !manifest || !localPath) return;
    try {
      // The verified APK is gone (cache reclaimed by the OS)? Back to the download step.
      if ((await statSize(`file://${localPath}`)) !== manifest.bytes) {
        LOG('cached APK missing or wrong size — re-downloading');
        set({ status: 'available', localPath: null, pct: 0 });
        return;
      }
      const contentUri = await getContentUriAsync(`file://${localPath}`);
      const IntentLauncher = await loadIntentLauncher();
      track('update_install_prompted', { version_code: manifest.versionCode });
      // Resolves when the reader comes back from the system installer — whether they
      // confirmed or not. If they confirmed, this process is being replaced anyway.
      // "Install unknown apps" not yet granted for Hiraia (REQUEST_INSTALL_PACKAGES is
      // declared, but Android 8+ makes the reader allow it per source): the SYSTEM
      // installer itself shows the "not allowed to install unknown apps from this source
      // → Settings" sheet, and returns to its install prompt once they toggle it. So that
      // path resolves normally and the status stays 'ready' for a second tap; only a
      // missing handler / a broken content URI reaches the catch below.
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
        type: APK_MIME,
      });
    } catch (e) {
      const error = errorCategory(e);
      LOG(`install hand-off failed — ${e instanceof Error ? e.message : String(e)}`);
      track('update_failed', { version_code: manifest.versionCode, step: 'install', error });
      set({ status: 'failed', error });
    }
  },

  retry: async () => {
    const { status, localPath } = get();
    if (status !== 'failed') return;
    if (localPath) {
      set({ status: 'ready', error: null });
      await get().install();
    } else {
      await get().startDownload();
    }
  },

  manualCheck: async () => {
    if (Platform.OS !== 'android') return 'uptodate';
    if (modelTransferInFlight() || useAssetUpdateStore.getState().status === 'downloading') return 'busy';
    // An explicit ask forgets the ✕ — clearing BEFORE the check so a snoozed manifest
    // resurfaces as 'available' rather than sliding back into 'snoozed'.
    try {
      await Promise.all([setSetting(KEY_SNOOZE_UNTIL, ''), setSetting(KEY_SNOOZE_VERSION, '')]);
    } catch {
      /* readSnooze treats unparseable as no snooze; proceed */
    }
    if (get().status === 'snoozed') set({ status: 'idle', manifest: null });
    const before = get().lastCheckedAt;
    await get().checkForUpdate('manual');
    const after = get();
    if (after.status === 'available' || after.status === 'downloading' || after.status === 'ready')
      return 'available';
    if (['available','ready','failed'].includes(useAssetUpdateStore.getState().status)) return 'available';
    if (after.lastCheckedAt !== before) return 'uptodate';
    return 'error';
  },
  snooze: async () => {
    const { manifest, forced, status } = get();
    if (!manifest || forced) return;
    if (status === 'downloading') return; // the bar shows progress; let it finish
    const until = Date.now() + SNOOZE_MS;
    set({ status: 'snoozed' });
    try {
      await Promise.all([
        setSetting(KEY_SNOOZE_UNTIL, String(until)),
        setSetting(KEY_SNOOZE_VERSION, String(manifest.versionCode)),
      ]);
    } catch (e) {
      LOG(`snooze not persisted — ${e instanceof Error ? e.message : String(e)}`);
    }
    track('update_snoozed', { version_code: manifest.versionCode });
  },
}));

// ---------------------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------------------

let deferral: (() => void) | null = null;

/**
 * A check that met a model transfer waits for the stage to clear, then runs once. One
 * subscription at a time: a second deferral while one is pending is simply the same wait.
 */
function deferUntilModelIdle(): void {
  if (deferral) return;
  deferral = useEngineStore.subscribe((s) => {
    if (MODEL_TRANSFER_STAGES.has(s.readyStage)) return;
    deferral?.();
    deferral = null;
    void useUpdateStore.getState().checkForUpdate('deferred');
  });
}

let started = 0;

/**
 * Wire the launch check + the foreground cadence. Call ONCE the feed is hydrated and the
 * title sheet is gone (app/_layout.tsx); returns the teardown. Idempotent across remounts.
 */
export function startUpdateChecks(): () => void {
  if (started++) {
    return () => {
      started--;
    };
  }
  const store = useUpdateStore.getState();
  const installed = store.installedVersionCode;
  if (installed !== null) void pruneStaleApks(installed);

  // Launch: behind the first paint. runAfterInteractions waits for the title's throw and
  // the first card's commit; the delay after that keeps the fetch clear of the feed's own
  // deferred work (the under-sheet print, the image warm-up).
  // (Also cadence-gated: a background→foreground flip inside the delay would otherwise
  // fetch twice.)
  let launchTimer: ReturnType<typeof setTimeout> | null = null;
  const launch = InteractionManager.runAfterInteractions(() => {
    launchTimer = setTimeout(() => {
      if (checkDue()) void useUpdateStore.getState().checkForUpdate('launch');
    }, LAUNCH_DELAY_MS);
  });

  // Foreground: every return to the app, at most every RECHECK_MS.
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && checkDue()) void useUpdateStore.getState().checkForUpdate('foreground');
  });
  // A tablet that never leaves the foreground still gets its 6-hourly look.
  const tick = setInterval(() => {
    if (AppState.currentState === 'active' && checkDue()) void useUpdateStore.getState().checkForUpdate('tick');
  }, FAILED_RETRY_MS);

  return () => {
    started--;
    launch.cancel();
    if (launchTimer) clearTimeout(launchTimer);
    sub.remove();
    clearInterval(tick);
    deferral?.();
    deferral = null;
  };
}

/** "v0.2 · 297 MB" — the ribbon's body line. MiB, matching the landing page's fileSizeMB. */
export function describeUpdate(m: AppManifest): string {
  return `v${m.versionName} · ${Math.round(m.bytes / 1048576)} MB`;
}
