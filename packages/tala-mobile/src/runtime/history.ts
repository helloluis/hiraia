import type { PlanSection, SyncEngine } from '@hiraia/tala-core/contracts';
/** One snapshot per edit session, rather than one history/outbox record per keystroke. */
export function sectionHistory(engine: SyncEngine, newId: () => string, now: () => Date) {
  const captured = new Set<string>();
  return {
    reset() {
      captured.clear();
    },
    async beforeEdit(section: PlanSection, reason: 'edit' | 'restore' | 'conflict' = 'edit') {
      if (captured.has(section.id)) return;
      await engine.put('section_revision', {
        id: newId(),
        planId: section.planId,
        sectionId: section.id,
        key: section.key,
        content: section.content,
        origin: section.origin,
        gen: section.gen,
        reason,
        savedAt: now().toISOString(),
      });
      captured.add(section.id);
      const revisions = (await engine.list('section_revision'))
        .filter((r) => r.data.sectionId === section.id && !r.dirty)
        .sort((a, b) => b.rev - a.rev || b.updatedAt.localeCompare(a.updatedAt));
      for (const old of revisions.slice(10)) await engine.remove('section_revision', old.id);
    },
  };
}
