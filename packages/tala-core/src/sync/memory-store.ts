import type { LocalStore, LocalRecord, OutboxItem } from '../contracts/sync';
/** JSON records are detached at both boundaries, just like a database adapter. */
export const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
export function createMemoryStore(): LocalStore {
    let records = new Map<string, LocalRecord>();
    let queue = new Map<string, OutboxItem>();
    let meta = new Map<string, string>();
    const key = (entity: string, id: string) => JSON.stringify([entity, id]);
    return {
        async get(entity, id) { return copy(records.get(key(entity, id)) ?? null); },
        async list(entity, opts) {
            return copy([...records.values()].filter(r => r.entity === entity && (opts?.includeDeleted || !r.deletedAt)));
        },
        async commit(batch) {
            // Clone everything before publishing anything: serialization failure cannot partially commit.
            const b = copy(batch);
            const nextRecords = new Map(records), nextQueue = new Map(queue), nextMeta = new Map(meta);
            for (const r of b.put ?? [])
                nextRecords.set(key(r.entity, r.id), r);
            for (const r of b.remove ?? [])
                nextRecords.delete(key(r.entity, r.id));
            for (const id of b.outboxRemove ?? [])
                nextQueue.delete(id);
            for (const item of b.outboxAdd ?? [])
                nextQueue.set(item.mutationId, item);
            for (const [k, v] of Object.entries(b.meta ?? {}))
                v === null ? nextMeta.delete(k) : nextMeta.set(k, v);
            records = nextRecords;
            queue = nextQueue;
            meta = nextMeta;
        },
        async outbox() { return copy([...queue.values()]); },
        async getMeta(k) { return meta.get(k) ?? null; },
        async clear() { records.clear(); queue.clear(); meta.clear(); },
    };
}
