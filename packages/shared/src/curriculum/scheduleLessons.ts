export type Term = 1 | 2 | 3;
export interface CompetencySchedule {
  grade: number;
  sourceQuarter: number;
  term: Term;
  weeks: readonly number[];
  order: number;
  status: string;
  heading: string;
}
export interface ScheduledLesson {
  key: string;
  codes: string[];
  units: { competency: string; cardIds: string[]; quizCardIds: string[] }[];
  cardIds: string[];
  coreCardIds: string[];
  relatedCardIds: string[];
  relatedGroups: { key: string; cardIds: string[] }[];
}

/** Retain stable lesson/competency IDs. Only a lesson crossing a term boundary gets
 * a second view; the first keeps its saved key, and both keep their objective IDs. */
export function scheduleLessons<T extends ScheduledLesson>(
  lessons: readonly T[],
  mapping: Record<string, CompetencySchedule>,
  codesForCard: (id: string) => readonly string[]
): (T & { term: Term; weeks: number[]; order: number; sourceKey: string })[] {
  return lessons
    .flatMap((lesson) => {
      const placements = lesson.codes.map((code) => {
        const row = mapping[code];
        if (!row) throw new Error(`Missing three-term mapping: ${code}`);
        return row;
      });
      const terms = [...new Set(placements.map((p) => p.term))].sort();
      return terms.map((term, index) => {
        const codes = lesson.codes.filter((code) => mapping[code]!.term === term);
        const rows = codes.map((code) => mapping[code]!);
        const units = lesson.units.filter((unit) => codes.includes(unit.competency));
        const coreCardIds = [...new Set(units.flatMap((unit) => unit.cardIds))];
        const relatedCardIds =
          terms.length > 1
            ? lesson.relatedCardIds.filter((id) =>
                codesForCard(id).some((code) => codes.includes(code))
              )
            : lesson.relatedCardIds;
        return {
          ...lesson,
          key: index === 0 ? lesson.key : `${lesson.key}:term${term}`,
          sourceKey: lesson.key,
          codes,
          units,
          // Unsplit lessons keep their exact deck and revision. A split excludes the
          // other term's core cards, but keeps the curated related examples.
          ...(terms.length > 1
            ? {
                coreCardIds,
                relatedCardIds,
                relatedGroups: lesson.relatedGroups
                  .map((group) => ({
                    ...group,
                    cardIds: group.cardIds.filter((id) => relatedCardIds.includes(id)),
                  }))
                  .filter((group) => group.cardIds.length),
                cardIds: [...new Set([...coreCardIds, ...relatedCardIds])],
              }
            : {}),
          term,
          weeks: [
            Math.min(...rows.map((r) => r.weeks[0]!)),
            Math.max(...rows.map((r) => r.weeks[1]!)),
          ],
          order: Math.min(...rows.map((r) => r.order)),
        };
      });
    })
    .sort((a, b) => a.term - b.term || a.order - b.order);
}
