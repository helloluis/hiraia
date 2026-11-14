import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createSqliteStore, type Database } from './store';
import { preparedTransactions } from './prepared';
let cipherVersion: string | null = null;
export function storageDiagnostics() {
  return cipherVersion;
}
export async function openStore() {
  let key = await SecureStore.getItemAsync('tala.database-key');
  if (!key) {
    key = Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    await SecureStore.setItemAsync('tala.database-key', key);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Database key unavailable');
  const db = await SQLite.openDatabaseAsync('tala.db');
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync<Record<string, string>>('PRAGMA cipher_version');
  if (!cipher || !Object.values(cipher)[0]) {
    await db.closeAsync();
    throw new Error('Encrypted storage requires a Tala development or release build');
  }
  cipherVersion = Object.values(cipher)[0];
  const prepared = preparedTransactions(db as unknown as Database, async () => {
    const tx = await SQLite.openDatabaseAsync('tala.db', { useNewConnection: true });
    try {
      await tx.execAsync(`PRAGMA key = "x'${key}'";`);
      return tx as unknown as Database & { closeAsync(): Promise<void> };
    } catch (error) {
      await tx.closeAsync();
      throw error;
    }
  });
  return createSqliteStore(prepared);
}
