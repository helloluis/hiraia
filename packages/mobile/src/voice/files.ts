import { Asset } from 'expo-asset';
import { documentDirectory, getInfoAsync, getFreeDiskStorageAsync, makeDirectoryAsync, moveAsync, copyAsync, deleteAsync } from 'expo-file-system/legacy';
import { bundledVoiceModule } from './bundled';
import { ensureRemoteAsset } from '../engine/modelDownload';
import type { DownloadProgressFn } from '../engine/modelDownload';
import type { VoiceSpec } from './catalog';
import { nativeFilePath } from '../platform/filePath';

const directory = `${documentDirectory}voices/`;
const checked = new Map<string, string>();
const materializing = new Map<string, Promise<string | null>>();
const downloading = new Map<string, Promise<string>>();
const uriFor = (voice: VoiceSpec) => directory + voice.filename;
const pathFor = nativeFilePath;

async function matches(uri: string, voice: VoiceSpec): Promise<boolean> {
  const info = await getInfoAsync(uri, { md5: true });
  return info.exists && !info.isDirectory && info.size === voice.bytes && info.md5 === voice.md5;
}

/** Checks cached bytes once per process; migrates old APK-extracted voices without a transfer. */
export function installedVoicePath(voice: VoiceSpec): Promise<string | null> {
  const known = checked.get(voice.filename);
  if (known) return Promise.resolve(known);
  const transfer = downloading.get(voice.filename);
  if (transfer) return transfer;
  const running = materializing.get(voice.filename);
  if (running) return running;
  const work = (async () => {
    await makeDirectoryAsync(directory, { intermediates: true });
    const uri = uriFor(voice);
    if (await matches(uri, voice)) {
      checked.set(voice.filename, pathFor(uri));
      return pathFor(uri);
    }
    // Old builds extracted tl.onnx/en.onnx. Verify the actual bytes, not just the stamp.
    const legacy = `${directory}${voice.id}.onnx`;
    if (await matches(legacy, voice)) {
      await deleteAsync(uri, { idempotent: true });
      await moveAsync({ from: legacy, to: uri });
      checked.set(voice.filename, pathFor(uri));
      return pathFor(uri);
    }
    if (voice.delivery === 'download') {
      // Do not let ensureRemoteAsset's size-only cache check trust a failed digest.
      await deleteAsync(uri, { idempotent: true });
      return null;
    }
    const asset = Asset.fromModule(bundledVoiceModule(voice.id));
    await asset.downloadAsync();
    const staging = uri + '.copying';
    await deleteAsync(staging, { idempotent: true });
    await copyAsync({ from: asset.localUri ?? asset.uri, to: staging });
    if (!await matches(staging, voice)) {
      await deleteAsync(staging, { idempotent: true });
      throw new Error('Bundled voice integrity failure');
    }
    await deleteAsync(uri, { idempotent: true });
    await moveAsync({ from: staging, to: uri });
    checked.set(voice.filename, pathFor(uri));
    return pathFor(uri);
  })();
  materializing.set(voice.filename, work);
  void work.finally(() => materializing.delete(voice.filename)).catch(() => {});
  return work;
}

/** Only the selected-language download lifecycle calls this network path. */
export async function downloadVoice(voice: VoiceSpec, progress?: DownloadProgressFn, signal?: AbortSignal): Promise<string> {
  const existing = downloading.get(voice.filename);
  if (existing) return existing;
  const work = (async () => {
    const local = await installedVoicePath(voice);
    if (local) return local;
    if (signal?.aborted) throw new Error('Voice download cancelled');
    if (await getFreeDiskStorageAsync() < voice.bytes + 20_000_000) throw new Error('Not enough storage for voice');
    const path = await ensureRemoteAsset({ ...voice, dir: directory }, progress, signal);
    // Downloads have already passed the streaming size + MD5 gate before promotion.
    checked.set(voice.filename, path);
    return path;
  })();
  downloading.set(voice.filename, work);
  try { return await work; } finally { downloading.delete(voice.filename); }
}

export const voiceIsInstalled = (voice: VoiceSpec) => voice.delivery === 'bundled' || checked.has(voice.filename);
