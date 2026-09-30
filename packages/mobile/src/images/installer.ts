import { fileUri } from '../platform/filePath';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getInfoAsync } from 'expo-file-system/legacy';
import * as Application from 'expo-application';
import { mergeImagePacks, parseAssetCatalog, type AssetCatalog } from '../updates/catalog';
import manifest from '../generated/imagePacks.generated.json';
import { ensureRemoteAsset } from '../engine/modelDownload';
import { hydrateDownloadedArt, markArtDownloadedMany } from '../data/artPresence';
import { subscribeInternetRestored } from '../net/connectivity';
import { useEngineStore } from '../store/engineStore';
import { headerLength, parseEntries, requiredPacks, type ImagePack, type ImageEntry } from './format';

let packs: ImagePack[] = manifest.packs;
const catalogKey = 'hiraia.image-catalog.v1';
const root = () => new Directory(Paths.document, 'image-packs');
const preference = 'hiraia.image-downloads.enabled.v2';
const listeners = new Set<() => void>();
const installed = new Set<string>();
let status = { ready: false, enabled: false, phase: 'loading', completed: 0, total: packs.length, percent: 0, error: false };
let active: AbortController | null = null;
let initialized: Promise<void> | null = null;
let startupRefs = 0;
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;
let stopEngine: (() => void) | null = null;
let stopNetwork: (() => void) | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
// Per-pack retry ladder, in memory only: every launch gives every pack a fresh start.
// It paces the timer; foreground, a returning network and Retry all make packs due now.
const firstRetry = 60_000, lastRetry = 30 * 60_000;
const backoff = new Map<string, { at: number; delay: number }>();
// The pump's own rest after a pack could not be downloaded, on the same ladder: consecutive
// such failures, whichever packs they were, since every pack shares the network and server.
let restUntil = 0, failedTransfers = 0;
// A COMPLETE transfer that failed the pinned MD5 (ensureRemoteAsset's `fatal`): the same
// request returns the same bytes, so the pack waits for a relaunch or a new catalog.
const parked = new Set<string>();
const isFatal = (e: unknown) => typeof e === 'object' && e !== null && (e as { fatal?: unknown }).fatal === true;
const due = (pack: ImagePack) => !installed.has(pack.md5) && !parked.has(pack.md5)
  && Math.max(restUntil, backoff.get(pack.md5)?.at ?? 0) <= Date.now();
/** The due pack that has failed least, in catalog order among equals: one broken pack never holds up the rest. */
const nextPack = () => selectedPacks().filter(due)
  .sort((a, b) => (backoff.get(a.md5)?.delay ?? 0) - (backoff.get(b.md5)?.delay ?? 0))[0];
function stepAside(pack: ImagePack) {
  const delay = Math.min(lastRetry, 2 * (backoff.get(pack.md5)?.delay ?? firstRetry / 2));
  backoff.set(pack.md5, { at: Date.now() + delay, delay });
}
function wake() { for (const b of backoff.values()) b.at = 0; restUntil = 0; failedTransfers = 0; void pump(); }
export const imageDownloadStatus = () => status;
export function subscribeImageDownloads(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function update(value: Partial<typeof status>) { status = { ...status, ...value }; for (const fn of listeners) fn(); }
function selectedPacks() {
  const engine = useEngineStore.getState();
  return requiredPacks(packs, engine.bootstrapped && !engine.onboardingActive ? engine.grade : null);
}
function refreshProgress() {
  const needed = selectedPacks();
  update({ completed: needed.filter(p => installed.has(p.md5)).length, total: needed.length });
}
const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function check(signal: AbortSignal) { if (signal.aborted) throw new Error('cancelled'); }
function folder(pack: ImagePack) { return new Directory(root(), pack.md5); }
function entriesAt(dir: Directory, rows: ImageEntry[]) { return rows.map((row,i) => [row.slug, new File(dir, `${i}.png`).uri] as const); }

/** Replay only complete on-disk packs. Interrupted staging directories never count. */
export function initializeImages(): Promise<void> {
  return initialized ??= (async () => {
    root().create({ intermediates: true, idempotent: true });
    try {
      const raw = await AsyncStorage.getItem(catalogKey);
      const saved = raw && parseAssetCatalog(JSON.parse(raw), Number(Application.nativeBuildVersion), manifest.version);
      if (saved) packs = mergeImagePacks(manifest.packs, saved.imagePacks);
    } catch { /* Bundled catalog remains usable offline. */ }
    const entries: (readonly [string,string])[] = [];
    // Replay prior versions first. Their images remain visible until a replacement is
    // completely installed, including across a kill halfway through an update.
    const historyRaw = await AsyncStorage.getItem(catalogKey + '.history').catch(() => null);
    const history: ImagePack[] = [];
    try {
      for (const raw of JSON.parse(historyRaw ?? '[]')) {
        const saved = parseAssetCatalog(raw, Number(Application.nativeBuildVersion), manifest.version);
        if (saved) history.push(...saved.imagePacks);
      }
    } catch { /* Bad metadata must never prevent bundled illustrations from loading. */ }
    for (const pack of [...manifest.packs, ...history, ...packs]) {
      if (installed.has(pack.md5)) continue;
      const staging = new Directory(root(), pack.md5+'.staging');
      if (staging.exists) staging.delete();
      const dir = folder(pack); const marker = new File(dir, 'installed.json');
      if (!marker.exists) continue;
      try {
        const record = JSON.parse(await marker.text());
        if (record.md5 !== pack.md5) continue;
        // Reuse the verified header parser rather than trusting arbitrary persisted paths.
        const rows = parseEntries(Uint8Array.from(record.header), pack);
        let valid = true;
        for (let i=0; i<rows.length; i++) {
          const f = new File(dir, `${i}.png`);
          if (!f.exists || f.size !== rows[i]!.bytes) { valid = false; break; }
          if (i % 16 === 0) await yieldUI();
        }
        if (valid) {
          installed.add(pack.md5); entries.push(...entriesAt(dir,rows));
          const cached = new File(Paths.document, 'models', pack.filename); if (cached.exists) cached.delete();
        }
      } catch { /* Invalid receipts/files are repaired by reinstalling the pack. */ }
      await yieldUI();
    }
    hydrateDownloadedArt(entries);
    const enabled = await AsyncStorage.getItem(preference) !== 'false';
    update({ ready: true, enabled, phase: 'paused' });
    refreshProgress();
  })().catch(() => { initialized = null; update({ phase: 'paused', error: true }); });
}

/** Sparse corrections can include common patch packs that override APK-bundled art. */
export function pendingImageUpdates(replacements: ImagePack[]): ImagePack[] {
  const engine = useEngineStore.getState();
  return requiredPacks(replacements, engine.bootstrapped && !engine.onboardingActive ? engine.grade : null)
    .filter(p => !installed.has(p.md5));
}

export async function acceptImageUpdates(catalog: AssetCatalog): Promise<void> {
  await initializeImages();
  const previous = await AsyncStorage.getItem(catalogKey);
  if (previous) {
    const history = JSON.parse(await AsyncStorage.getItem(catalogKey + '.history') ?? '[]');
    // Keep prior receipts so interrupted updates retain their last working illustrations.
    if (!history.some((c: AssetCatalog) => c.revision === JSON.parse(previous).revision)) {
      history.push(JSON.parse(previous));
      await AsyncStorage.setItem(catalogKey + '.history', JSON.stringify(history));
    }
  }
  await AsyncStorage.setItem(catalogKey, JSON.stringify(catalog));
  packs = mergeImagePacks(manifest.packs, catalog.imagePacks);
  // Every manifest check re-offers the same catalog; only a changed one may fix a parked pack.
  if (previous !== JSON.stringify(catalog)) { parked.clear(); backoff.clear(); }
  refreshProgress();
  // Honour a user's paused-download preference.
  void pump();
}

/** Gets the pack onto the phone. What fails here (connection, server, storage) is shared by every pack. */
async function download(pack: ImagePack, signal: AbortSignal): Promise<string> {
  check(signal);
  // One staging copy plus one downloaded pack and headroom for SQLite/model activity.
  if (Paths.availableDiskSpace < pack.bytes + pack.unpackedBytes + 50_000_000) throw new Error('Not enough storage');
  return ensureRemoteAsset({ ...pack, label: 'Illustrations '+pack.id,
    url: 'https://assets.hiraia.org/models/images/'+pack.filename,
  }, percent => update({ phase: 'downloading', percent }), signal);
}

/** Unpacks a downloaded pack. What fails here is this pack's own. */
async function install(pack: ImagePack, path: string, signal: AbortSignal) {
  check(signal);
  const file = new File(fileUri(path));
  // Recheck cached packages too; a matching file size alone is not enough for extraction.
  const info = await getInfoAsync(file.uri, { md5: true });
  if (!info.exists || info.md5 !== pack.md5) { file.delete(); throw new Error('Image package integrity failure'); }
  const stage = new Directory(root(), pack.md5+'.staging');
  if (stage.exists) stage.delete();
  stage.create();
  const handle = file.open();
  try {
    const length = headerLength(handle.readBytes(12));
    const header = handle.readBytes(length);
    if (header.length !== length) throw new Error('Truncated image header');
    const rows = parseEntries(header, pack);
    update({ phase: 'installing', percent: 100 });
    for (let i=0; i<rows.length; i++) {
      check(signal);
      const bytes = handle.readBytes(rows[i]!.bytes);
      if (bytes.length !== rows[i]!.bytes || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error('Invalid image payload');
      const image = new File(stage, `${i}.png`); image.create(); image.write(bytes);
      // At most ~61 KB crosses the JS/native bridge per image, then let the UI run.
      await yieldUI();
    }
    check(signal);
    const receipt = new File(stage, 'installed.json'); receipt.create(); receipt.write(JSON.stringify({ md5: pack.md5, header: Array.from(header) }));
    const dest = folder(pack);
    if (dest.exists) dest.delete();
    stage.move(dest); // Atomic directory promotion; receipt lives inside the promoted tree.
    installed.add(pack.md5);
    markArtDownloadedMany(entriesAt(dest, rows));
    refreshProgress();
    update({ percent: 0 });
  } finally {
    handle.close();
    if (!installed.has(pack.md5) && stage.exists) stage.delete();
  }
  // Keep only installed images, not a second permanent copy of their package.
  file.delete();
}

async function pump() {
  if (active || !status.ready || !status.enabled || AppState.currentState !== 'active' || !startupRefs) return;
  if (retry) { clearTimeout(retry); retry = null; }
  const controller = new AbortController(); active = controller;
  update({ error: false });
  try {
    while (true) {
      const pack = nextPack();
      if (!pack) break;
      check(controller.signal);
      let path: string;
      try { path = await download(pack, controller.signal); }
      catch (e) {
        if (controller.signal.aborted) throw e;
        if (isFatal(e)) { backoff.delete(pack.md5); parked.add(pack.md5); continue; }
        // Short of wrong bytes, a failed download is the connection's or the server's doing, and
        // the next pack would meet the same: rest rather than walk every pack through an outage.
        stepAside(pack);
        restUntil = Date.now() + Math.min(lastRetry, firstRetry * 2 ** failedTransfers++);
        break;
      }
      // A pack that will not unpack steps aside; the next may still install.
      try { await install(pack, path, controller.signal); backoff.delete(pack.md5); failedTransfers = 0; }
      catch (e) {
        if (controller.signal.aborted) throw e;
        stepAside(pack);
      }
    }
    refreshProgress();
    const waiting = selectedPacks().filter(p => !installed.has(p.md5));
    if (!waiting.length) { update({ phase: 'complete' }); return; }
    update({ phase: 'paused', error: true });
    // Sleep until the first pack is due again. Parked packs never are.
    const next = Math.min(...waiting.map(p => parked.has(p.md5) ? Infinity : Math.max(restUntil, backoff.get(p.md5)?.at ?? 0)));
    if (Number.isFinite(next) && status.enabled) retry = setTimeout(() => { retry = null; void pump(); }, Math.max(0, next - Date.now()));
  } catch {
    update({ phase: 'paused', error: !controller.signal.aborted });
    if (!controller.signal.aborted && status.enabled) retry = setTimeout(() => { retry = null; void pump(); }, firstRetry);
  } finally {
    active = null;
    if (controller.signal.aborted && startupRefs && status.enabled && AppState.currentState === 'active') setTimeout(() => void pump(), 0);
  }
}
export async function setImageDownloadsEnabled(enabled: boolean) {
  await initializeImages();
  await AsyncStorage.setItem(preference, String(enabled));
  update({ enabled, error: false });
  if (!enabled) { active?.abort(); if (retry) clearTimeout(retry); retry = null; }
  else wake();
}
export function startImageDownloads() {
  startupRefs++;
  if (startupRefs === 1) {
    stopEngine = useEngineStore.subscribe((state, prev) => {
      if (state.grade !== prev.grade || state.bootstrapped !== prev.bootstrapped || state.onboardingActive !== prev.onboardingActive) {
        refreshProgress();
        if (active) active.abort(); else void pump();
      }
    });
    subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') active?.abort(); else wake();
    });
    // Wi-Fi (or the warehouse LAN) coming back is when a failed pack can succeed.
    stopNetwork = subscribeInternetRestored(wake);
    void initializeImages().then(() => { if (startupRefs) void pump(); });
  }
  return () => {
    if (--startupRefs === 0) {
      stopEngine?.(); stopEngine = null; subscription?.remove(); subscription = null; stopNetwork?.(); stopNetwork = null;
      active?.abort(); if (retry) clearTimeout(retry); retry = null;
    }
  };
}
