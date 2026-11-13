import type { SyncEngine } from '@hiraia/tala-core/contracts';
export type Operation = Parameters<NonNullable<SyncEngine['batch']>>[0][number];
/** Never silently turn one logical save into a sequence of partially acknowledged writes. */
export async function atomic(engine: SyncEngine, ops: Operation[]) {
  if (!engine.batch) throw new Error('Shared atomic sync engine is not installed yet');
  await engine.batch(ops);
}
/** Stage reads/writes for existing model helpers, then publish through one real engine batch. */
export async function staged<T>(
  engine: SyncEngine,
  work: (view: SyncEngine) => Promise<T>
): Promise<T> {
  const ops: Operation[] = [];
  const view: SyncEngine = {
    ...engine,
    async put(entity, data) {
      ops.push({ op: 'put', entity, data });
      return {
        entity,
        id: data.id,
        data,
        rev: 0,
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        dirty: true,
        base: null,
        conflict: null,
      } as never;
    },
    async remove(entity, id) {
      ops.push({ op: 'remove', entity, id });
    },
    async list(entity) {
      const base = await engine.list(entity);
      const map = new Map(base.map((r) => [r.id, r]));
      for (const op of ops.filter((o) => o.entity === entity)) {
        if (op.op === 'remove') map.delete(op.id);
        else {
          const data = op.data as { id: string };
          map.set(data.id, {
            entity,
            id: data.id,
            data,
            rev: 0,
            updatedAt: '',
            deletedAt: null,
            dirty: true,
            base: null,
            conflict: null,
          } as never);
        }
      }
      return [...map.values()];
    },
    async get(entity, id) {
      const rows = await view.list(entity);
      return rows.find((r) => r.id === id) ?? null;
    },
  };
  const result = await work(view);
  await atomic(engine, ops);
  return result;
}
