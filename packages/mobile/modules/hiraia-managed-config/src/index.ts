import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

type Native = {
  /** The "assetMirror" managed-configuration string, unvalidated, or null. */
  assetMirror(): Promise<string | null>;
  /**
   * The event emitter every Expo module has. An APK built before the module sent
   * "onInternetRestored" still takes the listener and simply never calls it.
   */
  addListener?(event: 'onInternetRestored', listener: () => void): EventSubscription;
};

let cached: Native | null | undefined;

function managedConfigNative(): Native | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule('HiraiaManagedConfig') as Native;
  } catch {
    // An over-the-air JS update can run on an APK built before this module existed.
    cached = null;
  }
  return cached;
}

/**
 * The download mirror a device owner configured for this app, exactly as set, or null when
 * none is set or the platform cannot say. Never throws. Callers must validate the value
 * (src/config/assetMirror.ts) before using it.
 */
export async function readAssetMirrorSetting(): Promise<string | null> {
  const native = managedConfigNative();
  if (!native) return null;
  try {
    const value = await native.assetMirror();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Call `listener` whenever the phone's internet may have just come back (the rules are in
 * HiraiaManagedConfigModule.kt). Returns the unsubscribe function, or null when this build
 * cannot watch: no native module (older APK, iOS, Node tests). Never throws. Use
 * src/net/connectivity.ts rather than this.
 */
export function addInternetRestoredListener(listener: () => void): (() => void) | null {
  const native = managedConfigNative();
  if (typeof native?.addListener !== 'function') return null;
  try {
    const subscription = native.addListener('onInternetRestored', listener);
    return () => subscription.remove();
  } catch {
    return null;
  }
}
