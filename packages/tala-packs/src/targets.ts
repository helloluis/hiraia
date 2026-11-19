/**
 * Weekly teaching-pack targets, derived only from the curriculum packs Tala already serves
 * (packages/tala-server/data/packs, DepEd 2026 Three-Term Budgets of Work). Nothing here invents a week,
 * competency or coverage: a target exists for every week number a term's printed week cells reach, and its
 * competencies are exactly those whose printed range includes that week.
 *
 * DepEd prints some overlapping cells (e.g. Grade 7 Term 3 "Heat Transfer 1 to 4" and "Earthquakes 3 to 8");
 * they are kept as printed and each competency carries its position inside its own range.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const SCIENCE_VERSION = 'science-bow-2026';
export const SCIENCE_GRADES = ['3', '4', '5', '6', '7', '8', '9', '10'] as const;
export type ScienceGrade = (typeof SCIENCE_GRADES)[number];

export interface CurriculumCompetency {
  id: string;
  grade: string;
  termIndex: number;
  sequence: number;
  text: string;
  textLang: string;
  contentStandard: string | null;
  performanceStandard: string | null;
  domain: string | null;
  shortTitle?: string;
  shortTitleSource?: string;
  officialHeading?: string;
  weekFrom?: number;
  weekTo?: number;
  source: { document: string; edition: string; page: number; pageTo?: number; url: string };
}

export interface CurriculumPackFile {
  packId: string;
  curriculumVersion: string;
  grade: string;
  learningAreaId: string;
  dataRevision: number;
  competencies: CurriculumCompetency[];
}

export interface TargetCompetency {
  id: string;
  text: string;
  shortTitle: string | null;
  domain: string | null;
  weekFrom: number;
  weekTo: number;
  /** 1-based position of this week inside the competency's printed range. */
  position: number;
  /** Length of the printed range in weeks. */
  spanWeeks: number;
  sourcePage: number;
  sourceDocument: string;
  sourceEdition: string;
  sourceUrl: string;
}

export interface WeekTarget {
  /** Stable id: `sci26-g<grade>-t<term>-w<week, 2 digits>`; fits the 64-char record Id. */
  targetId: string;
  curriculumVersion: string;
  curriculumPackId: string;
  curriculumDataRevision: number;
  learningAreaId: 'science';
  grade: string;
  term: number;
  week: number;
  /** Last week number the term's printed cells reach (10 or 11 in the 2026 Science BOWs). */
  termWeeks: number;
  competencies: TargetCompetency[];
  /** Distinct printed week ranges present this week; >1 means DepEd's cells overlap here. */
  ranges: Array<{ weekFrom: number; weekTo: number }>;
  contentStandard: string | null;
  performanceStandard: string | null;
  /** The neighbouring weeks' topic titles, so a multi-week topic builds instead of repeating. */
  previousWeekTitles: string[];
  nextWeekTitles: string[];
  /** SHA-256 of the curriculum inputs this target was derived from (ids, texts, ranges). */
  inputHash: string;
}

export function targetId(grade: string, term: number, week: number): string {
  return `sci26-g${grade}-t${term}-w${String(week).padStart(2, '0')}`;
}

export function loadSciencePacks(packsDir: string): CurriculumPackFile[] {
  const files = readdirSync(packsDir).filter((f) => /^science-bow-2026-g\d+\.json$/.test(f));
  const packs = files.map((f) => JSON.parse(readFileSync(join(packsDir, f), 'utf8')) as CurriculumPackFile);
  packs.sort((a, b) => Number(a.grade) - Number(b.grade));
  return packs;
}

const titlesOf = (cs: CurriculumCompetency[]) => [
  ...new Set(cs.map((c) => c.shortTitle ?? c.domain ?? '').filter(Boolean)),
];

export function buildTargets(packs: CurriculumPackFile[]): WeekTarget[] {
  const out: WeekTarget[] = [];
  for (const pack of packs) {
    if (pack.curriculumVersion !== SCIENCE_VERSION || pack.learningAreaId !== 'science') continue;
    const terms = [...new Set(pack.competencies.map((c) => c.termIndex))].sort((a, b) => a - b);
    for (const term of terms) {
      const cs = pack.competencies
        .filter((c) => c.termIndex === term)
        .sort((a, b) => a.sequence - b.sequence);
      const missingWeeks = cs.filter((c) => !c.weekFrom || !c.weekTo);
      if (missingWeeks.length)
        throw new Error(
          `Grade ${pack.grade} term ${term}: ${missingWeeks.length} competencies have no printed week; ` +
            'week targets cannot be derived without inventing placement.'
        );
      const termWeeks = Math.max(...cs.map((c) => c.weekTo!));
      for (let week = 1; week <= termWeeks; week++) {
        const here = cs.filter((c) => c.weekFrom! <= week && week <= c.weekTo!);
        const competencies: TargetCompetency[] = here.map((c) => ({
          id: c.id,
          text: c.text,
          shortTitle: c.shortTitle ?? null,
          domain: c.domain,
          weekFrom: c.weekFrom!,
          weekTo: c.weekTo!,
          position: week - c.weekFrom! + 1,
          spanWeeks: c.weekTo! - c.weekFrom! + 1,
          sourcePage: c.source.page,
          sourceDocument: c.source.document,
          sourceEdition: c.source.edition,
          sourceUrl: c.source.url,
        }));
        const ranges = [
          ...new Map(here.map((c) => [`${c.weekFrom}-${c.weekTo}`, { weekFrom: c.weekFrom!, weekTo: c.weekTo! }])).values(),
        ].sort((a, b) => a.weekFrom - b.weekFrom || a.weekTo - b.weekTo);
        const prev = cs.filter((c) => c.weekFrom! <= week - 1 && week - 1 <= c.weekTo!);
        const next = cs.filter((c) => c.weekFrom! <= week + 1 && week + 1 <= c.weekTo!);
        const first = here[0] ?? cs[0]!;
        const inputHash = createHash('sha256')
          .update(
            JSON.stringify({
              v: pack.curriculumVersion,
              r: pack.dataRevision,
              c: competencies.map((c) => [c.id, c.text, c.weekFrom, c.weekTo]),
            })
          )
          .digest('hex');
        out.push({
          targetId: targetId(pack.grade, term, week),
          curriculumVersion: pack.curriculumVersion,
          curriculumPackId: pack.packId,
          curriculumDataRevision: pack.dataRevision,
          learningAreaId: 'science',
          grade: pack.grade,
          term,
          week,
          termWeeks,
          competencies,
          ranges,
          contentStandard: first.contentStandard,
          performanceStandard: first.performanceStandard,
          previousWeekTitles: titlesOf(prev),
          nextWeekTitles: titlesOf(next),
          inputHash,
        });
      }
    }
  }
  return out;
}

/** One short display title for a target: the printed topic titles, joined. */
export function targetTopic(t: WeekTarget): string {
  return titlesOf(
    t.competencies.map((c) => ({ shortTitle: c.shortTitle ?? undefined, domain: c.domain }) as CurriculumCompetency)
  ).join(' · ');
}
