import { ENTITY_NAMES, parseRecordData } from '../contracts/records';
import type { EntityName, RecordData, RecordEnvelope, PlanSection, Plan } from '../contracts/records';
import { CONFLICT_POLICY, PullResponse, PushResponse } from '../contracts/sync';
import type { CreateSyncEngine, LocalRecord, Mutation, OutboxItem, SyncReport, SyncStatus } from '../contracts/sync';
import { copy } from './memory-store';
import { appendContent } from './merge-content';
export { createMemoryStore } from './memory-store';
export { CONFLICT_POLICY } from '../contracts/sync';

const payloadKey = (id: string) => `sync.mutation.${id}`;
interface SavedMutation { mutation: Mutation; base: unknown }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Objects merge recursively; ordered arrays are a single teacher-edited field. */
export function mergeChangedFields(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (same(base, mine)) return copy(theirs);
  if (!mine || typeof mine !== 'object' || Array.isArray(mine) || !theirs || typeof theirs !== 'object' || Array.isArray(theirs)) return copy(mine);
  const b = (base ?? {}) as Record<string, unknown>, m = mine as Record<string, unknown>;
  const result = { ...theirs } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(m)])) {
    if (same(b[key], m[key])) continue;
    if (!(key in m)) delete result[key];
    else result[key] = mergeChangedFields(b[key], m[key], result[key]);
  }
  return result;
}
const local = (r: Omit<RecordEnvelope, 'data'> & { data?: unknown }): LocalRecord => ({ ...r, data: parseRecordData(r.entity, r.data), dirty: false, base: null, conflict: null });

export const createSyncEngine: CreateSyncEngine = ({ store, transport, deviceId, now, newId }) => {
  const listeners = new Set<(changes: Array<{ entity: EntityName; id: string }>) => void>();
  let state: SyncStatus['state'] = 'idle';
  let running: Promise<SyncReport> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn); tail = result.catch(() => undefined); return result;
  };
  const notify = (records: LocalRecord[]) => {
    for (const listener of listeners) { try { listener(records.map(({ entity, id }) => ({ entity, id }))); } catch { /* Observers cannot undo a durable save. */ } }
  };
  const queued = async (entity: EntityName, id: string) => (await store.outbox()).filter(q => q.entity === entity && q.id === id);
  function addition(r: LocalRecord): { item: OutboxItem; saved: SavedMutation } {
    const mutationId = newId();
    return {
      item: { mutationId, entity: r.entity, id: r.id, op: r.deletedAt ? 'delete' : 'upsert', baseRev: r.rev, createdAt: now().toISOString(), attempts: 0 },
      saved: { mutation: { mutationId, entity: r.entity, id: r.id, op: r.deletedAt ? 'delete' : 'upsert', baseRev: r.rev, ...(r.deletedAt ? {} : { data: r.data }) }, base: r.base },
    };
  }
  async function save(r: LocalRecord, remove: OutboxItem[] = []) {
    const { item, saved } = addition(r);
    const meta: Record<string, string | null> = Object.fromEntries(remove.map(q => [payloadKey(q.mutationId), null]));
    meta[payloadKey(item.mutationId)] = JSON.stringify(saved);
    await store.commit({ put: [r], outboxAdd: [item], outboxRemove: remove.map(q => q.mutationId), meta });
    notify([r]);
  }
  async function put<E extends EntityName>(entity: E, input: RecordData<E>): Promise<LocalRecord<E>> {
    const data = parseRecordData(entity, input);
    return exclusive(async () => {
      const old = await store.get(entity, data.id);
      const r = { entity, id: data.id, data, rev: old?.rev ?? 0, updatedAt: old?.updatedAt ?? now().toISOString(), deletedAt: null,
        dirty: true, base: old?.dirty ? old.base : old?.data ?? null, conflict: old?.conflict ?? null } as LocalRecord<E>;
      const removable = (await queued(entity, data.id)).filter(q => q.attempts === 0);
      if (r.conflict) { await store.commit({ put: [r] }); notify([r]); }
      else await save(r, removable);
      return copy(r);
    });
  }
  async function remove(entity: EntityName, id: string) {
    await exclusive(async () => {
      const old = await store.get(entity, id); if (!old) return;
      parseRecordData(entity, old.data);
      const r = { ...old, deletedAt: now().toISOString(), dirty: true, base: old.dirty ? old.base : old.data };
      if (r.conflict) { await store.commit({ put: [r] }); notify([r]); }
      else await save(r, (await queued(entity, id)).filter(q => q.attempts === 0));
    });
  }
  async function resolveConflict(entity: EntityName, id: string, choice: 'mine' | 'theirs' | 'both') {
    await exclusive(async () => {
      const r = await store.get(entity, id); if (!r?.conflict) return;
      const server = r.conflict.server;
      const pending = await queued(entity, id);
      if (choice === 'theirs') {
        const next = local(server);
        await store.commit({ put: [next], outboxRemove: pending.map(q => q.mutationId), meta: Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])) });
        notify([next]); return;
      }
      let data = r.data;
      if (choice === 'both') {
        if (entity === 'plan_section') data = { ...(r.data as PlanSection), content: appendContent((r.data as PlanSection).content, (server.data as PlanSection).content) };
        else {
          // Roster rows have no text-section container: preserve the other version as a second row.
          const second = local({ ...server, id: newId(), rev: 0, deletedAt: null, data: server.data });
          second.data = parseRecordData(entity, { ...server.data, id: second.id }); second.dirty = true;
          await save(second);
        }
      }
      await save({ ...r, data: parseRecordData(entity, data), rev: server.rev, base: server.data, deletedAt: null, conflict: null }, pending);
    });
  }
  async function lockCopy(r: LocalRecord, server: RecordEnvelope | null, report: SyncReport) {
    const section = r.data as PlanSection;
    const parent = await store.get('plan', section.planId);
    if (!parent) throw new Error('Missing parent for locked section');
    const id = newId();
    const plan = parseRecordData('plan', { ...parent.data, id, state: 'draft', lock: null, submitted: null, conflictCopyOf: section.planId });
    const originals = (await store.list('plan_section')).filter(s => (s.data as PlanSection).planId === section.planId);
    const copies: LocalRecord[] = [{ ...local({ ...parent, id, rev: 0, deletedAt: null, data: plan }), dirty: true }];
    for (const s of originals) {
      const sid = newId(); copies.push({ ...local({ ...s, id: sid, rev: 0, deletedAt: null, data: parseRecordData('plan_section', { ...s.data, id: sid, planId: id }) }), dirty: true });
    }
    const pending = (await store.outbox()).filter(q => originals.some(s => s.id === q.id && q.entity === 'plan_section'));
    const meta: Record<string, string | null> = Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null]));
    const adds = copies.map(c => { const a = addition(c); meta[payloadKey(a.item.mutationId)] = JSON.stringify(a.saved); return a.item; });
    const restored = originals.map(s => s.id === r.id && server ? local(server) : { ...s, data: s.base ?? s.data, dirty: false, base: null, conflict: null });
    await store.commit({ put: [...copies, ...restored], outboxAdd: adds, outboxRemove: pending.map(q => q.mutationId), meta });
    report.lockCopies.push(id); notify([...copies, ...restored]);
  }
  async function cycle(opts?: { windowFrom?: string; windowTo?: string }): Promise<SyncReport> {
    state = 'syncing';
    const report: SyncReport = { ok: true, pushed: 0, pulled: 0, conflicts: 0, lockCopies: [], error: null, at: now().toISOString() };
    try {
      // Bound contention: persistent queue carries any remainder into the next scheduled cycle.
      for (let round = 0; round < 100; round++) {
        const batch = await exclusive(async () => {
          const heads = new Set<string>(); const items: OutboxItem[] = []; const mutations: Mutation[] = [];
          for (const q of await store.outbox()) {
            const key = JSON.stringify([q.entity, q.id]); if (heads.has(key)) continue; heads.add(key);
            const r = await store.get(q.entity, q.id); if (!r || r.conflict) continue;
            const raw = await store.getMeta(payloadKey(q.mutationId));
            if (!raw) throw new Error('Missing durable mutation payload');
            items.push({ ...q, attempts: q.attempts + 1 }); mutations.push((JSON.parse(raw) as SavedMutation).mutation);
            if (items.length === 100) break;
          }
          await store.commit({ outboxAdd: items }); return { items, mutations };
        });
        if (!batch.items.length) break;
        const response = PushResponse.parse(await transport.push({ deviceId, mutations: batch.mutations }));
        for (const result of response.results) await exclusive(async () => {
          const sent = batch.items.find(q => q.mutationId === result.mutationId); if (!sent) throw new Error('Unknown mutation response');
          const raw = await store.getMeta(payloadKey(sent.mutationId)); if (!raw) return; // lock copy already consumed it
          const saved = JSON.parse(raw) as SavedMutation;
          const r = await store.get(sent.entity, sent.id); if (!r) throw new Error('Missing local record');
          const pending = await queued(sent.entity, sent.id);
          const server = result.record ? local(result.record) : null;
          if (result.status === 'locked' && sent.entity === 'plan_section') { await lockCopy(r, server, report); return; }
          if (result.status === 'applied' && server) {
            report.pushed++;
            if (pending.some(q => q.mutationId !== sent.mutationId)) {
              await save({ ...r, rev: server.rev, base: server.data, conflict: null }, pending);
            } else {
              await store.commit({ put: [server], outboxRemove: [sent.mutationId], meta: { [payloadKey(sent.mutationId)]: null } }); notify([server]);
            }
          } else if (result.status === 'conflict' && server) {
            if (CONFLICT_POLICY[sent.entity] === 'merge_fields' || server.deletedAt) {
              const data = server.deletedAt ? r.data : parseRecordData(sent.entity, mergeChangedFields(saved.base, r.data, server.data));
              await save({ ...r, data, rev: server.rev, base: server.data, conflict: null }, pending);
            } else {
              const next = { ...r, conflict: { server } }; report.conflicts++;
              await store.commit({ put: [next], outboxRemove: pending.map(q => q.mutationId), meta: Object.fromEntries(pending.map(q => [payloadKey(q.mutationId), null])) }); notify([next]);
            }
          } else throw new Error('Server rejected mutation');
        });
        if (response.results.length !== batch.items.length) throw new Error('Incomplete push response');
      }
      let cursor = await store.getMeta('sync.cursor');
      for (;;) {
        const page = PullResponse.parse(await transport.pull({ ...opts, ...(cursor ? { cursor } : {}), limit: 100 }));
        if (page.hasMore && page.cursor === cursor) throw new Error('Pull cursor did not advance');
        await exclusive(async () => {
          const updates: LocalRecord[] = [];
          for (const wire of page.records) {
            const server = local(wire); const r = await store.get(server.entity, server.id);
            if (r && r.rev >= server.rev) continue;
            if (r?.dirty) {
              if (r.conflict) updates.push({ ...r, conflict: { server } });
              // Pending edits are reconciled through push, never overwritten by pull.
              continue;
            }
            updates.push(server);
          }
          await store.commit({ put: updates, meta: { 'sync.cursor': page.cursor } }); notify(updates);
        });
        report.pulled += page.records.length; cursor = page.cursor;
        if (!page.hasMore) break;
      }
      await store.commit({ meta: { 'sync.lastSyncedAt': report.at } }); state = 'idle';
    } catch (error) {
      const e = error as { code?: string; status?: number; name?: string };
      report.ok = false; report.error = e.code === 'unauthenticated' || e.status === 401 ? 'unauthenticated' : e instanceof TypeError || e.code === 'offline' || e.name === 'AbortError' ? 'offline' : 'server';
      state = report.error === 'offline' ? 'offline' : 'error';
    }
    return report;
  }
  return {
    get: async <E extends EntityName>(entity: E, id: string) => store.get(entity, id) as Promise<LocalRecord<E> | null>,
    list: async <E extends EntityName>(entity: E) => store.list(entity) as Promise<LocalRecord<E>[]>,
    put, remove, resolveConflict,
    sync(opts) { if (!running) running = cycle(opts).finally(() => { running = null; }); return running; },
    async status() {
      let conflicts = 0; for (const entity of ENTITY_NAMES) conflicts += (await store.list(entity, { includeDeleted: true })).filter(r => r.conflict).length;
      return { state, pending: (await store.outbox()).length, conflicts, lastSyncedAt: await store.getMeta('sync.lastSyncedAt') };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
};
