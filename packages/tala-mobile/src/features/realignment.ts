import type {
  SyncEngine,
  TimelineInput,
  CalendarDay,
  RealignmentPreview,
} from '@hiraia/tala-core/contracts';
import { atomic, type Operation } from './atomic';
import { hasIncompatibleMoves } from '../runtime/realignment';
export async function applyPreviews(
  engine: SyncEngine,
  input: TimelineInput,
  day: CalendarDay,
  previews: RealignmentPreview[]
) {
  if (hasIncompatibleMoves(previews)) throw Error('Incompatible dates');
  const ops: Operation[] = [
      { op: 'put', entity: 'calendar_day', data: { ...day, realigned: true } },
    ],
    undo: Operation[] = [{ op: 'remove', entity: 'calendar_day', id: day.id }];
  const planDates = new Map<string, Map<string, string[]>>();
  for (const p of previews) {
    const old = input.tracks.find((t) => t.id === p.nextTrack.id);
    if (old) undo.push({ op: 'put', entity: 'pacing_track', data: old });
    ops.push({ op: 'put', entity: 'pacing_track', data: p.nextTrack });
    for (const d of p.newCalendarDays) {
      ops.push({ op: 'put', entity: 'calendar_day', data: { ...d, realigned: true } });
      const original = await engine.get('calendar_day', d.id);
      undo.push(
        original
          ? { op: 'put', entity: 'calendar_day', data: original.data }
          : { op: 'remove', entity: 'calendar_day', id: d.id }
      );
    }
    for (const m of p.planMoves) {
      if (!planDates.has(m.planId)) planDates.set(m.planId, new Map());
      planDates.get(m.planId)!.set(m.classId, m.to);
    }
  }
  for (const [id, moves] of planDates) {
    const row = await engine.get('plan', id);
    if (!row) continue;
    ops.push({
      op: 'put',
      entity: 'plan',
      data: {
        ...row.data,
        placements: row.data.placements.map((p) =>
          moves.has(p.classId) ? { ...p, dates: moves.get(p.classId)! } : p
        ),
      },
    });
    undo.push({ op: 'put', entity: 'plan', data: row.data });
  }
  await atomic(engine, ops);
  return async () => {
    const restore: Operation[] = [];
    for (const op of undo) {
      if (op.op === 'put' && op.entity === 'plan') {
        const old = op.data as TimelineInput['plans'][number],
          current = await engine.get('plan', old.id);
        if (current) restore.push({ ...op, data: { ...current.data, placements: old.placements } });
      } else restore.push(op);
    }
    await atomic(engine, restore);
  };
}
