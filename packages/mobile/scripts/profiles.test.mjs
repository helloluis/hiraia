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
