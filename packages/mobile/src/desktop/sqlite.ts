import { desktop } from './bridge';
export const defaultDatabaseDirectory = desktop().info.paths.database;
type Params = any[];
type OpenOptions = { useNewConnection?: boolean };
const params = (values: Params): Params => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
export class SQLiteDatabase {
  constructor(readonly name: string, readonly connection = '') {}
  private closed = false;
  private checkOpen(): void { if (this.closed) throw new Error('The database connection is closed'); }
  execSync(query: string): void { this.checkOpen(); desktop().sync('db.query', this.name, 'exec', query, [], this.connection); }
  getAllSync<T>(query: string, ...values: Params): T[] { this.checkOpen(); return desktop().sync('db.query', this.name, 'all', query, params(values), this.connection); }
  getFirstSync<T>(query: string, ...values: Params): T | null { this.checkOpen(); return desktop().sync('db.query', this.name, 'first', query, params(values), this.connection); }
  runSync(query: string, ...values: Params): { changes: number; lastInsertRowId: number } { this.checkOpen(); return desktop().sync('db.query', this.name, 'run', query, params(values), this.connection); }
  async execAsync(query: string): Promise<void> { this.checkOpen(); await desktop().invoke('db.query', this.name, 'exec', query, [], this.connection); }
  async getAllAsync<T>(query: string, ...values: Params): Promise<T[]> { this.checkOpen(); return desktop().invoke('db.query', this.name, 'all', query, params(values), this.connection); }
  async getFirstAsync<T>(query: string, ...values: Params): Promise<T | null> { this.checkOpen(); return desktop().invoke('db.query', this.name, 'first', query, params(values), this.connection); }
  async runAsync(query: string, ...values: Params): Promise<{ changes: number; lastInsertRowId: number }> { this.checkOpen(); return desktop().invoke('db.query', this.name, 'run', query, params(values), this.connection); }
  async closeAsync(): Promise<void> {
    if (this.closed) return;
    if (!this.connection) throw new Error('Open a dedicated connection before closing it independently');
    await desktop().invoke('db.close', this.name, this.connection);
    this.closed = true;
  }
  private pending = Promise.resolve();
  withExclusiveTransactionAsync<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
    const run = this.pending.then(async () => {
      const transaction = new SQLiteDatabase(this.name, crypto.randomUUID());
      try {
        await transaction.execAsync('BEGIN IMMEDIATE');
        try { const result = await task(transaction); await transaction.execAsync('COMMIT'); return result; }
        catch (error) { await transaction.execAsync('ROLLBACK'); throw error; }
      } finally { await transaction.closeAsync(); }
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
export function openDatabaseSync(name: string, options: OpenOptions = {}, directory = defaultDatabaseDirectory): SQLiteDatabase {
  if (directory.replace(/\/+$/, '') !== defaultDatabaseDirectory.replace(/\/+$/, '')) {
    throw new Error('Databases must remain in the application database directory');
  }
  // Read-only assessment history must not set PRAGMA query_only on the shared
  // writer, or close the connection that saves the active child's next answer.
  if (options.useNewConnection) return new SQLiteDatabase(name, crypto.randomUUID());
  if (!databases.has(name)) databases.set(name, new SQLiteDatabase(name));
  return databases.get(name)!;
}
export async function openDatabaseAsync(name: string, options?: OpenOptions, directory?: string): Promise<SQLiteDatabase> {
  return openDatabaseSync(name, options, directory);
}
