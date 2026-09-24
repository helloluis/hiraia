/**
 * Over-the-air JS updates (expo-updates, self-hosted: packages/web/src/app/api/updates/
 * manifest/route.ts relays manifests that deploy/publish-ota.py signed on the Mac). The
 * native module does the heavy lifting on its own:
 *
 *   • every COLD START on an unmetered network (app.json `checkAutomatically: WIFI_ONLY`)
 *     it asks the route and downloads a newer update in the background. Launch never waits
 *     for it (`fallbackToCacheTimeout: 0`); the update runs from the NEXT cold start.
 *   • a crash before first render marks that update failed and relaunches the previous one.
 *
 * What JS adds, driven from store/updateStore.ts:
 *
 *   • the reader's "Check for updates" tap — check AND download on any network, because the
 *     reader asked (`fetchOtaNow`);
 *   • a foreground look, at most every 6 h, that fetches the MANIFEST only and applies
 *     nothing but a rollBackToEmbedded directive (`applyOtaRollback`). The native check never
 *     runs on mobile data, so without this a phone that lives on prepaid data would keep a
 *     bad update until it next saw Wi-Fi. It never downloads a bundle, on any network: JS
 *     cannot tell metered from Wi-Fi without another native module, and on Wi-Fi the native
 *     launch check already downloads.
 *
 * NEVER `reloadAsync()`. A JS reload with the QVAC worklet or the ONNX voice sessions alive
 * can orphan a loaded 1.27 GB model; everything here applies at the next cold start.
 *
 * expo-updates' entry calls requireNativeModule('ExpoUpdates') AT IMPORT, so a static import
 * would crash a binary built without it (any dev client from before 0.4.24) at launch. It is
 * required lazily and guarded — the same reasoning as expo-intent-launcher in updateStore.ts
 * — and only ever used while `isEnabled`, which is false in dev and debug builds, where the
 * API throws. Nothing exported here throws.
 */
import type { Language } from '@hiraia/shared';

type UpdatesModule = typeof import('expo-updates');

const LOG = (m: string) => console.log(`[ota] ${m}`);

let loaded: UpdatesModule | null | undefined;

/** The expo-updates module when it is linked AND enabled; null in dev, debug and older binaries. */
function updates(): UpdatesModule | null {
  if (loaded === undefined) {
    try {
      const mod = require('expo-updates') as UpdatesModule;
      loaded = mod.isEnabled ? mod : null;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** Is this build taking OTA updates at all? */
export function otaEnabled(): boolean {
  return updates() !== null;
}

/** The running update's id, or null when the APK's own (embedded) bundle is running. */
function runningUpdateId(): string | null {
  const u = updates();
  return u && !u.isEmbeddedLaunch && u.updateId ? u.updateId : null;
}

/**
 * Telemetry base props: which JS is this phone actually running? APP_VERSION / APP_BUILD
 * come from the installed package, which an OTA does not change, so without these an event
 * from an updated phone is indistinguishable from one on the APK's bundle. 'embedded' = the
 * APK's own bundle (also dev and debug builds). Never an empty value: the collector's label
 * pattern rejects one. And the collector (packages/web/src/lib/telemetry/store.ts
 * validEvent) rejects any event carrying a prop key it does not list, so both keys must be
 * allowlisted there, and deployed, BEFORE these join telemetry's base context.
 */
export function otaTelemetry(): Record<string, string> {
  try {
    return {
      ota_update_id: runningUpdateId() ?? 'embedded',
      ota_runtime: updates()?.runtimeVersion || 'unknown',
    };
  } catch {
    return { ota_update_id: 'embedded', ota_runtime: 'unknown' };
  }
}

/** The sidebar's version row: the running update's first 8 hex, or null on the embedded bundle. */
export function shortOtaId(): string | null {
  try {
    return runningUpdateId()?.replace(/-/g, '').slice(0, 8) ?? null;
  } catch {
    return null;
  }
}

/**
 * The reader asked ("Check for updates"): check, and download whatever the server offers —
 * an update or a rollback — on any network. 'staged' = the next cold start runs different
 * JS (a rollback while the embedded bundle is already running changes nothing, so it is
 * 'none'); null = OTA is off in this build. A failure is 'error', never a throw.
 */
export async function fetchOtaNow(): Promise<'staged' | 'none' | 'error' | null> {
  const u = updates();
  if (!u) return null;
  try {
    const check = await u.checkForUpdateAsync();
    if (!check.isAvailable && !check.isRollBackToEmbedded) {
      LOG(`manual: nothing new (${check.reason ?? 'no reason'})`);
      return 'none';
    }
    const fetched = await u.fetchUpdateAsync();
    const staged = fetched.isNew || (fetched.isRollBackToEmbedded && !u.isEmbeddedLaunch);
    LOG(`manual: ${fetched.isRollBackToEmbedded ? 'rollback' : fetched.isNew ? 'update' : 'nothing new'} fetched${staged ? ' — applies at next launch' : ''}`);
    return staged ? 'staged' : 'none';
  } catch (e) {
    LOG(`manual: failed — ${e instanceof Error ? e.message : String(e)}`);
    return 'error';
  }
}

/**
 * The background look: fetch the manifest (a few KB) and act ONLY on a rollBackToEmbedded
 * directive, which downloads nothing. An offered update is left for the native Wi-Fi launch
 * check. null = OTA is off in this build.
 *
 * fetchUpdateAsync asks the server again rather than reusing the check's answer, so a publish
 * landing in the milliseconds between the two requests would be downloaded — a window this
 * narrow is accepted rather than worked around.
 */
export async function applyOtaRollback(): Promise<'rolledback' | 'none' | 'error' | null> {
  const u = updates();
  if (!u) return null;
  try {
    const check = await u.checkForUpdateAsync();
    if (!check.isRollBackToEmbedded) return 'none';
    const fetched = await u.fetchUpdateAsync();
    if (!fetched.isRollBackToEmbedded) return 'none';
    LOG('rollback to the embedded bundle staged for next launch');
    return 'rolledback';
  } catch (e) {
    LOG(`background look failed — ${e instanceof Error ? e.message : String(e)}`);
    return 'error';
  }
}

/**
 * Follow "something is downloaded and waiting for the next cold start", whichever path
 * fetched it (the native launch check, or `fetchOtaNow`). A rollback staged while the
 * embedded bundle is already running changes nothing the reader would notice, so it does not
 * count. Returns the teardown; a no-op when OTA is off.
 */
export function subscribeOtaPending(listener: (pending: boolean) => void): () => void {
  const u = updates();
  if (!u) return () => {};
  const pending = (ctx: { isUpdatePending: boolean; rollback?: unknown }) =>
    ctx.isUpdatePending && !(ctx.rollback && u.isEmbeddedLaunch);
  try {
    listener(pending(u.latestContext));
    const sub = u.addUpdatesStateChangeListener((event) => listener(pending(event.context)));
    return () => sub.remove();
  } catch (e) {
    LOG(`state listener unavailable — ${e instanceof Error ? e.message : String(e)}`);
    return () => {};
  }
}

// NOTE for native review (drafted 2026-09-24, flagged not self-corrected). Kept here rather
// than in config/strings.ts only because that file belonged to another change in this
// release; fold it in there. Cebuano checked against the corpus (ceb_usage.py --bis, bodies
// only): `pag-abli` 19 bodies, `sa sunod nga` 64 (with `sunod nga pag-ilis` for the same
// shape), `pag-abli nimo` 1, `nimo` 2,382; `ma-` + an English loan is the corpus's own habit
// (`ma-expose` 31, `ma-convert` 15); `update` is already the app's loan ("Naay bag-ong
// update!"). Confirm the whole line reads naturally to a Grade 5 reader.
const PENDING: Record<Language, string> = {
  english: 'Hiraia will update the next time you open it.',
  tagalog: 'Maa-update ang Hiraia sa susunod mong pagbukas.',
  cebuano: 'Ma-update ang Hiraia sa sunod nga pag-abli nimo.',
};

/** "Hiraia will update the next time you open it." in the tutor language. */
export function otaPendingText(language: Language | null | undefined): string {
  return PENDING[language ?? 'tagalog'] ?? PENDING.tagalog;
}
