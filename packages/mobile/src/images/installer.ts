import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getInfoAsync } from 'expo-file-system/legacy';
import manifest from '../generated/imagePacks.generated.json';
import { ensureRemoteAsset } from '../engine/modelDownload';
import { hydrateDownloadedArt, markArtDownloadedMany } from '../data/artPresence';
import { useEngineStore } from '../store/engineStore';
import { headerLength, parseEntries, requiredPacks, type ImagePack, type ImageEntry } from './format';

const packs: ImagePack[] = manifest.packs;
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
let retry: ReturnType<typeof setTimeout> | null = null;
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
    const entries: (readonly [string,string])[] = [];
    for (const pack of packs) {
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

async function install(pack: ImagePack, signal: AbortSignal) {
  check(signal);
  // One staging copy plus one downloaded pack and headroom for SQLite/model activity.
  if (Paths.availableDiskSpace < pack.bytes + pack.unpackedBytes + 50_000_000) throw new Error('Not enough storage');
  const path = await ensureRemoteAsset({ ...pack, label: 'Illustrations '+pack.id,
    url: 'https://assets.hiraia.org/models/images/'+pack.filename,
  }, percent => update({ phase: 'downloading', percent }), signal);
  check(signal);
  const file = new File(path.startsWith('file:') ? path : 'file://'+path);
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
      const pack = selectedPacks().find(p => !installed.has(p.md5));
      if (!pack) break;
      check(controller.signal);
      if (!installed.has(pack.md5)) await install(pack, controller.signal);
    }
    refreshProgress();
    update({ phase: 'complete' });
  } catch {
    update({ phase: 'paused', error: !controller.signal.aborted });
    if (!controller.signal.aborted && status.enabled) retry = setTimeout(() => { retry = null; void pump(); }, 60000);
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
  else void pump();
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
      if (state !== 'active') active?.abort(); else void pump();
    });
    void initializeImages().then(() => { if (startupRefs) void pump(); });
  }
  return () => {
    if (--startupRefs === 0) { stopEngine?.(); stopEngine = null; subscription?.remove(); subscription = null; active?.abort(); if (retry) clearTimeout(retry); retry = null; }
  };
}
