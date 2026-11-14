import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparedTransactions } from './prepared';
import type { Database } from './store';
test('prepared connections unlock before BEGIN, roll back failures and serialize later commits', async () => {
  const events: string[] = [];
  const main = {} as Database;
  let connection = 0;
  const db = preparedTransactions(main, async () => {
    const id = ++connection;
    events.push(`${id}:unlocked`);
    return {
      execAsync: async (sql: string) => {
        events.push(`${id}:${sql.includes('BEGIN') ? 'begin' : sql}`);
      },
      closeAsync: async () => {
        events.push(`${id}:close`);
      },
    } as Database & { closeAsync(): Promise<void> };
  });
  const first = db.withExclusiveTransactionAsync(async () => {
    events.push('1:write');
    throw Error('disk full');
  });
  const second = db.withExclusiveTransactionAsync(async () => {
    events.push('2:write');
  });
  await assert.rejects(first, /disk full/);
  await second;
  assert.deepEqual(events, [
    '1:unlocked',
    '1:begin',
    '1:write',
    '1:ROLLBACK;',
    '1:close',
    '2:unlocked',
    '2:begin',
    '2:write',
    '2:COMMIT;',
    '2:close',
  ]);
});
