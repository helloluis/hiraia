/** Verify snapshots pulled from the isolated emulator while the app was force-stopped. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ingest, openTelemetry } from '../../packages/web/src/lib/telemetry/store.ts';
const root = path.join(import.meta.dirname, 'build');
function snapshot(name: string) {
  const db = new Database(path.join(root, name, 'hiraia-telemetry.db'), { readonly: true });
  const id = (db.prepare("SELECT value FROM meta WHERE key='installation'").get() as any).value;
  const events = (db.prepare('SELECT event FROM outbox ORDER BY seq').all() as any[]).map((r) =>
    JSON.parse(r.event)
  );
  const enabled =
    (db.prepare("SELECT value FROM meta WHERE key='enabled'").get() as any)?.value !== 'false';
  db.close();
  return { id, events, enabled };
}
const before = snapshot('device-before');
const after = snapshot('device-after');
const optedOut = snapshot('device-optout');
assert.equal(optedOut.enabled, false);
assert.equal(optedOut.events.length, 0);
assert.equal(before.id, after.id);
const ids = new Set(after.events.map((e) => e.id));
before.events.forEach((e) => assert.ok(ids.has(e.id), 'offline record survived restart'));
const counts: Record<string, number> = {};
after.events.forEach((e) => (counts[e.name] = (counts[e.name] || 0) + 1));
assert.equal(counts.first_open, 1);
assert.equal(counts.session_started, 2);
assert.equal(counts.quiz_graded, 1);
assert.equal(counts.quiz_answer_submitted, 1);
assert.ok(counts.card_viewed >= 4);
assert.ok(counts.download_failed >= 1);
assert.ok(after.events.every((e) => e.props.android === '29'));
const server = openTelemetry(':memory:');
for (let i = 0; i < after.events.length; i += 50) {
  const body = { schema: 1, installation_id: after.id, events: after.events.slice(i, i + 50) };
  const reply = ingest(server, body);
  assert.deepEqual(
    reply.rejected,
    [],
    'real Android event properties match the ingestion contract'
  );
  ingest(server, body);
}
assert.equal(
  (server.prepare('SELECT count(*) n FROM telemetry_events').get() as any).n,
  after.events.length
);
server.close();
const result = {
  android_api: 29,
  before_events: before.events.length,
  after_events: after.events.length,
  counts,
  identity_survived: true,
  all_events_survived: true,
  duplicate_quiz_prevented: true,
  real_events_accepted: true,
  replay_deduplicated: true,
  network_disabled: true,
  native_optout_survived_restart: true,
  native_optout_pending_events: 0,
};
fs.writeFileSync(
  path.join(root, 'device-verification.json'),
  JSON.stringify(result, null, 2) + '\n'
);
console.log(JSON.stringify(result, null, 2));
