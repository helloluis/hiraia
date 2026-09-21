import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-profiles-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const shim = path.join(temp, 'storage.js');
writeFileSync(
  shim,
  `export default {getItem:async()=>globalThis.profileStorage??null,setItem:async(k,v)=>{if(globalThis.failWrite)throw Error('disk full');globalThis.profileStorage=v;}}`
);
let count = 0;
async function launch() {
  const outfile = path.join(temp, `profiles-${count++}.cjs`);
  await build({
    entryPoints: [path.resolve(import.meta.dirname, '../src/profiles/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@react-native-async-storage/async-storage': shim },
  });
  return createRequire(import.meta.url)(outfile);
}
test('optional names stay local; stable profiles, duplicate names, Guest, and interrupted switches preserve identities', async () => {
  globalThis.profileStorage = null;
  let p = await launch();
  await p.initializeProfiles();
  assert.equal(p.profileSnapshot().choosing, true);
  assert.deepEqual(p.profileTelemetry(), { profile_kind: 'guest' });
  await p.selectProfile(null, ' Ana ');
  const first = JSON.parse(globalThis.profileStorage).activeId;
  assert.equal(p.profileSnapshot().activeId, 'guest', 'late old-runtime events must remain Guest');
  p = await launch();
  await p.initializeProfiles();
  assert.equal(p.activeProfile().name, 'Ana');
  assert.equal(p.needsProfileOnboarding(), true);
  assert.deepEqual(p.profileTelemetry(), { profile_kind: 'student', profile_id: first });
  assert.equal(JSON.stringify(p.profileTelemetry()).includes('Ana'), false);
  await p.finishProfileOnboarding();
  p = await launch();
  await p.initializeProfiles();
  assert.equal(p.needsProfileOnboarding(), false);
  await p.selectProfile(null, 'Ana');
  const second = JSON.parse(globalThis.profileStorage).activeId;
  assert.notEqual(first, second);
  p = await launch();
  await p.initializeProfiles();
  assert.equal(p.profileSnapshot().profiles.length, 2);
  await p.selectProfile(first);
  p = await launch();
  await p.initializeProfiles();
  assert.equal(p.profileTelemetry().profile_id, first);
  const before = globalThis.profileStorage;
  globalThis.failWrite = true;
  await assert.rejects(p.selectProfile(null, 'Ben'));
  assert.equal(globalThis.profileStorage, before);
  globalThis.failWrite = false;
  await p.selectProfile(null);
  p = await launch();
  await p.initializeProfiles();
  assert.equal(p.activeProfile(), null);
  assert.equal(p.profileSnapshot().profiles.length, 2);
  globalThis.profileStorage = '{broken';
  p = await launch();
  await assert.rejects(p.initializeProfiles());
  assert.equal(globalThis.profileStorage, '{broken');
  assert.equal(p.profileSnapshot().ready, false);
});

test('first named profile continues in this runtime; later switches still require reload', async () => {
  globalThis.profileStorage = null;
  globalThis.failWrite = false;
  const p = await launch();
  await p.initializeProfiles();
  await p.selectFirstProfile('Lina');
  const first = p.profileSnapshot().activeId;
  assert.notEqual(first, 'guest');
  assert.equal(p.activeProfile().name, 'Lina');
  assert.equal(p.profileSnapshot().hasChoice, true);
  assert.equal(p.profileSnapshot().choosing, true, 'keep the picker covering profile setup');
  assert.equal(p.needsProfileOnboarding(), true);
  p.cancelProfileChoice();
  assert.equal(p.profileSnapshot().choosing, false);
  await assert.rejects(p.selectFirstProfile('Other'));
  await p.finishProfileOnboarding();
  await p.selectProfile(null, 'Other');
  assert.equal(
    p.profileSnapshot().activeId,
    first,
    'existing runtime must not mix student identities'
  );
  const restarted = await launch();
  await restarted.initializeProfiles();
  assert.equal(restarted.activeProfile().name, 'Other');
  assert.equal(restarted.profileSnapshot().profiles.length, 2);
});

test('first Guest needs no reload; failed first writes keep the initial chooser intact', async () => {
  globalThis.profileStorage = null;
  const p = await launch();
  await p.initializeProfiles();
  globalThis.failWrite = true;
  await assert.rejects(p.selectFirstProfile('Lina'));
  assert.equal(p.profileSnapshot().hasChoice, false);
  assert.equal(p.profileSnapshot().profiles.length, 0);
  assert.equal(globalThis.profileStorage, null);
  globalThis.failWrite = false;
  await p.selectFirstProfile();
  assert.equal(p.profileSnapshot().activeId, 'guest');
  assert.equal(p.profileSnapshot().hasChoice, true);
  assert.equal(p.needsProfileOnboarding(), true);
  await p.finishProfileOnboarding();
  const restarted = await launch();
  await restarted.initializeProfiles();
  assert.equal(restarted.profileSnapshot().choosing, false);
  assert.equal(restarted.needsProfileOnboarding(), false);
});
