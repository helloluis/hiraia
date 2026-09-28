/**
 * "The internet is back": the moment to retry downloads that failed for want of a network.
 *
 * Donated phones leave the provisioning warehouse part-downloaded and finish at school, on
 * whatever Wi-Fi turns up whenever it turns up, so waiting for the next launch or foreground is
 * not enough. The watching is native (modules/hiraia-managed-config, HiraiaManagedConfigModule.kt):
 * it follows the app's default network, waits a few seconds for it to settle, and fires when a
 * network arrives after none, when it passes Android's internet check (captive portal signed in,
 * uplink came up late), or when Android stops blocking the app's traffic. A network that never
 * validates still counts, because the warehouse LAN only reaches the mirror.
 *
 * Expect repeats: listeners must be safe to call at any time, as often as it fires.
 */
import { addInternetRestoredListener } from 'hiraia-managed-config';

/**
 * Call `listener` whenever the device may have just regained internet. Returns the unsubscribe
 * function (safe to call more than once). A no-op where nothing can watch (an APK built before
 * the watcher, iOS, tests): the listener is simply never called.
 */
export function subscribeInternetRestored(listener: () => void): () => void {
  let active = true;
  const stop = addInternetRestoredListener(() => {
    if (!active) return;
    // Every listener shares the one native event: a consumer that throws, or rejects, must not
    // stop the others hearing it, nor surface as an unhandled error from a network change.
    try {
      const result: unknown = listener();
      // A thenable, not `instanceof Promise`: Hermes' own async functions need not return the
      // global Promise.
      const then = (result as { then?: unknown } | null | undefined)?.then;
      if (typeof then === 'function') then.call(result, undefined, () => {});
    } catch {
      // Swallowed on purpose; see above.
    }
  });
  return () => {
    if (!active) return;
    active = false;
    stop?.();
  };
}
