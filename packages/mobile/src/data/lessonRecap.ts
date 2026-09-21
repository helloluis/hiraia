import type { LessonRun } from './lessonPlan';

/** Serializable boundary: only cards actually visited in this run, never a mastery claim. */
export interface LessonRecap {
  version: 1;
  grade: number;
  key: string;
  title: { en: string; tl: string; bis: string };
  run: LessonRun;
  cardIds: string[];
  nextKey: string;
  nextRun?: LessonRun;
}

export function completedLessonCards(run: LessonRun, currentId: string): string[] {
  const visited = new Set([...run.completed, currentId]);
  return run.cards.filter((id) => visited.has(id));
}

export function parseLessonRecap(
  raw: string | null,
  grade: number,
  eligible: (key: string, shelf?: string) => ReadonlySet<string> | null
): LessonRecap | null {
  try {
    const r = JSON.parse(raw ?? 'null') as LessonRecap;
    if (
      !r ||
      r.version !== 1 ||
      r.grade !== grade ||
      typeof r.nextKey !== 'string' ||
      r.run?.version !== 1 ||
      r.run?.key !== r.key ||
      !['en', 'tl', 'bis'].every((k) => typeof r.title?.[k as keyof typeof r.title] === 'string') ||
      !Array.isArray(r.cardIds) ||
      !r.cardIds.length ||
      !Array.isArray(r.run.cards) ||
      !Array.isArray(r.run.completed) ||
      new Set(r.cardIds).size !== r.cardIds.length ||
      r.cardIds.length !== r.run.cards.length ||
      !r.cardIds.every(
        (id) => typeof id === 'string' && r.run.cards.includes(id) && r.run.completed.includes(id)
      )
    )
      return null;
    const ids = eligible(r.key, r.run.shelfCat);
    return ids && r.cardIds.every((id) => ids.has(id)) ? r : null;
  } catch {
    return null;
  }
}

export function lessonRunFinished(
  run: LessonRun | undefined,
  currentId: string | undefined
): boolean {
  return (
    !!run &&
    !!currentId &&
    run.cards.includes(currentId) &&
    completedLessonCards(run, currentId).length === run.cards.length
  );
}
