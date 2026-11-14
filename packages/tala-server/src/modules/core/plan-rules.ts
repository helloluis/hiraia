/**
 * Server-side rules for plans: what "locked" means and what may change while locked
 * (PRD §10.1–10.2, DOC-2 to DOC-6).
 * OWNER: workstream A. Pure functions: no database, no clock.
 *
 * Whether a plan MAY be locked (DOC-1) is decided by the shared check the apps also run,
 * `validatePlanForLock` in @hiraia/tala-core/plan, called from records.ts. Using the same function on
 * both sides means a lock the device accepted offline is not refused later for a reason the teacher never saw.
 */
import type { Plan, SectionContent, Template } from '@hiraia/tala-core';
import { stableStringify } from './stable';

/**
 * A plan is locked while it carries a lock and is not a draft. That includes a locked plan that was
 * archived with its lock kept: archiving hides it from the timeline, it does not reopen it for editing.
 */
export function effectivelyLocked(plan: Plan): boolean {
  return plan.lock !== null && plan.state !== 'draft';
}

/** Bring a plan into a consistent shape before any rule looks at it. Returns a problem instead of throwing. */
export function normalisePlan(plan: Plan): { plan: Plan } | { problem: string } {
  if (plan.state === 'locked' && plan.lock === null)
    return { problem: 'A locked lesson needs its lock details.' };
  // Lock details only mean something on a locked (or archived-while-locked) plan.
  if (plan.state === 'draft' && plan.lock !== null) return { plan: { ...plan, lock: null } };
  return { plan };
}

/* ---------------- templates and sections ---------------- */

/**
 * Whether the template calls this section key POST-CLASS (`outsideLock`: assessment results, reflection).
 * A post-class part is written after the lesson is taught, so it stays enterable on a locked plan (DOC-2).
 * Unknown template or key: not post-class. The first definition of a key decides, as in the shared `lockPlan`.
 */
export function isOutsideLock(template: Template | null, key: string): boolean {
  return template?.sections.find((s) => s.key === key)?.outsideLock === true;
}

/**
 * The template as the lock check (DOC-1) should see it. A post-class part cannot exist before the lesson is
 * taught, so it is never something a plan must have to be locked, even where a teacher's own template marks
 * it required.
 */
export function withoutPostClassRequirements(template: Template): Template {
  return {
    ...template,
    sections: template.sections.map((s) =>
      s.required && isOutsideLock(template, s.key) ? { ...s, required: false } : s
    ),
  };
}

/**
 * What a lock froze, written down the moment it is taken and kept with the lock's revision.
 *  - `outside`: the keys the plan's template called post-class then.
 *  - `inside`:  every other key the template had then, and the key of every part the plan held that was not
 *               post-class (a part the template did not know about is inside the lock).
 */
export interface LockKeys {
  outside: string[];
  inside: string[];
}

export function lockKeysOf(template: Template | null, sectionKeys: readonly string[]): LockKeys {
  const outside: string[] = [];
  const inside: string[] = [];
  const placed = (key: string) => outside.includes(key) || inside.includes(key);
  for (const spec of template?.sections ?? []) {
    if (!placed(spec.key)) (spec.outsideLock ? outside : inside).push(spec.key);
  }
  for (const key of sectionKeys) if (!placed(key)) inside.push(key);
  return { outside, inside };
}

/**
 * Sync rule 5, the whole decision: does the plan's lock freeze a section with this key?
 *
 * What was locked stays locked, whatever happens to the template afterwards:
 *  - a key that was inside the lock when it was taken is frozen;
 *  - a key that was post-class then stays enterable;
 *  - a key that did not exist then (the template gained a part since, as the built-in ones gained `results`)
 *    is enterable only if the template, as it is now, calls it post-class.
 * `atLock` is null for a lock taken before this record was kept: the template as it is now decides alone.
 * Nothing a device sends takes part: not a field on the section, not its content, not its id.
 */
export function frozenByLock(
  atLock: LockKeys | null,
  template: Template | null,
  key: string
): boolean {
  if (atLock?.inside.includes(key)) return true;
  if (atLock?.outside.includes(key)) return false;
  return !isOutsideLock(template, key);
}

/** The same section with its text removed. Used for what remains of a deleted section. */
export function emptiedContent(content: SectionContent): SectionContent {
  switch (content.type) {
    case 'text':
      return { type: 'text', blocks: [] };
    case 'list':
      return { type: 'list', items: [] };
    case 'procedure':
      return { type: 'procedure', steps: [] };
    case 'multigrade':
      return { type: 'multigrade', blocks: [] };
    case 'weekgrid':
      return { type: 'weekgrid', days: [] };
    case 'pergroup':
      return { type: 'pergroup', groups: {} };
  }
}

/* ---------------- DOC-2: what may change while locked ---------------- */

/**
 * Fields a locked plan may still change: its dates (the pacing engine reschedules it), the "submitted"
 * note (DOC-5), which unit it sits in, and moving between locked and archived. Everything else is content.
 */
const CHANGEABLE_WHILE_LOCKED: ReadonlySet<keyof Plan> = new Set([
  'placements',
  'submitted',
  'unitId',
  'state',
  'lock',
]);

/** Names of fields that differ and are not allowed to while the plan stays locked. Empty = acceptable. */
export function lockedPlanViolations(stored: Plan, incoming: Plan): string[] {
  const violations: string[] = [];
  const keys = new Set([...Object.keys(stored), ...Object.keys(incoming)]) as Set<keyof Plan>;
  for (const key of keys) {
    if (CHANGEABLE_WHILE_LOCKED.has(key)) continue;
    if (stableStringify(stored[key]) !== stableStringify(incoming[key])) violations.push(key);
  }
  // The lock itself must be the same lock, which its revision code identifies. The other lock details are
  // the server's to keep (see withServerLockFields in records.ts).
  if (!stored.lock || !incoming.lock || stored.lock.revisionCode !== incoming.lock.revisionCode)
    violations.push('lock');
  return violations;
}
