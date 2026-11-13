import { ENTITY_NAMES, RecordEnvelopeSchema, parseRecordData } from '../contracts/records';
import type { EntityName, RecordData, RecordEnvelope, PlanSection, Plan } from '../contracts/records';
import { CONFLICT_POLICY, PullResponse, PushResponse } from '../contracts/sync';
import type { CreateSyncEngine, LocalRecord, Mutation, OutboxItem, SyncReport, SyncStatus } from '../contracts/sync';
import { copy } from './memory-store';
import { appendContent } from './merge-content';
export { createMemoryStore } from './memory-store';
export { CONFLICT_POLICY } from '../contracts/sync';
type PurgeBatch = Parameters<import('../contracts/sync').LocalStore['commit']>[0];
const tombstoneKey = (entity: EntityName, id: string) => `sync.deleted.${entity}.${id}`;
const payloadKey = (id: string) => `sync.mutation.${id}`;
interface SavedMutation {
    mutation: Mutation;
    base: unknown;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Objects merge recursively; ordered arrays are a single teacher-edited field. */
export function mergeChangedFields(base: unknown, mine: unknown, theirs: unknown): unknown {
    if (same(base, mine))
        return copy(theirs);
    if (!mine || typeof mine !== 'object' || Array.isArray(mine) || !theirs || typeof theirs !== 'object' || Array.isArray(theirs))
        return copy(mine);
    const b = (base ?? {}) as Record<string, unknown>, m = mine as Record<string, unknown>;
    const result = { ...theirs } as Record<string, unknown>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(m)])) {
        if (same(b[key], m[key]))
            continue;
        if (!(key in m))
            delete result[key];
        else
            result[key] = mergeChangedFields(b[key], m[key], result[key]);
    }
    return result;
}
const local = (r: Omit<RecordEnvelope, 'data'> & {
    data?: unknown;
}): LocalRecord => ({ ...r, data: parseRecordData(r.entity, r.data), dirty: false, base: null, conflict: null });
export const createSyncEngine: CreateSyncEngine = ({ store, transport, deviceId, now, newId }) => {
    const listeners = new Set<(changes: Array<{
        entity: EntityName;
        id: string;
    }>) => void>();
    const conflictKeys = new Set<string>();
    const recordKey = (r: {
        entity: EntityName;
        id: string;
    }) => JSON.stringify([r.entity, r.id]);
    // One hydration scan per engine lifetime, not on every sync-indicator poll.
    const hydrated = Promise.all(ENTITY_NAMES.map(entity => store.list(entity, { includeDeleted: true }))).then(groups => {
        for (const r of groups.flat())
            if (r.conflict)
                conflictKeys.add(recordKey(r));
    });
    let state: SyncStatus['state'] = 'idle';
    let running: Promise<SyncReport> | null = null;
    let tail: Promise<unknown> = Promise.resolve();
    const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
        const result = tail.then(() => hydrated).then(fn);
        tail = result.catch(() => undefined);
        return result;
    };
    const notify = (records: LocalRecord[]) => {
        for (const r of records) {
            if (r.conflict)
                conflictKeys.add(recordKey(r));
            else
                conflictKeys.delete(recordKey(r));
        }
        for (const listener of listeners) {
            try {
                listener(records.map(({ entity, id }) => ({ entity, id })));
            }
            catch { /* Observers cannot undo a durable save. */ }
        }
    };
    const commit = (batch: PurgeBatch) => store.commit(batch);
    async function purge(entity: EntityName, id: string, rev: number, pending: OutboxItem[]) {
        await commit({ remove: [{ entity, id }], outboxRemove: pending.map(q => q.mutationId), meta: {
                ...Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])),
                [tombstoneKey(entity, id)]: String(rev),
                [`sync.rejected.${id}`]: null,
            } });
        conflictKeys.delete(recordKey({ entity, id }));
        for (const listener of listeners) {
            try {
                listener([{ entity, id }]);
            }
            catch { }
        }
    }
    const queued = async (entity: EntityName, id: string) => (await store.outbox()).filter(q => q.entity === entity && q.id === id);
    function addition(r: LocalRecord): {
        item: OutboxItem;
        saved: SavedMutation;
    } {
        const mutationId = newId();
        return {
            item: { mutationId, entity: r.entity, id: r.id, op: r.deletedAt ? 'delete' : 'upsert', baseRev: r.rev, createdAt: now().toISOString(), attempts: 0 },
            saved: { mutation: { mutationId, entity: r.entity, id: r.id, op: r.deletedAt ? 'delete' : 'upsert', baseRev: r.rev, ...(r.deletedAt ? {} : { data: r.data }) }, base: r.base },
        };
    }
    async function saveMany(records: LocalRecord[], remove: OutboxItem[] = []) {
        const meta: Record<string, string | null> = Object.fromEntries(remove.map(q => [payloadKey(q.mutationId), null]));
        const additions = records.map(r => {
            const { item, saved } = addition(r);
            meta[payloadKey(item.mutationId)] = JSON.stringify(saved);
            meta[`sync.rejected.${r.id}`] = null;
            return item;
        });
        await store.commit({ put: records, outboxAdd: additions, outboxRemove: remove.map(q => q.mutationId), meta });
        notify(records);
    }
    async function save(r: LocalRecord, remove: OutboxItem[] = []) {
        await saveMany([r], remove);
    }
    async function put<E extends EntityName>(entity: E, input: RecordData<E>): Promise<LocalRecord<E>> {
        const data = parseRecordData(entity, input);
        return exclusive(async () => {
            const old = await store.get(entity, data.id);
            const r = { entity, id: data.id, data, rev: old?.rev ?? Number(await store.getMeta(tombstoneKey(entity, data.id)) ?? 0), updatedAt: old?.updatedAt ?? now().toISOString(), deletedAt: null,
                dirty: true, base: old?.dirty ? old.base : old?.data ?? null, conflict: old?.conflict ?? null } as LocalRecord<E>;
            const removable = (await queued(entity, data.id)).filter(q => q.attempts === 0);
            if (r.conflict) {
                await store.commit({ put: [r] });
                notify([r]);
            }
            else
                await save(r, removable);
            return copy(r);
        });
    }
    async function remove(entity: EntityName, id: string) {
        await exclusive(async () => {
            const old = await store.get(entity, id);
            if (!old)
                return;
            parseRecordData(entity, old.data);
            const r = { ...old, deletedAt: now().toISOString(), dirty: true, base: old.dirty ? old.base : old.data };
            if (r.conflict) {
                await store.commit({ put: [r] });
                notify([r]);
            }
            else
                await save(r, (await queued(entity, id)).filter(q => q.attempts === 0));
        });
    }
    async function resolveConflict(entity: EntityName, id: string, choice: 'mine' | 'theirs' | 'both') {
        await exclusive(async () => {
            const r = await store.get(entity, id);
            if (!r?.conflict)
                return;
            const server = r.conflict.server;
            const pending = await queued(entity, id);
            if (choice === 'theirs') {
                const next = local(server);
                await store.commit({ put: [next], outboxRemove: pending.map(q => q.mutationId), meta: Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])) });
                notify([next]);
                return;
            }
            let data = r.data;
            const extra: LocalRecord[] = [];
            if (choice === 'both') {
                if (entity === 'plan_section')
                    data = { ...(r.data as PlanSection), content: appendContent((r.data as PlanSection).content, (server.data as PlanSection).content) };
                else {
                    // Roster rows have no text-section container: preserve the other version as a second row.
                    const second = local({ ...server, id: newId(), rev: 0, deletedAt: null, data: server.data });
                    second.data = parseRecordData(entity, { ...server.data, id: second.id });
                    second.dirty = true;
                    extra.push(second);
                }
            }
            await saveMany([{ ...r, data: parseRecordData(entity, data), rev: server.rev, base: server.data, deletedAt: choice === 'mine' ? r.deletedAt : null, conflict: null }, ...extra], pending);
        });
    }
    // Rule 5: retain rejected locked-section work in a separate draft.
    async function lockCopy(r: LocalRecord, server: RecordEnvelope | null, report: SyncReport) {
        const section = r.data as PlanSection;
        const parent = await store.get('plan', section.planId);
        if (!parent)
            throw new Error('Missing parent for locked section');
        const id = newId();
        const plan = parseRecordData('plan', { ...parent.data, id, state: 'draft', lock: null, submitted: null, conflictCopyOf: section.planId });
        const originals = (await store.list('plan_section', { includeDeleted: true })).filter(s => (s.data as PlanSection).planId === section.planId);
        const copies: LocalRecord[] = [{ ...local({ ...parent, id, rev: 0, deletedAt: null, data: plan }), dirty: true }];
        for (const s of originals) {
            if (s.deletedAt)
                continue;
            const sid = newId();
            copies.push({ ...local({ ...s, id: sid, rev: 0, deletedAt: null, data: parseRecordData('plan_section', { ...s.data, id: sid, planId: id }) }), dirty: true });
        }
        const pending = (await store.outbox()).filter(q => originals.some(s => s.id === q.id && q.entity === 'plan_section'));
        const meta: Record<string, string | null> = Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null]));
        const adds = copies.map(c => { const a = addition(c); meta[payloadKey(a.item.mutationId)] = JSON.stringify(a.saved); return a.item; });
        const restored = originals.map(s => s.id === r.id && server ? local(server) : { ...s, data: s.base ?? s.data, deletedAt: s.rev === 0 ? now().toISOString() : (s.dirty ? null : s.deletedAt), dirty: false, base: null, conflict: null });
        await store.commit({ put: [...copies, ...restored], outboxAdd: adds, outboxRemove: pending.map(q => q.mutationId), meta });
        report.lockCopies.push(id);
        notify([...copies, ...restored]);
    }
    async function cycle(opts?: {
        windowFrom?: string;
        windowTo?: string;
    }): Promise<SyncReport> {
        state = 'syncing';
        const report: SyncReport = { rejected: 0, skipped: 0, ok: true, pushed: 0, pulled: 0, conflicts: 0, lockCopies: [], error: null, at: now().toISOString() };
        try {
            // Rules 1–3: base revisions, explicit conflicts, immutable idempotent replay.
            // Bound contention: persistent queue carries any remainder into the next scheduled cycle.
            for (let round = 0; round < 100; round++) {
                const batch = await exclusive(async () => {
                    const heads = new Set<string>();
                    const items: OutboxItem[] = [];
                    const mutations: Mutation[] = [];
                    for (const q of await store.outbox()) {
                        const key = JSON.stringify([q.entity, q.id]);
                        if (heads.has(key))
                            continue;
                        heads.add(key);
                        const r = await store.get(q.entity, q.id);
                        if (!r || r.conflict)
                            continue;
                        const raw = await store.getMeta(payloadKey(q.mutationId));
                        if (!raw)
                            throw new Error('Missing durable mutation payload');
                        items.push({ ...q, attempts: q.attempts + 1 });
                        mutations.push((JSON.parse(raw) as SavedMutation).mutation);
                        if (items.length === 100)
                            break;
                    }
                    await store.commit({ outboxAdd: items });
                    return { items, mutations };
                });
                if (!batch.items.length)
                    break;
                const response = PushResponse.parse(await transport.push({ deviceId, mutations: batch.mutations }));
                for (const result of response.results)
                    await exclusive(async () => {
                        const sent = batch.items.find(q => q.mutationId === result.mutationId);
                        if (!sent)
                            throw new Error('Unknown mutation response');
                        const raw = await store.getMeta(payloadKey(sent.mutationId));
                        if (!raw)
                            return; // lock copy already consumed it
                        const saved = JSON.parse(raw) as SavedMutation;
                        const r = await store.get(sent.entity, sent.id);
                        if (!r)
                            throw new Error('Missing local record');
                        const pending = await queued(sent.entity, sent.id);
                        const wire = result.record ? RecordEnvelopeSchema.parse(result.record) : null;
                        // Deletion envelopes are authoritative; scrubbed data is never a live record.
                        if (result.status === 'applied' && sent.op === 'delete' && (!wire || wire.deletedAt)) {
                            report.pushed++;
                            if (!r.deletedAt)
                                await save({ ...r, rev: wire?.rev ?? 0, base: null, conflict: null }, pending);
                            else
                                await purge(sent.entity, sent.id, wire?.rev ?? 0, pending);
                            return;
                        }
                        if (wire?.deletedAt && result.status === 'conflict') {
                            if (r.deletedAt)
                                await purge(sent.entity, sent.id, wire.rev, pending);
                            else
                                await save({ ...r, rev: wire.rev, base: null, conflict: null }, pending);
                            return;
                        }
                        const server = wire && !wire.deletedAt ? local(wire) : null;
                        if (result.status === 'locked' && sent.entity === 'plan_section') {
                            await lockCopy(r, server, report);
                            return;
                        }
                        if (result.status === 'applied' && server) {
                            report.pushed++;
                            if (pending.some(q => q.mutationId !== sent.mutationId)) {
                                await save({ ...r, rev: server.rev, base: server.data, conflict: null }, pending);
                            }
                            else {
                                await store.commit({ put: [server], outboxRemove: [sent.mutationId], meta: { [payloadKey(sent.mutationId)]: null } });
                                notify([server]);
                            }
                        }
                        else if (result.status === 'conflict' && server) {
                            // Rule 6 also applies in reverse: a stale delete cannot erase a live edit.
                            if (sent.op === 'delete' && r.deletedAt) {
                                await store.commit({ put: [server], outboxRemove: pending.map(q => q.mutationId), meta: Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])) });
                                notify([server]);
                            }
                            else if (CONFLICT_POLICY[sent.entity] === 'merge_fields' || server.deletedAt) {
                                // Rule 6: edits restore server-deleted records.
                                const data = server.deletedAt ? r.data : parseRecordData(sent.entity, mergeChangedFields(saved.base, r.data, server.data));
                                await save({ ...r, data, rev: server.rev, base: server.data, conflict: null }, pending);
                            }
                            else {
                                const next = { ...r, conflict: { server } };
                                report.conflicts++;
                                await store.commit({ put: [next], outboxRemove: pending.map(q => q.mutationId), meta: Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])) });
                                notify([next]);
                            }
                        }
                        else {
                            // Terminal rejection must not poison the queue. Keep the teacher's local text.
                            const rejected = { ...r, conflict: server ? { server } : r.conflict };
                            await store.commit({ put: [rejected], outboxRemove: pending.map(q => q.mutationId), meta: {
                                    ...Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])),
                                    [`sync.rejected.${r.id}`]: JSON.stringify({ entity: r.entity, status: result.status, mutationId: sent.mutationId }),
                                } });
                            report.rejected++;
                            report.conflicts++;
                            notify([rejected]);
                        }
                    });
                if (response.results.length !== batch.items.length)
                    throw new Error('Incomplete push response');
            }
            // Rule 4: only server revisions and cursors determine ordering.
            let cursor = await store.getMeta('sync.cursor');
            for (;;) {
                const page = PullResponse.parse(await transport.pull({ ...opts, ...(cursor ? { cursor } : {}), limit: 100 }));
                if (page.hasMore && page.cursor === cursor)
                    throw new Error('Pull cursor did not advance');
                await exclusive(async () => {
                    const updates: LocalRecord[] = [];
                    const removes: Array<{
                        entity: EntityName;
                        id: string;
                    }> = [];
                    const meta: Record<string, string | null> = { 'sync.cursor': page.cursor };
                    const outboxRemove: string[] = [];
                    for (const wire of page.records) {
                        let envelope: ReturnType<typeof RecordEnvelopeSchema.parse>;
                        try {
                            envelope = RecordEnvelopeSchema.parse(wire);
                        }
                        catch {
                            report.skipped++;
                            continue;
                        }
                        const matches = (r: {
                            entity: EntityName;
                            id: string;
                        }) => r.entity === envelope.entity && r.id === envelope.id;
                        const existing = removes.some(matches) ? null : [...updates].reverse().find(matches) ?? await store.get(envelope.entity, envelope.id);
                        const deletionRev = meta[tombstoneKey(envelope.entity, envelope.id)] ?? await store.getMeta(tombstoneKey(envelope.entity, envelope.id));
                        const knownRev = Math.max(existing?.rev ?? 0, Number(deletionRev ?? 0));
                        if (knownRev >= envelope.rev)
                            continue;
                        if (envelope.deletedAt) {
                            if (existing?.dirty && !existing.deletedAt) {
                                // Preserve an actual local edit, never resurrect the scrubbed placeholder.
                                if (existing.conflict)
                                    await save({ ...existing, rev: envelope.rev, base: null, conflict: null }, await queued(envelope.entity, envelope.id));
                                continue;
                            }
                            for (let i = updates.length - 1; i >= 0; i--)
                                if (matches(updates[i]!))
                                    updates.splice(i, 1);
                            removes.push({ entity: envelope.entity, id: envelope.id });
                            meta[tombstoneKey(envelope.entity, envelope.id)] = String(envelope.rev);
                            for (const item of await queued(envelope.entity, envelope.id)) {
                                outboxRemove.push(item.mutationId);
                                meta[payloadKey(item.mutationId)] = null;
                            }
                            continue;
                        }
                        let server: LocalRecord;
                        try {
                            server = local(envelope);
                        }
                        catch {
                            report.skipped++;
                            continue;
                        }
                        const r = existing;
                        if (r && r.rev >= server.rev)
                            continue;
                        if (r?.dirty) {
                            if (r.conflict)
                                updates.push({ ...r, conflict: { server } });
                            // Pending edits are reconciled through push, never overwritten by pull.
                            continue;
                        }
                        for (let i = removes.length - 1; i >= 0; i--)
                            if (matches(removes[i]!))
                                removes.splice(i, 1);
                        updates.push(server);
                    }
                    await commit({ put: updates, remove: removes, outboxRemove, meta });
                    notify(updates);
                    for (const removed of removes) {
                        conflictKeys.delete(recordKey(removed));
                        for (const listener of listeners) {
                            try {
                                listener([removed]);
                            }
                            catch { }
                        }
                    }
                });
                report.pulled += page.records.length;
                cursor = page.cursor;
                if (!page.hasMore)
                    break;
            }
            await store.commit({ meta: { 'sync.lastSyncedAt': report.at } });
            state = 'idle';
        }
        catch (error) {
            const e = error as {
                code?: string;
                status?: number;
                name?: string;
            };
            report.ok = false;
            report.error = e.code === 'unauthenticated' || e.status === 401 ? 'unauthenticated' : e instanceof TypeError || ['offline', 'network', 'timeout'].includes(e.code ?? '') || e.name === 'AbortError' ? 'offline' : 'server';
            state = report.error === 'offline' ? 'offline' : 'error';
        }
        return report;
    }
    return {
        get: async <E extends EntityName>(entity: E, id: string) => { const r = await store.get(entity, id); return r?.deletedAt ? null : r as LocalRecord<E> | null; },
        list: async <E extends EntityName>(entity: E) => store.list(entity) as Promise<LocalRecord<E>[]>,
        put, remove, resolveConflict,
        sync(opts) {
            if (!running)
                running = cycle(opts).finally(() => { running = null; });
            return running;
        },
        async status() {
            await hydrated;
            const conflicts = conflictKeys.size;
            return { state, pending: (await store.outbox()).length, conflicts, lastSyncedAt: await store.getMeta('sync.lastSyncedAt') };
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
};
