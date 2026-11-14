import type { Database } from './store';
/** Expo's exclusive helper opens an unkeyed connection. Prepare ours before BEGIN. */
export function preparedTransactions(
  main: Database,
  openPrepared: () => Promise<Database & { closeAsync(): Promise<void> }>
): Database {
  let tail = Promise.resolve();
  return {
    execAsync: (sql) => main.execAsync(sql),
    runAsync: (sql, ...params) => main.runAsync(sql, ...params),
    getFirstAsync: (sql, ...params) => main.getFirstAsync(sql, ...params),
    getAllAsync: (sql, ...params) => main.getAllAsync(sql, ...params),
    withExclusiveTransactionAsync(task) {
      const work = tail.then(async () => {
        const tx = await openPrepared();
        try {
          await tx.execAsync('PRAGMA synchronous = FULL; BEGIN IMMEDIATE;');
          try {
            await task(tx);
            await tx.execAsync('COMMIT;');
          } catch (error) {
            await tx.execAsync('ROLLBACK;');
            throw error;
          }
        } finally {
          await tx.closeAsync();
        }
      });
      tail = work.catch(() => {});
      return work;
    },
  };
}
