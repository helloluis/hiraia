import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
const mobile =
  process.env.PILOT_MOBILE_PATH ||
  path.resolve(import.meta.dirname, '../../packages/mobile');
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-outbox-'));
const bundle = path.join(temp, 'repository.cjs');
await build({
  entryPoints: [path.join(mobile, 'src/telemetry/repository.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { 'expo-sqlite': path.join(import.meta.dirname, 'sqlite-shim.ts') },
});
const { openRepository } = createRequire(import.meta.url)(bundle);
let connections: Database.Database[] = [];
(globalThis as any).__telemetryOpen = (name: string) => {
  const db = new Database(path.join(temp, name));
  connections.push(db);
  const adapter = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).run(...args);
    },
    async getFirstAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).get(...args);
    },
    async getAllAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).all(...args);
    },
    async withExclusiveTransactionAsync(fn: any) {
      // On a phone each of these runs on its own connection; another connection's write makes it
      // fail with SQLite's own message. Tests queue such failures here.
      const injected = (globalThis as any).__lockFailures?.shift?.();
      if (injected) throw new Error(injected);
      db.exec('BEGIN IMMEDIATE');
      try {
        await fn(adapter);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return adapter;
};
process.on('exit', () => {
  connections.forEach((db) => db.open && db.close());
  rmSync(temp, { recursive: true, force: true });
});
const event = (n: number, name = 'session_started') => ({
  id: 'event_01234567890_' + n,
  name,
  occurred_at: Date.now(),
  session_id: 'session_01234567890',
  props: { language: 'english' },
});

test('real SQLite: first launch is atomic, pending events and identity survive a fresh connection', async () => {
  const repo = await openRepository(event(1));
  const id = repo.installationId;
  assert.deepEqual(
    (await repo.list(50)).map((e: any) => e.name),
    ['first_open', 'session_started']
  );
  await repo.append([event(2, 'card_viewed')]);
  connections.forEach((db) => db.close());
  connections = [];
  const reopened = await openRepository(event(3));
  assert.equal(reopened.installationId, id);
  const events = await reopened.list(50);
  assert.equal(events.filter((e: any) => e.name === 'first_open').length, 1);
  assert.ok(events.some((e: any) => e.id === event(2).id));
  await reopened.acknowledge([event(2).id]);
  assert.equal(
    (await reopened.list(50)).some((e: any) => e.id === event(2).id),
    false
  );
});
test('real SQLite: storage cap evicts oldest events and emits a cumulative loss report', async () => {
  const repo = await openRepository(event(4));
  await repo.append(Array.from({ length: 10005 }, (_, n) => event(100 + n, 'card_viewed')));
  const db = connections.at(-1)!;
  assert.equal((db.prepare('SELECT count(*) n FROM outbox').get() as any).n, 10000);
  const report = JSON.parse(
    (db.prepare('SELECT event FROM outbox ORDER BY seq DESC LIMIT 1').get() as any).event
  );
  assert.equal(report.name, 'queue_dropped');
  assert.ok(report.props.count >= 6);
  await repo.append([event(20000, 'card_viewed')]);
  const next = JSON.parse(
    (db.prepare('SELECT event FROM outbox ORDER BY seq DESC LIMIT 1').get() as any).event
  );
  assert.ok(next.props.count > report.props.count);
});
test('real SQLite: opt-out deletes unsent data and persists across process restart', async () => {
  const repo = await openRepository(event(20001));
  await repo.setEnabled(false);
  await repo.append([event(20002)]);
  assert.deepEqual(await repo.list(50), []);
  connections.forEach((db) => db.close());
  connections = [];
  const reopened = await openRepository(event(20003));
  assert.equal(await reopened.isEnabled(), false);
  assert.deepEqual(await reopened.list(50), []);
  await reopened.setEnabled(true);
  await reopened.append([event(20004)]);
  assert.equal((await reopened.list(50)).length, 1);
});
test('real SQLite: corrupt queued JSON is discarded without blocking valid events', async () => {
  const repo = await openRepository(event(20005));
  const db = connections.at(-1)!;
  db.prepare('INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)').run(
    'corrupt_0123456789',
    Date.now(),
    '{broken'
  );
  await repo.append([event(20006, 'card_viewed')]);
  assert.ok((await repo.list(50)).some((e: any) => e.id === event(20006).id));
  assert.equal(
    (db.prepare("SELECT count(*) n FROM outbox WHERE id='corrupt_0123456789'").get() as any).n,
    0
  );
});

test('teacher reinstall restores retained semester history in pages after both upload ACKs and a restart', async () => {
  connections.forEach((db) => db.close());
  connections = [];
  rmSync(path.join(temp, 'hiraia-telemetry.db'), { force: true });
  const repo = await openRepository(event(8000));
  const scope = 'profile_1234567890123456';
  const first = { class_id: 'old-class', public_key: 'old-key', bound_at: Date.now() };
  const replacement = { class_id: 'new-class', public_key: 'new-key', bound_at: Date.now() };
  const history = Array.from({ length: 123 }, (_, i) => ({
    ...event(9000 + i, 'quiz_graded'),
    occurred_at: Date.now() - 400 * 86400000,
    props: {
      grade: 5,
      language: 'tagalog',
      correct: true,
      profile_kind: 'student',
      profile_id: 'profile_1234567890123456',
    },
  }));
  await repo.append(history);
  await repo.acknowledge(history.map((e) => e.id));
  await repo.bind(scope, first);
  async function drain(r: any) {
    const received: any[] = [];
    for (let i = 0; i < 20; i++) {
      const b = await r.binding(scope);
      const page = await r.teacherList(b, [scope], 50);
      if (!page.length) return received;
      assert.ok(page.length <= 50);
      received.push(...page);
      await r.teacherAcknowledge(
        page.map((e: any) => e.id),
        b
      );
    }
    throw new Error('Recovery did not drain');
  }
  const old = await drain(repo);
  assert.equal(old.filter((e) => history.some((h) => h.id === e.id)).length, 123);
  await repo.bind(scope, first);
  assert.equal(
    (await repo.teacherList(first, [scope], 50)).length,
    0,
    'same QR does not replay ACKed history'
  );
  await repo.bind(scope, replacement);
  const page = await repo.teacherList(replacement, [scope], 50);
  assert.equal(page.length, 50);
  await repo.teacherAcknowledge(
    page.map((e: any) => e.id),
    first
  );
  assert.equal(
    (await repo.teacherList(replacement, [scope], 50)).length,
    50,
    'old receiver ACK cannot erase new recovery'
  );
  await repo.teacherAcknowledge(
    page.map((e: any) => e.id),
    replacement
  );
  connections.forEach((db) => db.close());
  connections = [];
  const reopened = await openRepository(event(8001));
  const recovered = [...page, ...(await drain(reopened))].filter((e) =>
    history.some((h) => h.id === e.id)
  );
  assert.equal(recovered.length, 123);
  for (const e of recovered)
    assert.deepEqual(
      e,
      history.find((h) => h.id === e.id)
    );
  assert.equal((await reopened.teacherList(replacement, [scope], 50)).length, 0);
  await reopened.unbind(scope);
});

test('legacy recovery labels reconstructed history, includes grade, and obeys telemetry opt-out', async () => {
  connections.forEach((db) => db.close());
  connections = [];
  rmSync(path.join(temp, 'hiraia-telemetry.db'), { force: true });
  const repo = await openRepository(event(8100));
  const db = connections.at(-1)!;
  const id = 'legacy_recovery_123456';
  db.prepare('INSERT INTO activity VALUES(?,?,?,?,?)').run(
    id,
    Date.now() - 200 * 86400000,
    'card_viewed',
    'curated',
    0
  );
  db.prepare(
    'INSERT INTO activity_details(id,grade,language,card_id,profile_id) VALUES(?,?,?,?,?)'
  ).run(id, 6, 'cebuano', 'card-legacy', 'profile_1234567890123456');
  const scope = 'profile_1234567890123456';
  const restored = { class_id: 'restored-class', public_key: 'restored-key', bound_at: Date.now() };
  await repo.setEnabled(false);
  await repo.bind(scope, restored);
  assert.deepEqual(await repo.teacherList(restored, [scope], 50), []);
  await repo.setEnabled(true);
  const recovered = (await repo.teacherList(restored, [scope], 50)).find((e: any) => e.id === id);
  assert.equal(recovered.reconstructed, true);
  assert.equal(recovered.props.grade, 6);
  assert.equal(recovered.props.profile_id, 'profile_1234567890123456');
  assert.equal(recovered.props.profile_kind, 'student');
  await repo.unbind(scope);
});

// ---- Per-student classes (0.4.24) ----------------------------------------------------------

const ANA = 'profile_ana_0123456789';
const BEN = 'profile_ben_0123456789';
const CARA = 'profile_cara_012345678';
const X = { class_id: 'class-x', public_key: 'key-x', bound_at: 1, class_name: 'Grade 6 Mabini' };
const Y = { class_id: 'class-y', public_key: 'key-y', bound_at: 1 };
const studentEvent = (
  id: string,
  profile_id?: string,
  name = 'card_viewed',
  occurred_at = Date.now()
) => ({
  id,
  name,
  occurred_at,
  session_id: 'session_01234567890',
  props: profile_id
    ? { language: 'tagalog', profile_kind: 'student', profile_id }
    : { language: 'tagalog', profile_kind: 'guest' },
});
async function freshRepository(n: number) {
  connections.forEach((db) => db.close());
  connections = [];
  rmSync(path.join(temp, 'hiraia-telemetry.db'), { force: true });
  const repo = await openRepository(event(n));
  return { repo, db: connections.at(-1)! };
}
const ids = (events: any[]) => events.map((e) => e.id).sort();

/** A phone as 0.4.23 left it: one class for the whole phone, Ana's and Ben's history. */
function legacyPhone() {
  connections.forEach((db) => db.close());
  connections = [];
  const file = path.join(temp, 'hiraia-telemetry.db');
  rmSync(file, { force: true });
  // The exact 0.4.23 teacher schema and state: one binding in teacher_meta, a mixed-profile
  // outbox without a scope column, and the ids that class already acknowledged.
  const legacy = new Database(file);
  legacy.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE teacher_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
      queued_at INTEGER NOT NULL,event TEXT NOT NULL);
    CREATE TABLE teacher_sent(id TEXT PRIMARY KEY);
    CREATE TABLE teacher_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE activity(id TEXT PRIMARY KEY,occurred_at INTEGER NOT NULL,
      name TEXT NOT NULL,source TEXT,correct INTEGER NOT NULL);
    CREATE TABLE activity_details(id TEXT PRIMARY KEY,grade INTEGER,language TEXT,card_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'guest');
    CREATE TABLE activity_payloads(id TEXT PRIMARY KEY,event TEXT NOT NULL);`);
  legacy.prepare("INSERT INTO meta VALUES('installation','installation_0123456789')").run();
  for (const [k, v] of [
    ['class_id', X.class_id],
    ['public_key', X.public_key],
    ['bound_at', '5'],
    ['last_sync', '9'],
    ['dropped', '2'],
  ])
    legacy.prepare('INSERT INTO teacher_meta VALUES(?,?)').run(k, v);
  for (const [id, profile] of [
    ['delivered_ana_000001', ANA],
    ['pending_ana_0000001', ANA],
    ['pending_ben_0000001', BEN],
  ]) {
    legacy
      .prepare('INSERT INTO activity VALUES(?,?,?,?,?)')
      .run(id, Date.now() - 1000, 'card_viewed', 'curated', 0);
    legacy
      .prepare(
        'INSERT INTO activity_details(id,grade,language,card_id,profile_id) VALUES(?,?,?,?,?)'
      )
      .run(id, 6, 'tagalog', 'card-1', profile);
  }
  legacy.prepare("INSERT INTO teacher_sent VALUES('delivered_ana_000001')").run();
  for (const [id, profile] of [
    ['pending_ana_0000001', ANA],
    ['pending_ben_0000001', BEN],
    ['session_ben_0000001', BEN],
  ])
    legacy
      .prepare('INSERT INTO teacher_outbox(id,queued_at,event) VALUES(?,?,?)')
      .run(id, Date.now(), JSON.stringify(studentEvent(id, profile)));
  legacy.close();
}

test('0.4.23 phone: nobody inherits the phone-wide class, delivered ids stay with it, everyone is asked to re-join', async () => {
  legacyPhone();

  const repo = await openRepository(event(9100));
  const db = connections.at(-1)!;
  assert.equal(repo.installationId, 'installation_0123456789');
  assert.deepEqual(await repo.bindings(), [], 'no student inherits the old class');
  assert.equal((db.prepare('SELECT count(*) n FROM teacher_outbox').get() as any).n, 0);
  assert.deepEqual(db.prepare('SELECT key FROM teacher_meta').all(), []);
  assert.deepEqual(db.prepare('SELECT class_id,id FROM teacher_sent_scoped').all(), [
    { class_id: X.class_id, id: 'delivered_ana_000001' },
  ]);
  assert.ok((await repo.rejoinNotice(ANA)) > 0);
  assert.ok((await repo.rejoinNotice('guest')) > 0);

  // Ana re-joins the same class: only what it never received is sent again.
  await repo.bind(ANA, X);
  assert.equal(await repo.rejoinNotice(ANA), 0);
  assert.deepEqual(ids(await repo.teacherList(X, [ANA], 50)), ['pending_ana_0000001']);
  await repo.unbind(ANA);
  assert.equal(
    await repo.rejoinNotice(ANA),
    0,
    'a deliberate leave is not "the update dropped you"'
  );
  assert.ok((await repo.rejoinNotice(BEN)) > 0);

  // Idempotent: a second launch neither re-copies nor re-asks.
  db.prepare("UPDATE meta SET value=? WHERE key='teacher_rejoin_at'").run(
    String(Date.now() - 31 * 86400000)
  );
  connections.forEach((c) => c.close());
  connections = [];
  const again = await openRepository(event(9101));
  assert.equal(await again.rejoinNotice(BEN), 0, 'the notice expires after 30 days');
  assert.equal(
    (connections.at(-1)!.prepare('SELECT count(*) n FROM teacher_sent_scoped').get() as any).n,
    1
  );
});

test('0.4.23 phone: once profiles load, the old class is told who left, except whoever is back in it', async () => {
  legacyPhone();
  const INSTALL = 'installation_0123456789';
  let repo = await openRepository(event(9110));
  let db = connections.at(-1)!;
  const record = () =>
    db.prepare("SELECT value FROM meta WHERE key='teacher_legacy'").get() as
      | { value: string }
      | undefined;
  const told = async () =>
    (await repo.leaves())
      .map((t: any) => [t.class_id, t.public_key, t.wire_id, t.left_at])
      .sort((x: any[], y: any[]) => x[2].localeCompare(y[2]));
  assert.deepEqual(await repo.leaves(), [], 'nothing is decided before the profiles are known');
  const upgradedAt = JSON.parse(record()!.value).left_at;
  assert.ok(upgradedAt > 0);

  // A crash part-way through writes nothing and keeps the record for the next launch.
  db.exec(`CREATE TEMP TRIGGER crash BEFORE INSERT ON teacher_leaves WHEN NEW.wire_id='${BEN}'
    BEGIN SELECT RAISE(ABORT,'crash'); END`);
  await assert.rejects(repo.settleLegacyClass([ANA, BEN]));
  assert.deepEqual(await repo.leaves(), []);
  assert.ok(record());
  db.exec('DROP TRIGGER crash');
  // Meanwhile Ana joined the old class again.
  await repo.bind(ANA, X);

  connections.forEach((c) => c.close());
  connections = [];
  repo = await openRepository(event(9111));
  db = connections.at(-1)!;
  await repo.settleLegacyClass([ANA, BEN]);
  // Everyone 0.4.23 listed there: each profile, and the Guest as the installation. The notices
  // date from the upgrade, so they expire 30 days after it like any other leave.
  assert.deepEqual(await told(), [
    [X.class_id, X.public_key, INSTALL, upgradedAt],
    [X.class_id, X.public_key, BEN, upgradedAt],
  ]);
  assert.equal(record(), undefined, 'settled once');
  await repo.settleLegacyClass([ANA, BEN, CARA]);
  assert.equal((await told()).length, 2, 'a rerun, even with a newer profile, adds nothing');

  // Ben moves on: his notice stays. The Guest comes back to the old class: its notice goes.
  await repo.bind(BEN, Y);
  await repo.bind('guest', X);
  assert.deepEqual(await told(), [[X.class_id, X.public_key, BEN, upgradedAt]]);
  db.prepare('UPDATE teacher_leaves SET left_at=?').run(upgradedAt - 31 * 86400000);
  assert.deepEqual(await repo.leaves(), [], 'undelivered, it expires like any leave');
});

test('fresh install: the migration is a no-op and asks nobody to re-join', async () => {
  const { repo, db } = await freshRepository(9200);
  assert.deepEqual(await repo.bindings(), []);
  assert.equal(await repo.rejoinNotice('guest'), 0);
  assert.ok(
    (db.prepare("SELECT value FROM meta WHERE key='teacher_scoped_v1'").get() as any).value
  );
  const columns = db.prepare('PRAGMA table_info(teacher_outbox)').all() as any[];
  assert.ok(columns.some((c) => c.name === 'scope'));
  await repo.settleLegacyClass([ANA]);
  assert.deepEqual(await repo.leaves(), [], 'no old class, nobody to report');
});

test('per-student bind, leave and tombstones; the Guest leaves as the installation id', async () => {
  const { repo, db } = await freshRepository(9300);
  await repo.bind(ANA, X);
  await repo.bind(BEN, X);
  await repo.bind('guest', Y);
  assert.deepEqual(
    (await repo.bindings()).map((b: any) => [b.scope, b.class_id, b.class_name]),
    [
      ['guest', Y.class_id, ''],
      [ANA, X.class_id, 'Grade 6 Mabini'],
      [BEN, X.class_id, 'Grade 6 Mabini'],
    ]
  );
  await repo.teacherAppend([
    studentEvent('leave_ana_card_0001', ANA),
    studentEvent('stay_ben_card_00001', BEN),
  ]);
  await repo.unbind(ANA);
  await repo.unbind('guest');
  assert.equal(await repo.binding(ANA), null);
  assert.deepEqual(ids(await repo.teacherList(X, [ANA, BEN], 50)), ['stay_ben_card_00001']);
  assert.deepEqual(
    (await repo.leaves()).map((t: any) => [t.class_id, t.public_key, t.wire_id]),
    [
      [X.class_id, X.public_key, ANA],
      [Y.class_id, Y.public_key, repo.installationId],
    ]
  );
  await repo.bind(ANA, X);
  assert.deepEqual(
    (await repo.leaves()).map((t: any) => t.wire_id),
    [repo.installationId],
    're-joining cancels an undelivered leave'
  );
  await repo.clearLeaves(Y.class_id, [repo.installationId]);
  assert.deepEqual(await repo.leaves(), []);
  await repo.unbind(BEN);
  db.prepare('UPDATE teacher_leaves SET left_at=?').run(Date.now() - 31 * 86400000);
  assert.deepEqual(await repo.leaves(), [], 'undelivered leaves expire after 30 days');
  await repo.setClassName(X, '  Grade 6 - Rizal ');
  assert.equal((await repo.binding(ANA)).class_name, 'Grade 6 - Rizal');
});

test('events route to their own student; caps and loss reports are per student', async () => {
  const { repo } = await freshRepository(9400);
  await repo.bind(ANA, X);
  await repo.bind(BEN, X);
  await repo.bind('guest', Y);
  await repo.teacherAppend([
    studentEvent('route_ana_card_0001', ANA),
    studentEvent('route_ben_card_0001', BEN),
    studentEvent('route_guest_card_001'),
    studentEvent('route_cara_card_001', CARA),
    {
      ...studentEvent('route_ben_drop_0001', BEN, 'queue_dropped'),
      props: { count: 3, profile_kind: 'student', profile_id: BEN },
    },
  ]);
  const x = await repo.teacherList(X, [ANA, BEN], 50);
  assert.deepEqual(
    x
      .filter((e: any) => e.name !== 'queue_dropped')
      .map((e: any) => e.id)
      .sort(),
    ['route_ana_card_0001', 'route_ben_card_0001']
  );
  const report = x.find((e: any) => e.name === 'queue_dropped');
  assert.deepEqual(report.props, { count: 3, profile_kind: 'student', profile_id: BEN });
  assert.equal((await repo.binding(BEN)).dropped, 3);
  assert.equal((await repo.binding(ANA)).dropped, 0);
  assert.deepEqual(ids(await repo.teacherList(Y, ['guest'], 50)), ['route_guest_card_001']);
  assert.deepEqual(await repo.teacherList(Y, [ANA], 50), [], 'Ana is not in class Y');
});

test('history pages per class: only its students, minus what that class already has', async () => {
  const { repo, db } = await freshRepository(9500);
  const old = Date.now() - 50 * 86400000;
  // This phone has recorded who used it since before this history.
  const attributed = old - 86400000;
  db.prepare("UPDATE meta SET value=? WHERE key='activity_details_since'").run(String(attributed));
  await repo.append([
    studentEvent('hist_ana_card_00001', ANA, 'card_viewed', old),
    studentEvent('hist_ben_card_00001', BEN, 'card_viewed', old + 1),
    studentEvent('hist_guest_card_0001', undefined, 'card_viewed', old + 2),
    studentEvent('hist_cara_card_0001', CARA, 'card_viewed', old + 3),
  ]);
  // A Guest row whose payload is gone is rebuilt with Guest identity.
  db.prepare('INSERT INTO activity(id,occurred_at,name,source,correct) VALUES(?,?,?,?,?)').run(
    'hist_guest_rebuilt_1',
    old + 4,
    'quiz_graded',
    '',
    1
  );
  db.prepare("INSERT INTO activity_details(id,profile_id) VALUES(?,'guest')").run(
    'hist_guest_rebuilt_1'
  );
  await repo.bind(ANA, X);
  await repo.bind('guest', X);
  await repo.bind(CARA, Y);
  assert.deepEqual(ids(await repo.teacherList(X, [ANA, 'guest'], 50)), [
    'hist_ana_card_00001',
    'hist_guest_card_0001',
    'hist_guest_rebuilt_1',
  ]);
  const rebuilt = (await repo.teacherList(X, [ANA, 'guest'], 50)).find(
    (e: any) => e.id === 'hist_guest_rebuilt_1'
  );
  assert.equal(rebuilt.reconstructed, true);
  assert.deepEqual(rebuilt.props, { profile_kind: 'guest', correct: true });
  assert.deepEqual(ids(await repo.teacherList(Y, [CARA], 50)), ['hist_cara_card_0001']);
  await repo.teacherAcknowledge(['hist_ana_card_00001'], X);
  assert.deepEqual(ids(await repo.teacherList(X, [ANA], 50)), []);
  // Moving Ana to class Y sends her history there too; class X keeps its record.
  await repo.bind(ANA, Y);
  assert.deepEqual(ids(await repo.teacherList(Y, [ANA, CARA], 50)), [
    'hist_ana_card_00001',
    'hist_cara_card_0001',
  ]);
  await repo.bind(ANA, X);
  assert.deepEqual(ids(await repo.teacherList(X, [ANA], 50)), [], 'back in X: nothing is resent');
});

test('history with no known owner is sent to no class, not to whichever class the Guest joins', async () => {
  const { repo, db } = await freshRepository(9550);
  const since = Date.now() - 20 * 86400000;
  db.prepare("UPDATE meta SET value=? WHERE key='activity_details_since'").run(String(since));
  const row = (id: string, occurred_at: number, name = 'card_viewed') =>
    db
      .prepare('INSERT INTO activity(id,occurred_at,name,source,correct) VALUES(?,?,?,?,?)')
      .run(id, occurred_at, name, 'curated', 0);
  // Before profiles were recorded: the column's default says 'guest' but means "anyone".
  row('pre_profiles_row_001', since - 30 * 86400000);
  db.prepare('INSERT INTO activity_details(id,grade,language,card_id) VALUES(?,?,?,?)').run(
    'pre_profiles_row_001',
    6,
    'tagalog',
    'card-1'
  );
  // Backfilled from a pre-profile build's queue: its payload names nobody either.
  await repo.append([
    { ...studentEvent('pre_profiles_row_002', undefined, 'quiz_graded', since - 5000), props: {} },
  ]);
  // No details row at all, even after profiles existed: nobody is named.
  row('no_details_row_0001', since + 1000);
  // After profiles were recorded, the Guest's own history is still the Guest's.
  await repo.append([studentEvent('guest_own_row_00001', undefined, 'card_viewed', since + 2000)]);

  await repo.bind('guest', Y);
  assert.deepEqual(ids(await repo.teacherList(Y, ['guest'], 50)), ['guest_own_row_00001']);
  await repo.teacherAcknowledge(['guest_own_row_00001'], Y);
  assert.deepEqual(await repo.teacherList(Y, ['guest'], 50), []);
  // This phone's own Guest statistics still count all of it; only sending is limited.
  const local = (await repo.activityReport(0, Date.now(), 'guest')).rows;
  assert.equal(
    local.reduce((n: number, r: any) => n + r.cards + r.quizzes, 0),
    4
  );
  // Nothing of it reaches a named student's class either.
  await repo.bind(ANA, X);
  assert.deepEqual(await repo.teacherList(X, [ANA], 50), []);
});

test('ACKs are idempotent, count rejections per student, and never clear a newer class’s queue', async () => {
  const { repo, db } = await freshRepository(9600);
  await repo.bind(ANA, X);
  await repo.bind(BEN, X);
  await repo.teacherAppend([
    studentEvent('ack_ana_card_000001', ANA),
    studentEvent('ack_ben_card_000001', BEN),
  ]);
  const sent = ['ack_ana_card_000001', 'ack_ben_card_000001'];
  await repo.teacherAcknowledge(sent, X, ['ack_ben_card_000001']);
  await repo.teacherAcknowledge(sent, X, ['ack_ben_card_000001']);
  assert.deepEqual(await repo.teacherList(X, [ANA, BEN], 50), []);
  assert.equal((await repo.binding(BEN)).dropped, 1, 'a repeated ACK is not a second loss');
  assert.equal((await repo.binding(ANA)).dropped, 0);
  assert.equal((db.prepare('SELECT count(*) n FROM teacher_sent_scoped').get() as any).n, 2);

  await repo.teacherAppend([studentEvent('ack_ana_card_000002', ANA)]);
  await repo.bind(ANA, Y);
  await repo.teacherAppend([studentEvent('ack_ana_card_000003', ANA)]);
  await repo.teacherAcknowledge(['ack_ana_card_000003'], X);
  assert.deepEqual(
    ids(await repo.teacherList(Y, [ANA], 50)),
    ['ack_ana_card_000003'],
    'a late ACK from the old class leaves the new class’s queue alone'
  );
  await repo.setLastSync([ANA, BEN], 1234);
  assert.equal((await repo.binding(BEN)).last_sync, 1234);
});

test('one busy student cannot evict a classmate’s unsent events', async () => {
  const { repo, db } = await freshRepository(9700);
  await repo.bind(ANA, X);
  await repo.bind(BEN, X);
  await repo.teacherAppend([studentEvent('cap_ben_card_0000001', BEN)]);
  await repo.teacherAppend(
    Array.from({ length: 20_002 }, (_, i) =>
      studentEvent(`cap_ana_card_${String(i).padStart(7, '0')}`, ANA)
    )
  );
  const count = (scope: string) =>
    (db.prepare('SELECT count(*) n FROM teacher_outbox WHERE scope=?').get(scope) as any).n;
  assert.equal(count(ANA), 20_000, '19,999 newest events plus one loss report');
  assert.equal(count(BEN), 1);
  assert.equal((await repo.binding(ANA)).dropped, 3);
  const report = JSON.parse(
    (
      db
        .prepare('SELECT event FROM teacher_outbox WHERE scope=? ORDER BY seq DESC LIMIT 1')
        .get(ANA) as any
    ).event
  );
  assert.deepEqual(report.props, { count: 3, profile_kind: 'student', profile_id: ANA });
});

// ---- OTA rollback safety -------------------------------------------------------------------

test('every INSERT names its columns: older JS must write to tables a later update widened', () => {
  const source = readFileSync(path.join(mobile, 'src/telemetry/repository.ts'), 'utf8');
  const inserts = [...source.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\b/g)];
  assert.ok(inserts.length > 20);
  const positional = [...source.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\b(?!\s*\()/g)];
  assert.deepEqual(
    positional.map((m) => m[0]),
    [],
    'SQLite rejects a positional INSERT once its table has more columns'
  );
});

test('OTA rollback: this JS still records, syncs and migrates on tables a later update widened', async () => {
  // A crash on launch or --rollback-to-embedded runs the APK's embedded JS against whatever a
  // later update migrated, and no update can patch that JS. Updates may only add tables and
  // nullable/defaulted columns (BUILD.md); this is what that promise needs from this code.
  legacyPhone();
  await openRepository(event(9900));
  let db = connections.at(-1)!;
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.ok(tables.includes('teacher_leaves') && tables.includes('activity_payloads'));
  for (const table of tables)
    db.exec(`ALTER TABLE ${table} ADD COLUMN zz_later TEXT;
      ALTER TABLE ${table} ADD COLUMN zz_flag INTEGER NOT NULL DEFAULT 0`);
  // Run every one-shot migration and the first launch again, on the wider tables.
  db.exec(`DELETE FROM meta WHERE key IN ('activity_since','activity_details_since',
    'activity_payloads_since','teacher_scoped_v1','installation')`);
  db.prepare("INSERT INTO teacher_meta(key,value) VALUES('class_id',?),('public_key',?)").run(
    X.class_id,
    X.public_key
  );
  db.prepare('INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)').run(
    'queued_card_0000001',
    Date.now(),
    JSON.stringify(studentEvent('queued_card_0000001', ANA))
  );
  connections.forEach((c) => c.close());
  connections = [];
  const repo = await openRepository(event(9901));
  db = connections.at(-1)!;
  await repo.settleLegacyClass([ANA, BEN]);
  assert.equal((await repo.leaves()).length, 3);

  await repo.append([
    studentEvent('widened_card_000001', ANA),
    { ...studentEvent('widened_quiz_000001', undefined, 'quiz_graded'), props: { correct: true } },
    { ...event(9902, 'queue_dropped'), props: { count: 2 } },
  ]);
  db.prepare('INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)').run(
    'widened_corrupt_0001',
    Date.now(),
    '{broken'
  );
  const listed = (await repo.list(50)).map((e: any) => e.id);
  assert.ok(listed.includes('widened_card_000001') && listed.includes('widened_quiz_000001'));
  await repo.acknowledge(listed);
  await repo.setRetryAt(Date.now() + 3 * 86400000);
  assert.ok((await repo.retryAt()) <= Date.now() + 3600000, 'a far-future retry is pulled in');
  await repo.setEnabled(false);
  await repo.setEnabled(true);
  assert.equal(await repo.isEnabled(), true);

  await repo.bind(ANA, X);
  await repo.bind(ANA, X);
  await repo.bind(BEN, Y);
  await repo.teacherAppend([
    studentEvent('widened_live_000001', ANA),
    {
      ...studentEvent('widened_drop_000001', BEN, 'queue_dropped'),
      props: { count: 1, profile_kind: 'student', profile_id: BEN },
    },
  ]);
  const page = await repo.teacherList(X, [ANA], 50);
  assert.ok(ids(page).includes('widened_card_000001'), 'history paged in');
  assert.ok(ids(page).includes('widened_live_000001'));
  await repo.teacherAcknowledge(ids(page), X, [page[0].id]);
  await repo.setLastSync([ANA], 1234);
  await repo.setClassName(X, 'Grade 6 Rizal');
  assert.equal((await repo.binding(ANA)).class_name, 'Grade 6 Rizal');
  await repo.unbind(BEN);
  await repo.clearLeaves(Y.class_id, [BEN]);
  assert.equal(await repo.rejoinNotice(ANA), 0);
  assert.ok((await repo.activity(Date.now(), ANA)).counts[0]!.cards >= 1);
  assert.ok((await repo.activityReport(0, Date.now())).rows.length >= 1);
});

test('a write that meets another connection’s write is retried, not dropped', async () => {
  const repo = await openRepository(event(9101));
  const locked = 'Call to function NativeStatement.runAsync has been rejected. Caused by: Error code 5: database is locked';
  (globalThis as any).__lockFailures = [locked, locked, locked];
  await repo.append([event(9102, 'card_viewed')]);
  assert.equal((globalThis as any).__lockFailures.length, 0, 'every injected lock was hit');
  assert.ok((await repo.list(100)).some((e: any) => e.id === 'event_01234567890_9102'));
  // Anything else still surfaces at once.
  (globalThis as any).__lockFailures = ['no such table: nowhere'];
  await assert.rejects(repo.append([event(9103, 'card_viewed')]), /no such table/);
  (globalThis as any).__lockFailures = [];
});
