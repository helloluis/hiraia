/**
 * IndexedDB implementation of the sync engine's LocalStore (contracts/sync.ts).
 * One database per signed-in account, three object stores: records, outbox, meta.
 * `commit` writes all three in ONE readwrite transaction, so a batch (records + outbox + meta such as the
 * `sync.mutation.*` payloads the engine relies on) is durable atomically or not at all (OFF-4, README of src/sync).
 */
import type { EntityName, Id, LocalRecord, LocalStore, OutboxItem } from '@hiraia/tala-core/contracts';

const VERSION = 1;
const RECORDS = 'records';
const OUTBOX = 'outbox';
const META = 'meta';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openDatabase(name: string, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(RECORDS)) {
        const s = db.createObjectStore(RECORDS, { keyPath: ['entity', 'id'] });
        s.createIndex('entity', 'entity', { unique: false });
      }
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'mutationId' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Could not open IndexedDB'));
    r.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export interface IdbStoreOptions {
  name?: string;
  factory?: IDBFactory;
}

export function createIdbStore(opts: IdbStoreOptions = {}): LocalStore {
  const name = opts.name ?? 'tala';
  const factory = opts.factory ?? indexedDB;
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= openDatabase(name, factory));

  return {
    async get(entity: EntityName, id: Id) {
      const tx = (await db()).transaction(RECORDS, 'readonly');
      const r = (await req(tx.objectStore(RECORDS).get([entity, id]))) as LocalRecord | undefined;
      return r ?? null;
    },
    async list(entity: EntityName, o?: { includeDeleted?: boolean }) {
      const tx = (await db()).transaction(RECORDS, 'readonly');
      const all = (await req(tx.objectStore(RECORDS).index('entity').getAll(entity))) as LocalRecord[];
      return o?.includeDeleted ? all : all.filter(r => !r.deletedAt);
    },
    async commit(batch) {
      const tx = (await db()).transaction([RECORDS, OUTBOX, META], 'readwrite');
      const records = tx.objectStore(RECORDS);
      const outbox = tx.objectStore(OUTBOX);
      const meta = tx.objectStore(META);
      try {
        for (const r of batch.put ?? []) records.put(r);
        // Physically purge acknowledged tombstones in the same transaction (deleted learners' names must not linger).
        for (const r of batch.remove ?? []) records.delete([r.entity, r.id]);
        for (const id of batch.outboxRemove ?? []) outbox.delete(id);
        for (const item of batch.outboxAdd ?? []) outbox.put(item);
        for (const [k, v] of Object.entries(batch.meta ?? {})) {
          if (v === null) meta.delete(k);
          else meta.put(v, k);
        }
      } catch (err) {
        // A synchronous failure (e.g. a value that cannot be cloned) must not let the earlier puts auto-commit.
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
        throw err;
      }
      await done(tx);
    },
    async outbox() {
      const tx = (await db()).transaction(OUTBOX, 'readonly');
      const items = (await req(tx.objectStore(OUTBOX).getAll())) as OutboxItem[];
      return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async getMeta(key: string) {
      const tx = (await db()).transaction(META, 'readonly');
      const v = (await req(tx.objectStore(META).get(key))) as string | undefined;
      return v ?? null;
    },
    async clear() {
      const tx = (await db()).transaction([RECORDS, OUTBOX, META], 'readwrite');
      tx.objectStore(RECORDS).clear();
      tx.objectStore(OUTBOX).clear();
      tx.objectStore(META).clear();
      await done(tx);
    },
  };
}

/** Delete an account's database entirely (sign-out / account deletion). */
export function deleteDatabase(name: string, factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error ?? new Error('Could not delete IndexedDB'));
    r.onblocked = () => resolve();
  });
}
