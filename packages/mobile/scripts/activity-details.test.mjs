import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const mobile = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-activity-'));
const connections = [];
const shim = path.join(temp, 'sqlite.js');
writeFileSync(
  shim,
  'export const openDatabaseAsync = (...args) => globalThis.__activityDB(...args);'
);
globalThis.__activityDB = (name) => {
  const db = new DatabaseSync(path.join(temp, name));
  connections.push(db);
  const adapter = {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args),
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    withExclusiveTransactionAsync: async (fn) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        await fn(adapter);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return adapter;
};
process.on('exit', () => {
  connections.forEach((db) => {
    try {
      db.close();
    } catch {}
  });
  rmSync(temp, { recursive: true, force: true });
});
const load = async (entry, plugins = []) => {
  const outfile = path.join(temp, path.basename(entry) + '.cjs');
  await build({
    entryPoints: [path.join(mobile, 'src/telemetry', entry + '.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { 'expo-sqlite': shim },
    plugins,
  });
  return createRequire(import.meta.url)(outfile);
};
const { openRepository } = await load('repository');
const { totalActivity, activityDateRange, activityWindows } = await load('activity');
const now = Date.now();
const event = (id, name, grade, extras = {}) => ({
  id,
  name,
  occurred_at: now - 1000,
  session_id: 'session-test',
  props: { grade, language: 'english', source: 'curated', card_id: 'card-a', ...extras },
});

test('upgrade preserves unknown history, backfills available grades, separates grades, and retains semester history after upload/restart', async () => {
  const db = new DatabaseSync(path.join(temp, 'hiraia-telemetry.db'));
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,queued_at INTEGER NOT NULL,event TEXT NOT NULL);
 CREATE TABLE activity(id TEXT PRIMARY KEY,occurred_at INTEGER NOT NULL,name TEXT NOT NULL,source TEXT,correct INTEGER NOT NULL);`);
  db.prepare('INSERT INTO meta VALUES(?,?)').run('activity_since', String(now - 150 * 86400000));
  db.prepare('INSERT INTO activity VALUES(?,?,?,?,?)').run(
    'legacy',
    now - 1000,
    'card_viewed',
    'curated',
    0
  );
  const pending = event('pending', 'card_viewed', 5);
  db.prepare('INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)').run(
    pending.id,
    now,
    JSON.stringify(pending)
  );
  db.close();
  let repo = await openRepository(event('session1', 'session_started', 5));
  const entries = [
    event('g5', 'card_viewed', 5),
    event('g4', 'card_viewed', 4),
    event('g4repeat', 'card_viewed', 4),
    event('q5', 'quiz_graded', 5, { correct: true }),
    event('q4', 'quiz_graded', 4, { correct: false }),
    {
      ...event('old', 'card_viewed', 5, { card_id: 'old-card' }),
      occurred_at: now - 140 * 86400000,
    },
  ];
  await repo.append(entries);
  await repo.append(entries);
  await repo.acknowledge([...entries, pending].map((e) => e.id));
  for (const c of connections) c.close();
  connections.length = 0;
  repo = await openRepository(event('session2', 'session_started', 4));
  const report = await repo.activityReport(0, now);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === 5)).cards, 3);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === 4)).cards, 2);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === 4)).distinct, 1);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === 5)).accuracy, 100);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === 4)).accuracy, 0);
  assert.equal(totalActivity(report.rows.filter((r) => r.grade === null)).cards, 1);
  assert.equal(report.days.find((r) => r.grade === 5).days, 2);
  const recent = await repo.activityReport(now - 86400000, now);
  assert.equal(totalActivity(recent.rows.filter((r) => r.grade === 5)).cards, 2);
  assert.equal((await repo.activity(now)).counts[0].cards, 5);
  assert.equal((await repo.activityReport(now + 1, now + 2)).rows.length, 0);
});
test('dates and windows use inclusive local days and reject invalid reporting ranges', () => {
  assert.equal(activityDateRange('2026-02-30', '2026-03-01'), null);
  assert.equal(activityDateRange('2026-09-05', '2026-09-04'), null);
  const [start, end] = activityDateRange('2026-09-06', '2026-09-06');
  assert.equal(start, new Date(2026, 8, 6).getTime());
  assert.equal(end, new Date(2026, 8, 7).getTime() - 1);
  assert.equal(
    activityWindows(new Date(2026, 8, 6, 12).getTime())[1],
    new Date(2026, 7, 31).getTime()
  );
  assert.equal(totalActivity([]).accuracy, null);
});
const eventsShim = path.join(temp, 'events.js');
writeFileSync(
  eventsShim,
  `let n=0;export const newId=()=>String(++n);export const telemetryPersona=()=>({...globalThis.persona});export const track=(name,props)=>globalThis.events.push({name,props});export const trackMany=items=>globalThis.events.push(...items);`
);
const views = await load('views', [
  {
    name: 'events',
    setup(b) {
      b.onResolve({ filter: /^\.\/index$/ }, () => ({ path: eventsShim }));
    },
  },
]);
test('quiz grading retains grade and language of the displayed attempt after Settings changes', () => {
  globalThis.events = [];
  globalThis.persona = { grade: 5 };
  views.showQuiz(1, 'card-a', 'english');
  globalThis.persona = { grade: 4 };
  views.gradeQuiz(1, 'card-a', 'tagalog', true);
  views.gradeQuiz(1, 'card-a', 'tagalog', true);
  const graded = globalThis.events.filter((e) => e.name === 'quiz_graded');
  assert.equal(graded.length, 1);
  assert.equal(graded[0].props.grade, 5);
  assert.equal(graded[0].props.language, 'english');
  views.gradeQuiz(2, 'card-b', 'tagalog', false);
  assert.equal(globalThis.events.at(-1).props.grade, 4);
});

test('two profiles on one device keep distinct grade totals for longer than a school year', async () => {
  const repo = await openRepository(event('profile-session', 'session_started', 5));
  const alice = 'profile_aaaaaaaaaaaaaaaa';
  const bob = 'profile_bbbbbbbbbbbbbbbb';
  await repo.append([
    {
      ...event('alice-old', 'card_viewed', 5, { profile_id: alice, profile_kind: 'student' }),
      occurred_at: now - 400 * 86400000,
    },
    event('alice-new', 'quiz_graded', 4, {
      profile_id: alice,
      profile_kind: 'student',
      correct: true,
    }),
    event('bob-new', 'card_viewed', 5, { profile_id: bob, profile_kind: 'student' }),
  ]);
  await repo.acknowledge(['alice-old', 'alice-new', 'bob-new']);
  const a = await repo.activityReport(0, now, alice);
  const b = await repo.activityReport(0, now, bob);
  assert.equal(totalActivity(a.rows).cards, 1);
  assert.equal(totalActivity(a.rows).quizzes, 1);
  assert.equal(a.rows.find((r) => r.cards).grade, 5);
  assert.equal(a.rows.find((r) => r.quizzes).grade, 4);
  assert.equal(totalActivity(b.rows).cards, 1);
  assert.equal(totalActivity(b.rows).quizzes, 0);
  assert.equal((await repo.activity(now, alice)).counts[0].cards, 0);
  assert.equal((await repo.activity(now, bob)).counts[0].cards, 1);
});
