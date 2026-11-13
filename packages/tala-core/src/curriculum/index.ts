import type { Competency, CurriculumPack } from '../contracts/curriculum';
import type { CompetencyCheck } from '../contracts/records';

export function packId(curriculumVersion: string, grade: string, learningAreaId: string): string {
  if ([curriculumVersion, grade, learningAreaId].some((s) => !s || s.includes(':')))
    throw new Error('Pack id parts must be nonempty and contain no colon.');
  return `${curriculumVersion}:${grade}:${learningAreaId}`;
}
export function parsePackId(id: string): {
  curriculumVersion: string;
  grade: string;
  learningAreaId: string;
} {
  const parts = id.split(':');
  if (parts.length !== 3 || parts.some((s) => !s)) throw new Error('Invalid curriculum pack id.');
  return { curriculumVersion: parts[0]!, grade: parts[1]!, learningAreaId: parts[2]! };
}
/** Only pass checks belonging to the signed-in teacher. Published records are never mutated. */
export function applyChecks(
  competencies: readonly Competency[],
  checks: readonly CompetencyCheck[],
  version: string | null
): Competency[] {
  const corrections = new Map(
    checks
      .filter((c) => c.curriculumVersion === version && c.status === 'corrected' && c.correction)
      .map((c) => [c.competencyId, c.correction!])
  );
  return competencies.map((c) => ({ ...c, ...corrections.get(c.id), source: { ...c.source } }));
}
export function domainKey(domain: string | null): string | null {
  return domain?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
}
export function shareDomain(a: Competency, b: Competency): boolean {
  return domainKey(a.domain) !== null && domainKey(a.domain) === domainKey(b.domain);
}
export function lookupCompetencies(
  packs: readonly CurriculumPack[],
  version: string,
  ids: readonly string[]
): Competency[] {
  const map = new Map(
    packs
      .filter((p) => p.curriculumVersion === version)
      .flatMap((p) => p.competencies)
      .map((c) => [c.id, c])
  );
  return ids.flatMap((id) =>
    map.has(id) ? [{ ...map.get(id)!, source: { ...map.get(id)!.source } }] : []
  );
}
export function searchCompetencies(
  competencies: readonly Competency[],
  query: { grade?: string; learningAreaId?: string; termIndex?: number; keyword?: string }
): Competency[] {
  const keyword = query.keyword?.trim().toLowerCase();
  return competencies
    .filter(
      (c) =>
        (!query.grade || c.grade === query.grade) &&
        (!query.learningAreaId || c.learningAreaId === query.learningAreaId) &&
        (!query.termIndex || c.termIndex === query.termIndex) &&
        (!keyword || `${c.text} ${c.code ?? ''} ${c.domain ?? ''}`.toLowerCase().includes(keyword))
    )
    .sort(
      (a, b) => a.termIndex - b.termIndex || a.sequence - b.sequence || compareText(a.id, b.id)
    );
}

/** Code-point ordering, independent of the device locale and ICU version. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
