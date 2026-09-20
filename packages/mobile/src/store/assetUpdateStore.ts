import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AppState } from 'react-native';
import { getInfoAsync, deleteAsync } from 'expo-file-system/legacy';
import { create } from 'zustand';
import imageManifest from '../generated/imagePacks.generated.json';
import { REMOTE_ASSETS } from '../config/model';
import { ensureRemoteAsset } from '../engine/modelDownload';
import { acceptImageUpdates, initializeImages, pendingImageUpdates } from '../images/installer';
import { newerModel, parseAssetCatalog, type AssetCatalog, type ModelUpdate } from '../updates/catalog';
import { installedModelUpdate, rejectedModelRevision, saveModelUpdate } from '../updates/model';
import { useEngineStore } from './engineStore';

const SNOOZE = 'assets.snooze.v1';
const SEEN = 'assets.last-catalog.v1';
function readJson(raw: string | null): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
interface State {
  catalog: AssetCatalog | null; model: ModelUpdate | null; imageCount: number; bytes: number;
  status: 'idle' | 'available' | 'downloading' | 'ready' | 'failed' | 'snoozed';
  pct: number;
  acceptManifest(value: unknown, manual?: boolean): Promise<void>;
  download(): Promise<void>;
  snooze(): Promise<void>;
}
let controller: AbortController | null = null;
const busy = () => !['idle', 'done'].includes(useEngineStore.getState().readyStage);

export const useAssetUpdateStore = create<State>((set, get) => ({
  catalog: null, model: null, imageCount: 0, bytes: 0, status: 'idle', pct: 0,
  acceptManifest: async (value, manual = false) => {
    if (get().status === 'downloading' || get().status === 'ready') return;
    const catalog = parseAssetCatalog(value, Number(Application.nativeBuildVersion), imageManifest.version);
    if (!catalog) return; // Old servers / incompatible catalogs leave the working assets alone.
    const previousRaw = await AsyncStorage.getItem(SEEN);
    if (previousRaw) {
      const previous = parseAssetCatalog(readJson(previousRaw), Number(Application.nativeBuildVersion), imageManifest.version);
      if (previous && (catalog.revision < previous.revision ||
          (catalog.revision === previous.revision && JSON.stringify(catalog) !== JSON.stringify(previous)))) return;
    }
    await initializeImages();
    const installed = await installedModelUpdate();
    const candidate = newerModel(catalog.models[0], installed, REMOTE_ASSETS.base);
    const model = candidate && candidate.revision > await rejectedModelRevision() ? candidate : null;
    const packs = pendingImageUpdates(catalog.imagePacks);
    await AsyncStorage.setItem(SEEN, JSON.stringify(catalog));
    const snooze = readJson(await AsyncStorage.getItem(SNOOZE));
    const status = !model && !packs.length ? 'idle' :
      !manual && snooze?.revision === catalog.revision && snooze.until > Date.now() ? 'snoozed' : 'available';
    set({catalog, model, imageCount: packs.length, bytes: (model?.bytes ?? 0) + packs.reduce((n,p) => n+p.bytes,0), status});
  },
  download: async () => {
    const {catalog, model, status} = get();
    if (!catalog || (status !== 'available' && status !== 'failed') || busy()) return;
    set({status: 'downloading', pct: 0});
    controller = new AbortController();
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') controller?.abort(); });
    const stopEngine = useEngineStore.subscribe(() => { if (busy()) controller?.abort(); });
    try {
      // Cache the running selection before saving a receipt for the NEXT launch.
      await installedModelUpdate();
      if (model) {
        const path = await ensureRemoteAsset(model, pct => set({pct}), controller.signal);
        const uri = path.startsWith('file:') ? path : 'file://' + path;
        const info = await getInfoAsync(uri, {md5: true});
        if (!info.exists || info.isDirectory || info.size !== model.bytes || info.md5 !== model.md5) {
          await deleteAsync(uri, {idempotent: true});
          throw new Error('Model verification failed');
        }
        if (controller.signal.aborted) throw new Error('Paused');
        await saveModelUpdate(model, catalog.minAppVersionCode, catalog.maxAppVersionCode);
      }
      if (controller.signal.aborted) throw new Error('Paused');
      await acceptImageUpdates(catalog);
      set({status: 'ready', pct: 100});
    } catch { set({status: 'failed'}); }
    finally { sub.remove(); stopEngine(); controller = null; }
  },
  snooze: async () => {
    if (get().status === 'downloading') return;
    const revision = get().catalog?.revision;
    set({status: 'snoozed'});
    await AsyncStorage.setItem(SNOOZE, JSON.stringify({revision, until: Date.now() + 7*86400000})).catch(() => {});
  },
}));
