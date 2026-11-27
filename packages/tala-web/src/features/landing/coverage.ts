/**
 * What the homepage may say about the Science curriculum and about teaching packs (no React, no I/O).
 *
 * Two different things, kept apart on purpose:
 *  - the CURRICULUM MAP: every Science competency of the shipped curriculum packs, by grade, term and week. It ships
 *    with the code, so its numbers are generated from the pack files (scripts/home-coverage.mjs writes
 *    science-coverage.generated.ts; coverage.test.ts fails when that file and the packs disagree);
 *  - TEACHING PACKS: prebuilt weekly drafts that exist for only some weeks and change without a release. Nothing
 *    about them is written down here: `packWeeks` reads the library's public index when the page is looked at.
 */

/** The fields of a curriculum competency this summary reads. */
export interface CompetencyWeeks {
  termIndex: number;
  weekFrom: number | null;
  weekTo: number | null;
}

export interface TermCoverage {
  term: number;
  /** Weeks the Budget of Work gives this term (the last week any competency is placed in). */
  weeks: number;
  competencies: number;
}

export interface GradeCoverage {
  grade: string;
  competencies: number;
  weeks: number;
  terms: TermCoverage[];
}

export interface ScienceCoverage {
  curriculumVersion: string;
  grades: GradeCoverage[];
  competencies: number;
  weeks: number;
}

const byNumber = (a: string, b: string) => Number(a) - Number(b);

/**
 * Summarise curriculum packs of one learning area. Throws when a term has a week no competency is placed in: the
 * page says each week is mapped, so a gap must stop the build of the summary, not be drawn as covered.
 */
export function summarizeCurriculum(packs: Array<{ curriculumVersion: string; grade: string; competencies: CompetencyWeeks[] }>): ScienceCoverage {
  if (!packs.length) throw new Error('No curriculum packs to summarise.');
  const versions = new Set(packs.map((p) => p.curriculumVersion));
  if (versions.size !== 1) throw new Error(`One curriculum version expected, found ${[...versions].join(', ')}.`);
  const grades = [...packs]
    .sort((a, b) => byNumber(a.grade, b.grade))
    .map((pack): GradeCoverage => {
      const terms = [...new Set(pack.competencies.map((c) => c.termIndex))].sort((a, b) => a - b).map((term): TermCoverage => {
        const own = pack.competencies.filter((c) => c.termIndex === term);
        const covered = new Set<number>();
        for (const c of own) {
          if (c.weekFrom == null || c.weekTo == null) throw new Error(`Grade ${pack.grade} term ${term}: a competency has no weeks.`);
          for (let w = c.weekFrom; w <= c.weekTo; w++) covered.add(w);
        }
        const weeks = Math.max(...covered);
        for (let w = 1; w <= weeks; w++) if (!covered.has(w)) throw new Error(`Grade ${pack.grade} term ${term}: week ${w} has no competency.`);
        return { term, weeks, competencies: own.length };
      });
      return { grade: pack.grade, competencies: pack.competencies.length, weeks: terms.reduce((n, t) => n + t.weeks, 0), terms };
    });
  return {
    curriculumVersion: [...versions][0]!,
    grades,
    competencies: grades.reduce((n, g) => n + g.competencies, 0),
    weeks: grades.reduce((n, g) => n + g.weeks, 0),
  };
}

/** A week of the teaching-pack library, as its public index lists it. */
export interface PackWeek {
  grade: string;
  term: number;
  week: number;
  variants: Record<string, { status: string } | undefined>;
}

const BUILT = new Set(['approved', 'draft', 'needs_work']);
export const weekKey = (grade: string, term: number, week: number) => `${grade}.${term}.${week}`;

/**
 * Which weeks have a pack to read in `lang`, and whether any of them has been approved by a reviewer. A week counts
 * only inside the curriculum map (a pack for a week the map does not have is not shown as coverage).
 */
export function packWeeks(index: { curriculumVersion?: string; packs: PackWeek[] } | null, coverage: ScienceCoverage, lang: string): { built: Set<string>; approved: number } | null {
  if (!index || (index.curriculumVersion && index.curriculumVersion !== coverage.curriculumVersion)) return null;
  const inMap = new Set<string>();
  for (const g of coverage.grades) for (const t of g.terms) for (let w = 1; w <= t.weeks; w++) inMap.add(weekKey(g.grade, t.term, w));
  const built = new Set<string>();
  let approved = 0;
  for (const p of index.packs) {
    const status = p.variants[lang]?.status;
    const key = weekKey(p.grade, p.term, p.week);
    if (!status || !BUILT.has(status) || !inMap.has(key)) continue;
    built.add(key);
    if (status === 'approved') approved++;
  }
  return { built, approved };
}
