import AsyncStorage from '@react-native-async-storage/async-storage';
import { documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import * as Application from 'expo-application';
import images from '../generated/imagePacks.generated.json';
import { parseAssetCatalog, type ModelUpdate } from './catalog';

const KEY = 'hiraia.model-update.v1';
let loaded: Promise<ModelUpdate | null> | undefined;
/** Only a fully downloaded receipt is activated; a running model stays mapped until next load. */
export function installedModelUpdate(): Promise<ModelUpdate | null> {
  return loaded ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;
      const catalog = parseAssetCatalog(JSON.parse(raw), Number(Application.nativeBuildVersion), images.version);
      const model = catalog?.models[0];
      if (!model) return null;
      const info = await getInfoAsync(`${documentDirectory}models/${model.filename}`);
      return info.exists && !info.isDirectory && info.size === model.bytes ? model : null;
    } catch { return null; }
  })();
}
export async function saveModelUpdate(model: ModelUpdate, min: number, max: number): Promise<void> {
  const previous = await AsyncStorage.getItem(KEY);
  let prior: ModelUpdate | undefined;
  try { prior = previous ? parseAssetCatalog(JSON.parse(previous), Number(Application.nativeBuildVersion), images.version)?.models[0] : undefined; }
  catch { /* A damaged prior receipt is not a usable rollback target. */ }
  if (previous && prior && prior.md5 !== model.md5) {
    await AsyncStorage.setItem(KEY + '.previous', previous);
  }
  await AsyncStorage.setItem(KEY, JSON.stringify({format: 1, revision: model.revision,
    minAppVersionCode: min, maxAppVersionCode: max, imageBaseline: images.version, models: [model], imagePacks: []}));
  // Deliberately retain this process's selection. Next app launch reads the new receipt.
}

export async function rejectedModelRevision(): Promise<number> {
  const revision = Number(await AsyncStorage.getItem(KEY + '.rejected') ?? 0);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

/** A runtime load failure rolls back the receipt; keep both immutable files for recovery. */
export async function rejectModelUpdate(model: ModelUpdate): Promise<void> {
  await AsyncStorage.setItem(KEY + '.rejected', String(model.revision));
  // A newer download may have finished while the old model was loading. Never
  // roll that unrelated receipt back because this load failed.
  const current = await AsyncStorage.getItem(KEY);
  if (current) {
    const active = JSON.parse(current).models?.[0];
    if (active?.revision !== model.revision || active?.md5 !== model.md5) return;
  }
  const previous = await AsyncStorage.getItem(KEY + '.previous');
  if (previous) await AsyncStorage.setItem(KEY, previous);
  else await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem(KEY + '.previous');
  loaded = undefined;
}
