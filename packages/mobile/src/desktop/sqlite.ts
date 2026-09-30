import { desktop } from './bridge';
export const defaultDatabaseDirectory = desktop().info.paths.database;
type Params = any[];
const params = (values: Params): Params => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
export class SQLiteDatabase {
  constructor(readonly name: string) {}
  execSync(query: string): void { desktop().sync('db.query', this.name, 'exec', query); }
  getAllSync<T>(query: string, ...values: Params): T[] { return desktop().sync('db.query', this.name, 'all', query, params(values)); }
  getFirstSync<T>(query: string, ...values: Params): T | null { return desktop().sync('db.query', this.name, 'first', query, params(values)); }
  runSync(query: string, ...values: Params): { changes: number; lastInsertRowId: number } { return desktop().sync('db.query', this.name, 'run', query, params(values)); }
  async execAsync(query: string): Promise<void> { await desktop().invoke('db.query', this.name, 'exec', query); }
  async getAllAsync<T>(query: string, ...values: Params): Promise<T[]> { return desktop().invoke('db.query', this.name, 'all', query, params(values)); }
  async getFirstAsync<T>(query: string, ...values: Params): Promise<T | null> { return desktop().invoke('db.query', this.name, 'first', query, params(values)); }
  async runAsync(query: string, ...values: Params): Promise<{ changes: number; lastInsertRowId: number }> { return desktop().invoke('db.query', this.name, 'run', query, params(values)); }
  private pending = Promise.resolve();
  withExclusiveTransactionAsync<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    const run = this.pending.then(async () => {
      await this.execAsync('BEGIN IMMEDIATE');
      try { const result = await task(this); await this.execAsync('COMMIT'); return result; }
      catch (error) { await this.execAsync('ROLLBACK'); throw error; }
    });
    this.pending = run.then(() => {}, () => {});
    return run;
  }
  withTransactionAsync<T>(task: () => Promise<T>) { return this.withExclusiveTransactionAsync(task); }
}
const databases = new Map<string, SQLiteDatabase>();
export function openDatabaseSync(name: string): SQLiteDatabase {
  if (!databases.has(name)) databases.set(name, new SQLiteDatabase(name));
  return databases.get(name)!;
}
export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> { return openDatabaseSync(name); }
