/**
 * Small key→JSON cache on IndexedDB for reference data that is not a synced record: curriculum index and packs,
 * calendar presets, client config, the signed-in user. Saved data renders first; refresh happens in the background.
 */
export interface KvCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  clear(): Promise<void>;
}

const STORE = 'kv';

function open(name: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Could not open cache'));
  });
}
const wait = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function createIdbCache(name = 'tala-cache', factory: IDBFactory = indexedDB): KvCache {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= open(name, factory));
  return {
    async get<T>(key: string) {
      const v = (await wait((await db()).transaction(STORE).objectStore(STORE).get(key))) as T | undefined;
      return v ?? null;
    },
    async set(key, value) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    },
    async remove(key) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await new Promise<void>(res => (tx.oncomplete = () => res()));
    },
    async keys(prefix) {
      const all = (await wait((await db()).transaction(STORE).objectStore(STORE).getAllKeys())) as IDBValidKey[];
      return all.map(String).filter(k => k.startsWith(prefix));
    },
    async clear() {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await new Promise<void>(res => (tx.oncomplete = () => res()));
    },
  };
}

export function createMemoryCache(): KvCache {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return (m.get(k) as T | undefined) ?? null;
    },
    async set(k, v) {
      m.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(k) {
      m.delete(k);
    },
    async keys(prefix) {
      return [...m.keys()].filter(k => k.startsWith(prefix));
    },
    async clear() {
      m.clear();
    },
  };
}
