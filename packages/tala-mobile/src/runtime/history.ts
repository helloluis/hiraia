import type { PlanSection, SyncEngine } from '@hiraia/tala-core/contracts';
import { sectionRevision } from '@hiraia/tala-core/plan';
import { atomic, type Operation } from '../features/atomic';
/** One original snapshot per typing session; every restore/conflict choice keeps its immediately prior text. */
export function sectionHistory(engine: SyncEngine, newId: () => string, now: () => Date) {
  const captured = new Set<string>();
  async function write(
    section: PlanSection,
    next: PlanSection | undefined,
    reason: 'edit' | 'restore' | 'conflict'
  ) {
    const ops: Operation[] = [];
    const capture = reason !== 'edit' || !captured.has(section.id);
    if (capture)
      ops.push({
        op: 'put',
        entity: 'section_revision',
        data: sectionRevision(section, { id: newId(), savedAt: now().toISOString(), reason }),
      });
    const revisions = (await engine.list('section_revision'))
      .filter((r) => r.data.sectionId === section.id && !r.dirty)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.rev - a.rev);
    for (const old of revisions.slice(10))
      ops.push({ op: 'remove', entity: 'section_revision', id: old.id });
    if (next) ops.push({ op: 'put', entity: 'plan_section', data: next });
    await atomic(engine, ops);
    if (capture) captured.add(section.id);
  }
  return {
    reset() {
      captured.clear();
    },
    beforeEdit(section: PlanSection, reason: 'edit' | 'restore' | 'conflict' = 'edit') {
      return write(section, undefined, reason);
    },
    edit(section: PlanSection, next: PlanSection, reason: 'edit' | 'restore' = 'edit') {
      return write(section, next, reason);
    },
  };
}
