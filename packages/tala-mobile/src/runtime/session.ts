import { atomic, type Operation } from '../features/atomic';
import type { SyncEngine, TimelineEntry, SessionMark } from '@hiraia/tala-core/contracts';
export async function markSession(
  engine: SyncEngine,
  entry: TimelineEntry,
  status: SessionMark['status'],
  newId: () => string
) {
  const existing = await engine.list('session_mark');
  const previous: { id: string; data: SessionMark | null }[] = [];
  const ops: Operation[] = [];
  for (const [group, competencyIds] of Object.entries(entry.byGroup)) {
    const old = existing.find(
      (m) =>
        m.data.assignmentId === entry.assignmentId &&
        m.data.date === entry.date &&
        m.data.gradeGroupId === group &&
        m.data.slotId === entry.slotId
    );
    const id = old?.id ?? newId();
    previous.push({ id, data: old?.data ?? null });
    ops.push({
      op: 'put',
      entity: 'session_mark',
      data: {
        id,
        slotId: entry.slotId,
        classId: entry.classId,
        assignmentId: entry.assignmentId,
        gradeGroupId: group,
        date: entry.date,
        planId: entry.planId,
        competencyIds,
        status,
        remark: old?.data.remark ?? '',
      },
    });
  }
  await atomic(engine, ops);
  return async () => {
    await atomic(
      engine,
      previous.map((old) =>
        old.data
          ? { op: 'put', entity: 'session_mark', data: old.data }
          : { op: 'remove', entity: 'session_mark', id: old.id }
      )
    );
  };
}
