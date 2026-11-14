import { NativeModules, Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import * as Network from 'expo-network';
import * as FS from 'expo-file-system/legacy';
import { MODEL } from './model';
import { modelLifecycle } from './lifecycle';
import { engineAdapter } from './adapter';
import { createNativeEngine } from './native-engine';
import type { Memory } from './types';
export const localAiBuild = Constants.expoConfig?.extra?.qvac === true;
export const localAiSupported = () =>
  localAiBuild &&
  Platform.OS === 'android' &&
  Number(Platform.Version) >= 31 &&
  !!NativeModules.TalaAiSupport;
let singleton: ReturnType<typeof createLocalAi> | null = null;
function createLocalAi() {
  const dir = `${FS.documentDirectory}local-ai/`;
  const finalPath = `${dir}${MODEL.id}.gguf`;
  const partial = `${finalPath}.part`;
  const path = (part: boolean) => (part ? partial : finalPath);
  const memory = async (): Promise<Memory> => {
    if (!localAiSupported()) throw Error('localAiUnsupported');
    return NativeModules.TalaAiSupport.memory();
  };
  const model = modelLifecycle({
    async size(part) {
      const info = await FS.getInfoAsync(path(part));
      return info.exists ? info.size : 0;
    },
    async sha256(part) {
      if (!localAiSupported()) throw Error('localAiUnsupported');
      return NativeModules.TalaAiSupport.sha256(path(part));
    },
    async install() {
      await FS.deleteAsync(finalPath, { idempotent: true });
      await FS.moveAsync({ from: partial, to: finalPath });
    },
    async remove(part) {
      await FS.deleteAsync(path(part), { idempotent: true });
    },
    free: () => FS.getFreeDiskStorageAsync(),
    async wifi() {
      return (await Network.getNetworkStateAsync()).type === Network.NetworkStateType.WIFI;
    },
    transfer(offset, progress) {
      const download = FS.createDownloadResumable(
        MODEL.url,
        partial,
        {},
        (p) => progress(p.totalBytesWritten),
        offset ? String(offset) : undefined
      );
      return {
        async run() {
          await FS.makeDirectoryAsync(dir, { intermediates: true });
          const result = offset ? await download.resumeAsync() : await download.downloadAsync();
          if (!result) throw Error('localAiCancelled');
          return { status: result.status };
        },
        async pause() {
          await download.pauseAsync();
        },
      };
    },
    path: () => finalPath,
  });
  const engine = engineAdapter({
    create: createNativeEngine,
    memory,
    verifiedPath: model.verifiedPath,
    now: Date.now,
  });
  // Preserve durable input/review, not a warm engine, when Android backgrounds/kills us.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      void model.pause().catch(() => {});
      void engine.close().catch(() => {});
    }
  });
  return { model, engine, memory };
}
export function localAi() {
  return (singleton ??= createLocalAi());
}
