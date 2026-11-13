import type { SyncEngine, TimelineEntry, SessionMark } from '@hiraia/tala-core/contracts';
export async function markSession(
  engine: SyncEngine,
  entry: TimelineEntry,
  status: SessionMark['status'],
  newId: () => string
) {
  const existing = await engine.list('session_mark');
  const previous: { id: string; data: SessionMark | null }[] = [];
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
    await engine.put('session_mark', {
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
    });
  }
  return async () => {
    for (const old of previous) {
      if (old.data) await engine.put('session_mark', old.data);
      else await engine.remove('session_mark', old.id);
    }
  };
}
