/** Pure helpers for multi-grade time blocks (tested in blocks.test.ts). */
import type { MultigradeBlock, RichText } from '@hiraia/tala-core/contracts';

export interface GroupInfo {
  id: string;
  grade: string;
}

function richTextHasText(blocks: RichText): boolean {
  return blocks.some((b) =>
    b.t === 'p'
      ? b.spans.some((s) => s.text.trim())
      : b.items.some((i) => i.some((s) => s.text.trim()))
  );
}

/** Grades whose activities would be deleted with this block — named in the confirmation. */
export function gradesWithContent(block: MultigradeBlock, groups: GroupInfo[]): string[] {
  return groups
    .filter((g) => richTextHasText(block.groups[g.id]?.activity ?? []))
    .map((g) => g.grade);
}

/** Does removing this block need a confirmation at all (any typed content), or can it go at once? */
export function removalNeedsConfirm(block: MultigradeBlock, groups: GroupInfo[]): boolean {
  return gradesWithContent(block, groups).length > 0 || block.label.trim().length > 0;
}

/**
 * Transition minutes are not a teacher-facing field (not in the DLL format). New blocks take the engine's default:
 * 1 for a teacher-led group block, 0 for a whole-class block. Existing values are never overwritten.
 */
export function defaultTransitionMinutes(teacherWith: string): number {
  return teacherWith === 'all' || teacherWith === 'none' ? 0 : 1;
}

/** Brand-tinted panel per grade group (same tint for the same grade across every section). Text stays forest. */
export const GROUP_TINTS = ['bg-cream', 'bg-sage/20', 'bg-yellow/25', 'bg-talaTeal/10'] as const;
export const GROUP_BORDERS = [
  'border-hairline',
  'border-sage/60',
  'border-yellow/70',
  'border-talaTeal/40',
] as const;
export function groupTint(index: number): { bg: string; border: string } {
  const i = ((index % GROUP_TINTS.length) + GROUP_TINTS.length) % GROUP_TINTS.length;
  return { bg: GROUP_TINTS[i]!, border: GROUP_BORDERS[i]! };
}
