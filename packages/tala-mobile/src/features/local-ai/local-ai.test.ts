import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { modelLifecycle, type ModelFiles } from './lifecycle';
import { engineAdapter } from './adapter';
import { rosterPrompt, rosterSuggestion } from './roster';
import { normalizeName, emptyName } from '@hiraia/tala-core/roster';
import { MODEL } from './model';
function files(
  options: { offset?: number; digest?: string; wifi?: boolean; free?: number; status?: number } = {}
) {
  let part = options.offset ?? 0,
    final = 0,
    transfers = 0,
    installs = 0,
    hashes = 0;
  const offsets: number[] = [];
  const port: ModelFiles = {
    size: async (partial) => (partial ? part : final),
    sha256: async () => {
      hashes++;
      return options.digest ?? MODEL.sha256;
    },
    install: async () => {
      final = part;
      part = 0;
      installs++;
    },
    remove: async (partial) => {
      if (partial) part = 0;
      else final = 0;
    },
    free: async () => options.free ?? 2e9,
    wifi: async () => options.wifi ?? true,
    path: () => 'file:///verified.gguf',
    transfer(offset, progress) {
      transfers++;
      offsets.push(offset);
      return {
        run: async () => {
          part = MODEL.bytes;
          progress(part);
          return { status: options.status ?? (offset ? 206 : 200) };
        },
        pause: async () => {},
      };
    },
  };
  return { port, stats: () => ({ part, final, transfers, installs, hashes, offsets }) };
}
test('model requires explicit consent and Wi-Fi by default; refusal does not transfer', async () => {
  const f = files({ wifi: false });
  const manager = modelLifecycle(f.port);
  await assert.rejects(manager.download({ optIn: false, allowMobile: true }), /localAiConsent/);
  await assert.rejects(manager.download({ optIn: true, allowMobile: false }), /localAiWifi/);
  assert.equal(f.stats().transfers, 0);
  await manager.download({ optIn: true, allowMobile: true });
  assert.equal(manager.snapshot().state, 'ready');
  assert.equal(f.stats().installs, 1);
});
test('interrupted files resume by byte offset, verify before install and again before engine load; deletion clears both', async () => {
  const f = files({ offset: 12345 });
  const manager = modelLifecycle(f.port);
  await manager.init();
  assert.equal(manager.snapshot().state, 'paused');
  await manager.download({ optIn: true, allowMobile: false });
  assert.deepEqual(f.stats().offsets, [12345]);
  assert.equal(f.stats().hashes, 1);
  assert.equal(await manager.verifiedPath(), 'file:///verified.gguf');
  assert.equal(f.stats().hashes, 2);
  await manager.remove();
  assert.equal(f.stats().final, 0);
  assert.equal(manager.snapshot().state, 'absent');
});
test('checksum mismatch and a server ignoring Range can never install a model', async () => {
  for (const options of [{ digest: 'bad' }, { offset: 20, status: 200 }]) {
    const f = files(options);
    const manager = modelLifecycle(f.port);
    await assert.rejects(manager.download({ optIn: true, allowMobile: false }));
    assert.equal(f.stats().installs, 0);
    assert.equal(f.stats().part, 0);
    assert.equal(manager.snapshot().state, 'failed');
  }
});
test('low storage does not download or remove teacher data', async () => {
  const f = files({ free: 1 });
  await assert.rejects(
    modelLifecycle(f.port).download({ optIn: true, allowMobile: false }),
    /localAiStorage/
  );
  assert.equal(f.stats().transfers, 0);
  assert.equal(f.stats().installs, 0);
});
test('engine is lazy, verifies local path, streams real adapter tokens and returns scoped metrics', async () => {
  const calls: string[] = [];
  let time = 0;
  const adapter = engineAdapter({
    create() {
      calls.push('create');
      return {
        start: async (path) => {
          calls.push(path);
        },
        complete: async (prompt, token) => {
          calls.push(prompt);
          token('Hi');
          time = 50;
          return { text: 'Hi', tokens: 1, tokensPerSecond: 20 };
        },
        cancel: async () => {
          calls.push('cancel');
        },
        close: async () => {
          calls.push('close');
        },
      };
    },
    verifiedPath: async () => {
      calls.push('verify');
      return '/private/model.gguf';
    },
    memory: async () => ({
      totalBytes: 8e9,
      availableBytes: 4e9,
      pssBytes: 100e6,
      peakPssBytes: 120e6,
      lowMemory: false,
      lowRam: false,
    }),
    now: () => time,
  });
  assert.deepEqual(calls, []);
  const tokens: string[] = [];
  const result = await adapter.complete('sample only', (t) => tokens.push(t));
  assert.deepEqual(calls.slice(0, 3), ['verify', 'create', '/private/model.gguf']);
  assert.deepEqual(tokens, ['Hi']);
  assert.equal(result.elapsedMs, 50);
  assert.equal(result.peakPssBytes, 120e6);
  await adapter.close();
  assert.equal(adapter.isLoaded(), false);
});
test('name suggestions preserve every source run, refuse expanded initials/demographics/IDs, and always require review', () => {
  const row = normalizeName('Mira J. Peña', 4);
  const proposed = {
    ...emptyName('Mira J. Peña'),
    givenName: 'Mira',
    middleName: 'J.',
    familyName: 'Peña',
  };
  const result = rosterSuggestion(row, JSON.stringify(proposed));
  assert.equal(result.status, 'needs_review');
  assert.equal(result.original, row.original);
  for (const bad of [
    { ...proposed, givenName: 'Juan' },
    { ...proposed, displayName: 'Mira Peña' },
    { ...proposed, sex: 'F' },
    { ...proposed, localId: '12345678' },
  ])
    assert.throws(() => rosterSuggestion(row, JSON.stringify(bad)), /localAiUntraceable/);
  assert.throws(() => rosterPrompt(normalizeName('LRN 12345678', 0)), /localAiUntraceable/);
});
test('native flags keep standard free of QVAC plugins and Bare autolinking; QVAC is side by side', () => {
  const cwd = process.cwd();
  function config(flag: string) {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `console.log(JSON.stringify({app:require('./app.config.js'),rn:require('./react-native.config.js')}))`,
        ],
        { cwd, env: { ...process.env, TALA_QVAC: flag }, encoding: 'utf8' }
      )
    );
  }
  const standard = config('0'),
    qvac = config('1');
  assert.equal(standard.app.android.package, 'com.hiraia.tala.next');
  assert.equal(standard.app.extra.qvac, false);
  assert.ok(!JSON.stringify(standard.app.plugins).includes('@qvac/sdk'));
  assert.equal(standard.rn.dependencies['react-native-bare-kit'].platforms.android, null);
  assert.equal(qvac.app.android.package, 'com.hiraia.tala.next.qvac');
  assert.equal(qvac.app.name, 'Tala (on-device AI)');
  assert.ok(JSON.stringify(qvac.app.plugins).includes('@qvac/sdk/expo-plugin'));
});
test('CPU inference never makes OpenCL an installation requirement', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { optionalOpenCl } = require('../../../plugins/with-local-ai-support.cjs');
  const manifest = { application: [{}] };
  optionalOpenCl(manifest);
  optionalOpenCl(manifest);
  assert.deepEqual((manifest.application[0] as Record<string, unknown>)['uses-native-library'], [
    { $: { 'android:name': 'libOpenCL.so', 'android:required': 'false' } },
  ]);
});
test('pausing an active transfer preserves partial bytes and never installs unverified data', async () => {
  const f = files();
  let finish!: (result: { status: number }) => void;
  let paused = false;
  f.port.transfer = () => ({
    run: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    pause: async () => {
      paused = true;
      finish({ status: 200 });
    },
  });
  const manager = modelLifecycle(f.port);
  const operation = manager.download({ optIn: true, allowMobile: false });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await manager.pause();
  await operation;
  assert.equal(paused, true);
  assert.equal(manager.snapshot().state, 'paused');
  assert.equal(f.stats().installs, 0);
});
