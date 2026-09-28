// "The internet is back" (src/net/connectivity.ts over modules/hiraia-managed-config). The
// watching itself is Kotlin and cannot run here; these tests pin the JS half against a fake
// native emitter, the silent no-op wherever nothing can watch, and that the JS and Kotlin halves
// (and the copy of the module the app is actually built from) agree.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Connectivity = typeof import('../src/net/connectivity.ts');

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = path.join(mobile, 'modules/hiraia-managed-config');
const indexFile = path.join(moduleDir, 'src/index.ts');
const connectivityFile = path.join(mobile, 'src/net/connectivity.ts');
const kotlinFile = path.join(
  moduleDir,
  'android/src/main/java/expo/modules/hiraiamanagedconfig/HiraiaManagedConfigModule.kt'
);

// expo-modules-core stands in for the native side, and hiraia-managed-config is the module's
// own source rather than the installed copy (the last test holds the two together).
const mockDir = mkdtempSync(path.join(tmpdir(), 'hiraia-connectivity-'));
process.on('exit', () => rmSync(mockDir, { recursive: true, force: true }));
const expoCore = path.join(mockDir, 'expo-modules-core.cjs');
writeFileSync(
  expoCore,
  'exports.requireNativeModule = (name) => globalThis.__connectivity.requireNativeModule(name);'
);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-modules-core')
      return { url: pathToFileURL(expoCore).href, shortCircuit: true };
    if (specifier === 'hiraia-managed-config')
      return { url: pathToFileURL(indexFile).href, shortCircuit: true };
    return next(specifier, context);
  },
});

/**
 * Expo's native event emitter as JS sees it, including the one behaviour that matters here: a
 * listener that throws ends the dispatch, so the listeners after it never hear the event.
 */
function fakeNative() {
  const listeners: { event: string; fn: () => void }[] = [];
  const log = { subscribed: [] as string[], removed: 0 };
  return {
    log,
    listening: () => listeners.length,
    emit(event: string) {
      for (const l of [...listeners]) if (l.event === event) l.fn();
    },
    module: {
      assetMirror: async () => null,
      addListener(event: string, fn: () => void) {
        const entry = { event, fn };
        listeners.push(entry);
        log.subscribed.push(event);
        return {
          remove() {
            log.removed++;
            const i = listeners.indexOf(entry);
            if (i >= 0) listeners.splice(i, 1);
          },
        };
      },
    },
  };
}

let loads = 0;
/** Both files afresh (they load as CommonJS), so the module's cached native lookup starts over. */
async function load(requireNativeModule: (name: string) => unknown): Promise<Connectivity> {
  (globalThis as any).__connectivity = { requireNativeModule };
  const cache = createRequire(import.meta.url).cache;
  delete cache[indexFile];
  delete cache[connectivityFile];
  return import(`${pathToFileURL(connectivityFile).href}?load=${++loads}`);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('every subscriber hears the native event until it unsubscribes', async () => {
  const native = fakeNative();
  const { subscribeInternetRestored } = await load((name) => {
    assert.equal(name, 'HiraiaManagedConfig');
    return native.module;
  });
  let a = 0,
    b = 0;
  const stopA = subscribeInternetRestored(() => a++);
  const stopB = subscribeInternetRestored(() => b++);
  assert.deepEqual(native.log.subscribed, ['onInternetRestored', 'onInternetRestored']);

  native.emit('onInternetRestored');
  native.emit('somethingElse');
  assert.deepEqual([a, b], [1, 1]);

  stopA();
  native.emit('onInternetRestored');
  assert.deepEqual([a, b], [1, 2]);

  // The last one out removes the last native listener, which is what stops the native watch.
  stopB();
  assert.equal(native.listening(), 0);
  native.emit('onInternetRestored');
  assert.deepEqual([a, b], [1, 2]);

  // Unsubscribing twice (a cleanup that runs again) must not remove anything a second time.
  stopA();
  stopB();
  assert.equal(native.log.removed, 2);
});

test('a consumer that throws or rejects does not stop the others hearing it', async () => {
  const native = fakeNative();
  const { subscribeInternetRestored } = await load(() => native.module);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    let heard = 0;
    subscribeInternetRestored(() => {
      throw new Error('consumer bug');
    });
    subscribeInternetRestored(async () => {
      throw new Error('download failed');
    });
    // A thenable that is not a Promise, as a Hermes async function may return.
    let thenableRejected = false;
    subscribeInternetRestored((() => ({
      then: (_ok: unknown, fail?: (e: unknown) => void) => {
        thenableRejected = typeof fail === 'function';
      },
    })) as unknown as () => void);
    subscribeInternetRestored(() => heard++);

    assert.doesNotThrow(() => native.emit('onInternetRestored'));
    await settle();
    await settle();
    assert.equal(heard, 1);
    assert.equal(thenableRejected, true, 'a thenable result must get a rejection handler');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('where nothing can watch, subscribing is a silent no-op', async () => {
  const cases: [string, (name: string) => unknown][] = [
    [
      'no native module (older APK, iOS)',
      () => {
        throw new Error("Cannot find native module 'HiraiaManagedConfig'");
      },
    ],
    ['a native module without an event emitter', () => ({ assetMirror: async () => null })],
    [
      'an emitter that refuses the listener',
      () => ({
        assetMirror: async () => null,
        addListener() {
          throw new Error('unsupported event');
        },
      }),
    ],
  ];
  for (const [label, requireNativeModule] of cases) {
    const { subscribeInternetRestored } = await load(requireNativeModule);
    let heard = 0;
    let stop: () => void = () => {};
    assert.doesNotThrow(() => {
      stop = subscribeInternetRestored(() => heard++);
    }, label);
    assert.equal(typeof stop, 'function', label);
    assert.doesNotThrow(() => stop(), label);
    assert.doesNotThrow(() => stop(), label);
    assert.equal(heard, 0, label);
  }
});

test('the Kotlin module sends, declares and watches for the event JS listens to', async () => {
  const native = fakeNative();
  const { subscribeInternetRestored } = await load(() => native.module);
  subscribeInternetRestored(() => {})();
  const [event] = native.log.subscribed;

  const kotlin = readFileSync(kotlinFile, 'utf8');
  const constant = new RegExp(`const val (\\w+) = "${event}"`).exec(kotlin)?.[1];
  assert.ok(constant, `HiraiaManagedConfigModule.kt must name the "${event}" event`);
  for (const use of ['Events', 'OnStartObserving', 'OnStopObserving', 'sendEvent'])
    assert.ok(kotlin.includes(`${use}(${constant})`), `${use}(${constant}) missing from the module`);

  const manifest = readFileSync(path.join(moduleDir, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /<uses-permission android:name="android\.permission\.ACCESS_NETWORK_STATE"/);
});

test('the app builds from the module source, not a stale install copy', (t) => {
  // pnpm installs a file: dependency as a copy (hard links) made at install time. Metro and
  // Gradle read that copy, so a module file replaced rather than edited in place, or a file
  // added since, silently ships the old version.
  const installed = path.join(mobile, 'node_modules/hiraia-managed-config');
  if (!existsSync(installed)) return t.skip('hiraia-managed-config is not installed');
  const copy = realpathSync(installed);
  const walk = (dir: string): string[] =>
    readdirSync(path.join(moduleDir, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory())
        return rel === path.join('android', 'build') || entry.name === 'node_modules' ? [] : walk(rel);
      return [rel];
    });
  const files = walk('');
  assert.ok(files.includes(path.join('src', 'index.ts')));
  for (const rel of files) {
    const target = path.join(copy, rel);
    assert.ok(
      existsSync(target) && readFileSync(target).equals(readFileSync(path.join(moduleDir, rel))),
      `node_modules/hiraia-managed-config/${rel} is not the module source: re-install the module ` +
        '(pnpm copied it at install time), or the APK builds the old file'
    );
  }
});
