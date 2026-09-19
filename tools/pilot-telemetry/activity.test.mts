import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('activity survives upload, duplicate writes and restart, and uses correct date windows', async () => {
  const repo = await openRepository(event(40001));
  const now = Date.now();
  const day = 86400000;
  const monday = new Date(now); monday.setHours(0,0,0,0);
  monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
  const quarter = new Date(new Date(now).getFullYear(), Math.floor(new Date(now).getMonth()/3)*3,1).getTime();
  const card = {...event(40002, 'card_viewed'), occurred_at: now-1000, props: {source:'generated'}};
  const quiz = {...event(40003, 'quiz_graded'), occurred_at: now-2000, props: {correct:true}};
  const old = {...event(40004, 'card_viewed'), occurred_at: now-25*3600000};
  const beforeWeek = {...event(40005, 'quiz_graded'), occurred_at:monday.getTime()-1,props:{correct:false}};
  const beforeQuarter = {...event(40006, 'card_viewed'), occurred_at:quarter-1};
  const entries = [card,quiz,old,beforeWeek,beforeQuarter];
  await repo.append(entries);
  await repo.acknowledge(entries.map(e=>e.id));
  await repo.append([card,quiz]);
  await repo.acknowledge([card.id,quiz.id]);
  connections.forEach(db=>db.close()); connections=[];
  const reopened = await openRepository(event(40007));
  const result = await reopened.activity(now);
  for (const [i,start] of [now-day,monday.getTime(),quarter].entries()) {
    const included = entries.filter(e=>e.occurred_at>=start && e.occurred_at<=now && e.occurred_at>=Date.now()-100*day);
    assert.deepEqual(result.counts[i], {
      cards:included.filter(e=>e.name==='card_viewed').length,
      unique_cards:0, // Legacy events in this fixture have no card_id; never count them as unique.
      dynamic:included.filter(e=>e.name==='card_viewed' && (e.props as any).source==='generated').length,
      quizzes:included.filter(e=>e.name==='quiz_graded').length,
      correct:included.filter(e=>e.name==='quiz_graded' && (e.props as any).correct===true).length,
    });
  }
  assert.equal(result.counts[0].dynamic,1);
});
test('calendar windows handle Sunday, Monday midnight, and year/quarter boundaries', async () => {
  const windowBundle = path.join(temp,'windows.cjs');
  await build({entryPoints:[path.join(mobile,'src/telemetry/activity.ts')], outfile:windowBundle, bundle:true,platform:'node',format:'cjs'});
  const {activityWindows} = createRequire(import.meta.url)(windowBundle);
  for (const date of [new Date(2026,8,6,12),new Date(2026,8,7),new Date(2027,0,1),new Date(2026,3,1)]) {
    const [day,week,quarter] = activityWindows(date.getTime());
    assert.equal(day,date.getTime()-86400000);
    assert.equal(new Date(week).getDay(),1);
    assert.equal(new Date(week).getHours(),0);
    assert.ok(week<=date.getTime() && date.getTime()-week<7*86400000+3600000);
    assert.equal(new Date(quarter).getDate(),1);
    assert.equal(new Date(quarter).getMonth(),Math.floor(date.getMonth()/3)*3);
    assert.equal(new Date(quarter).getFullYear(),date.getFullYear());
  }
});
