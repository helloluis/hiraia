import assert from 'node:assert/strict';
import { test } from 'node:test';
import registryJson from './bank.generated.json';
import { readAssessmentHistory, type HistoryReadAdapter } from './historyRepository';
import { resultFor, selectAssessment } from './selection';
import { assessmentStorageKey, emptyAssessmentData } from './storage';
import type { AssessmentRegistry } from './types';

const A = 'student_A_12345678';
const B = 'student_B_12345678';
const NOW = '2026-09-28T09:30:00.000Z';
const MODE = 'local_evaluation' as const;

function saved(profileId: string): string {
  const data = emptyAssessmentData(profileId);
  const selected = selectAssessment(registryJson as unknown as AssessmentRegistry,
    { profileId, grade: 4, language: 'english' }, data, NOW, profileId, MODE);
  if (!selected.ok) throw new Error(selected.reason);
  const session = selected.session;
  session.answers = session.items.map((item) => ({ itemId: item.itemId, optionId: item.correctOptionId, answeredAt: NOW }));
  return JSON.stringify({ ...data, lastObservedAt: NOW, history: [resultFor(session, NOW, [])] });
}

function fixture(rows: Map<string, Map<string, string>>, options: { table?: boolean; failRead?: boolean } = {}) {
  const opened: string[] = [], closed: string[] = [], queries: [string, string[]][] = [], commands: string[] = [], checked: string[] = [];
  const adapter: HistoryReadAdapter = {
    directory: '/local/SQLite', knownProfileIds: new Set(['guest', A, B]),
    async exists(uri) { checked.push(uri); return rows.has(uri.split('/').at(-1)!); },
    async open(name, openOptions, directory) {
      assert.deepEqual(openOptions, { useNewConnection: true });
      assert.equal(directory, '/local/SQLite');
      opened.push(name);
      return {
        async execAsync(sql) { commands.push(sql); assert.equal(sql, 'PRAGMA query_only = ON'); },
        async getFirstAsync<T>(sql: string, ...parameters: string[]): Promise<T | null> {
          assert.equal(commands.at(-1), 'PRAGMA query_only = ON');
          queries.push([sql, parameters]);
          if (sql.includes('sqlite_master')) return (options.table === false ? null : { name: 'settings' }) as T | null;
          if (options.failRead) throw new Error('Simulated SQLite read failure');
          assert.equal(sql, 'SELECT value FROM settings WHERE key = ?');
          const value = rows.get(name)?.get(parameters[0]!);
          return (value === undefined ? null : { value }) as T | null;
        },
        async closeAsync() { closed.push(name); },
      };
    },
  };
  return { adapter, opened, closed, queries, commands, checked };
}
const dbName = (id: string) => id === 'guest' ? 'hiraia.db' : `hiraia-profile-${id}.db`;
const dbRows = (id: string, value = saved(id)) => new Map([[assessmentStorageKey(id, MODE), value]]);

test('selected profiles and guest use their own existing files, keys and separate query-only connections', async () => {
  const f = fixture(new Map([[dbName(A), dbRows(A)], [dbName(B), dbRows(B)], [dbName('guest'), dbRows('guest')]]));
  for (const id of [B, A, 'guest']) {
    const history = await readAssessmentHistory(id, MODE, f.adapter);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.session.profileId, id);
  }
  assert.deepEqual(f.opened, [dbName(B), dbName(A), 'hiraia.db']);
  assert.deepEqual(f.closed, f.opened);
  assert.equal(f.commands.length, 3);
  assert.ok(f.checked.every((uri) => uri.startsWith('file:///local/SQLite/')));
  assert.deepEqual(f.queries.filter(([sql]) => sql.includes('FROM settings')).map(([, p]) => p[0]),
    [B, A, 'guest'].map((id) => assessmentStorageKey(id, MODE)));
});

test('absent files are never opened or created; absent settings/key returns empty and closes', async () => {
  const absent = fixture(new Map());
  assert.deepEqual(await readAssessmentHistory(A, MODE, absent.adapter), []);
  assert.deepEqual(absent.opened, []);
  const old = fixture(new Map([[dbName(A), new Map()]]), { table: false });
  assert.deepEqual(await readAssessmentHistory(A, MODE, old.adapter), []);
  assert.deepEqual(old.closed, [dbName(A)]);
  const noKey = fixture(new Map([[dbName(A), new Map()]]));
  assert.deepEqual(await readAssessmentHistory(A, MODE, noKey.adapter), []);
  assert.deepEqual(noKey.closed, [dbName(A)]);
});

test('unknown or path-like profile IDs cannot inspect any file', async () => {
  const f = fixture(new Map());
  await assert.rejects(readAssessmentHistory('unknown_123456789', MODE, f.adapter), /not available/);
  const unsafe = { ...f.adapter, knownProfileIds: new Set(['../another-profile']) };
  await assert.rejects(readAssessmentHistory('../another-profile', MODE, unsafe), /not available/);
  assert.deepEqual(f.checked, []);
  assert.deepEqual(f.opened, []);
});

test('public reports do not read private evaluation keys or accept mismatched saved identities', async () => {
  const f = fixture(new Map([[dbName(A), dbRows(A)]]));
  assert.deepEqual(await readAssessmentHistory(A, 'production', f.adapter), []);
  assert.equal(f.queries.at(-1)![1][0], assessmentStorageKey(A, 'production'));
  const wrongProfile = fixture(new Map([[dbName(A), dbRows(A, saved(B))]]));
  await assert.rejects(readAssessmentHistory(A, MODE, wrongProfile.adapter), /another profile/);
  assert.deepEqual(wrongProfile.closed, [dbName(A)]);
  const wrongModeRows = new Map([[assessmentStorageKey(A, 'production'), saved(A)]]);
  const wrongMode = fixture(new Map([[dbName(A), wrongModeRows]]));
  await assert.rejects(readAssessmentHistory(A, 'production', wrongMode.adapter), /admission mode/);
  assert.deepEqual(wrongMode.closed, [dbName(A)]);
});

test('query failures and corrupt saved data close the isolated connection without a write', async () => {
  const failed = fixture(new Map([[dbName(A), dbRows(A)]]), { failRead: true });
  await assert.rejects(readAssessmentHistory(A, MODE, failed.adapter), /SQLite read failure/);
  assert.deepEqual(failed.closed, [dbName(A)]);
  const corrupt = fixture(new Map([[dbName(A), dbRows(A, '{bad json')]]));
  await assert.rejects(readAssessmentHistory(A, MODE, corrupt.adapter), /could not be read/);
  assert.deepEqual(corrupt.closed, [dbName(A)]);
  assert.deepEqual(corrupt.commands, ['PRAGMA query_only = ON']);
});
