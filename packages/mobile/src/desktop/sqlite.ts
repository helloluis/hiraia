import { desktop } from './bridge';
export const defaultDatabaseDirectory = desktop().info.paths.database;
type Params = any[];
const params = (values: Params): Params => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
export class SQLiteDatabase {
  constructor(readonly name: string, readonly connection = '') {}
  execSync(query: string): void { desktop().sync('db.query', this.name, 'exec', query, [], this.connection); }
  getAllSync<T>(query: string, ...values: Params): T[] { return desktop().sync('db.query', this.name, 'all', query, params(values), this.connection); }
  getFirstSync<T>(query: string, ...values: Params): T | null { return desktop().sync('db.query', this.name, 'first', query, params(values), this.connection); }
  runSync(query: string, ...values: Params): { changes: number; lastInsertRowId: number } { return desktop().sync('db.query', this.name, 'run', query, params(values), this.connection); }
  async execAsync(query: string): Promise<void> { await desktop().invoke('db.query', this.name, 'exec', query, [], this.connection); }
  async getAllAsync<T>(query: string, ...values: Params): Promise<T[]> { return desktop().invoke('db.query', this.name, 'all', query, params(values), this.connection); }
  async getFirstAsync<T>(query: string, ...values: Params): Promise<T | null> { return desktop().invoke('db.query', this.name, 'first', query, params(values), this.connection); }
  async runAsync(query: string, ...values: Params): Promise<{ changes: number; lastInsertRowId: number }> { return desktop().invoke('db.query', this.name, 'run', query, params(values), this.connection); }
  private pending = Promise.resolve();
  withExclusiveTransactionAsync<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    const run = this.pending.then(async () => {
      const transaction = new SQLiteDatabase(this.name, crypto.randomUUID());
      try {
        await transaction.execAsync('BEGIN IMMEDIATE');
        try { const result = await task(transaction); await transaction.execAsync('COMMIT'); return result; }
        catch (error) { await transaction.execAsync('ROLLBACK'); throw error; }
      } finally { await desktop().invoke('db.close', transaction.name, transaction.connection); }
    });
    this.pending = run.then(() => {}, () => {});
    return run;
  }
  async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
    await this.execAsync('BEGIN');
    try { const result = await task(); await this.execAsync('COMMIT'); return result; }
    catch (error) { await this.execAsync('ROLLBACK'); throw error; }
  }
}
const databases = new Map<string, SQLiteDatabase>();
export function openDatabaseSync(name: string): SQLiteDatabase {
  if (!databases.has(name)) databases.set(name, new SQLiteDatabase(name));
  return databases.get(name)!;
}
export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> { return openDatabaseSync(name); }
