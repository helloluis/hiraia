import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AppState } from 'react-native';
import { getInfoAsync, deleteAsync } from 'expo-file-system/legacy';
import { create } from 'zustand';
import imageManifest from '../generated/imagePacks.generated.json';
import { REMOTE_ASSETS } from '../config/model';
import { ensureRemoteAsset } from '../engine/modelDownload';
import { readMemory } from '../engine/memory';
import { memoryBlock } from '../engine/memoryPolicy';
import { acceptImageUpdates, initializeImages, pendingImageUpdates } from '../images/installer';
import { newerModel, parseAssetCatalog, type AssetCatalog, type ModelUpdate } from '../updates/catalog';
import { installedModelUpdate, rejectedModelRevision, saveModelUpdate } from '../updates/model';
import { useEngineStore } from './engineStore';

const SEEN = 'assets.last-catalog.v1';
const RETRY_MS = 15 * 60 * 1000;
function readJson(raw: string | null): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
interface State {
  catalog: AssetCatalog | null; model: ModelUpdate | null; imageCount: number; bytes: number;
  status: 'idle' | 'available' | 'downloading' | 'ready' | 'failed';
  pct: number;
  acceptManifest(value: unknown): Promise<void>;
  download(): Promise<void>;
}
let controller: AbortController | null = null;
let transfer: Promise<void> | null = null;
let accepting = false;
let retryAt = 0;
// A saved replacement is for the next process. Do not repeatedly fetch it while
// installedModelUpdate() deliberately continues to describe the running model.
let staged: ModelUpdate | null = null;
const busy = () => !['idle', 'done'].includes(useEngineStore.getState().readyStage);

export const useAssetUpdateStore = create<State>((set, get) => ({
  catalog: null, model: null, imageCount: 0, bytes: 0, status: 'idle', pct: 0,
  acceptManifest: async (value) => {
    if (accepting) return;
    const catalog = parseAssetCatalog(value, Number(Application.nativeBuildVersion), imageManifest.version);
    if (!catalog) return; // Old servers / incompatible catalogs leave working assets alone.
    accepting = true;
    try {
      const previousRaw = await AsyncStorage.getItem(SEEN);
      const previous = parseAssetCatalog(readJson(previousRaw), Number(Application.nativeBuildVersion), imageManifest.version);
      if (previous && (catalog.revision < previous.revision ||
          (catalog.revision === previous.revision && JSON.stringify(catalog) !== JSON.stringify(previous)))) return;
      await initializeImages();
      const packs = pendingImageUpdates(catalog.imagePacks);
      // Images never wait for an LLM transfer, memory eligibility, or consent. The
      // installer retains grade selection, explicit Settings pause, and safe promotion.
      await acceptImageUpdates(catalog);
      await AsyncStorage.setItem(SEEN, JSON.stringify(catalog));
      set({imageCount: packs.length});
      // A newer catalog's images can be queued even during a model transfer. Its
      // model will be reconsidered on the next manifest check.
      if (transfer) return;
      const installed = staged ?? await installedModelUpdate();
      const candidate = newerModel(catalog.models[0], installed, REMOTE_ASSETS.base);
      const model = candidate && candidate.revision > await rejectedModelRevision() ? candidate : null;
      const same = model?.revision === get().model?.revision && model?.md5 === get().model?.md5;
      if (!same) retryAt = 0;
      set({catalog, model: model ?? staged, bytes: model?.bytes ?? 0,
        status: model ? (same && get().status === 'failed' ? 'failed' : 'available') : staged ? 'ready' : 'idle'});
    } finally { accepting = false; }
  },
  download: async () => {
    const {catalog, model, status} = get();
    if (!catalog || !model || transfer || accepting || !['available', 'failed'].includes(status) ||
        busy() || AppState.currentState !== 'active' || Date.now() < retryAt) return;
    const abort = new AbortController();
    controller = abort;
    // Claim the transfer before awaiting memory/storage inspection.
    set({status: 'downloading', pct: 0});
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') abort.abort(); });
    const stopEngine = useEngineStore.subscribe(() => { if (busy()) abort.abort(); });
    transfer = (async () => {
      try {
        // Retain the existing LLM eligibility gate: LaBSE-only phones must not
        // start downloading a multi-GB replacement just because one is published.
        if (memoryBlock(await readMemory(), true)) {
          retryAt = Date.now() + RETRY_MS;
          set({status: 'available'});
          return;
        }
        if (abort.signal.aborted) throw new Error('Paused');
        await installedModelUpdate();
        const path = await ensureRemoteAsset(model, pct => set({pct}), abort.signal);
        const uri = path.startsWith('file:') ? path : 'file://' + path;
        const info = await getInfoAsync(uri, {md5: true});
        if (!info.exists || info.isDirectory || info.size !== model.bytes || info.md5 !== model.md5) {
          await deleteAsync(uri, {idempotent: true});
          throw new Error('Model verification failed');
        }
        if (abort.signal.aborted) throw new Error('Paused');
        await saveModelUpdate(model, catalog.minAppVersionCode, catalog.maxAppVersionCode);
        staged = model;
        retryAt = 0;
        set({status: 'ready', pct: 100});
      } catch (error) {
        // A deterministic digest failure must not repeatedly spend mobile data.
        retryAt = (error as {fatal?: boolean})?.fatal ? Infinity : abort.signal.aborted ? 0 : Date.now() + RETRY_MS;
        set({status: 'failed'});
      } finally { sub.remove(); stopEngine(); controller = null; }
    })();
    try { await transfer; } finally { transfer = null; }
  },
}));

/** A user-requested APK takes priority over an automatic model replacement. */
export async function pauseAssetModelDownload(): Promise<void> {
  controller?.abort();
  await transfer;
}

/** Owned by the update-check lifecycle; retries do not need another manifest fetch. */
export function startAssetUpdates(apkDownloading: () => boolean): () => void {
  const pump = () => {
    if (!apkDownloading()) void useAssetUpdateStore.getState().download();
  };
  // Defer store-triggered work until acceptManifest has released its lock.
  let wake: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (wake !== null) clearTimeout(wake);
    wake = setTimeout(() => { wake = null; pump(); }, 0);
  };
  const stopStore = useAssetUpdateStore.subscribe((state, prev) => {
    if (state.catalog !== prev.catalog) schedule();
  });
  const stopEngine = useEngineStore.subscribe((state, prev) => {
    if (state.readyStage !== prev.readyStage && !busy()) schedule();
  });
  const sub = AppState.addEventListener('change', state => { if (state === 'active') schedule(); });
  const tick = setInterval(pump, 60_000);
  schedule();
  return () => {
    stopStore(); stopEngine(); sub.remove(); clearInterval(tick);
    if (wake !== null) clearTimeout(wake);
    controller?.abort();
  };
}
