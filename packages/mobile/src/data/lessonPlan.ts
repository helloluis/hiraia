import grade9Manifest from '../generated/grade9Lessons.generated.json';
import grade10Manifest from '../generated/grade10Lessons.generated.json';
import grade8Manifest from '../generated/grade8Lessons.generated.json';
import grade7Manifest from '../generated/grade7Lessons.generated.json';
import grade6Manifest from '../generated/grade6Lessons.generated.json';
import manifest from '../generated/grade5Lessons.generated.json';
import grade4Manifest from '../generated/grade4Lessons.generated.json';
import grade3Manifest from '../generated/grade3Lessons.generated.json';
import { lessonRandom, lessonVariety } from './lessonVariety';

export const grade9Lessons = grade9Manifest.lessons;
export const grade10Lessons = grade10Manifest.lessons;
export const grade8Lessons = grade8Manifest.lessons;
export const grade7Lessons = grade7Manifest.lessons;
export const grade6Lessons = grade6Manifest.lessons;
export const grade5Lessons = manifest.lessons;
export const grade4Lessons = grade4Manifest.lessons;
export const grade3Lessons = grade3Manifest.lessons;
export const lessonsForGrade = (grade: number) =>
  grade === 3
    ? grade3Lessons
    : grade === 4
      ? grade4Lessons
      : grade === 5
        ? grade5Lessons
        : grade === 6
          ? grade6Lessons
          : grade === 7
            ? grade7Lessons
            : grade === 8
              ? grade8Lessons
              : grade === 9
                ? grade9Lessons
                : grade === 10
                  ? grade10Lessons
                  : [];
export const auditedGrades = [3, 4, 5, 6, 7, 8, 9, 10] as const;
const allLessons = [
  ...grade3Lessons,
  ...grade4Lessons,
  ...grade5Lessons,
  ...grade6Lessons,
  ...grade7Lessons,
  ...grade8Lessons,
  ...grade9Lessons,
  ...grade10Lessons,
];
const factIds: Record<string, string> = {
  ...grade3Manifest.factIds,
  ...grade4Manifest.factIds,
  ...manifest.factIds,
  ...grade6Manifest.factIds,
  ...grade7Manifest.factIds,
  ...grade8Manifest.factIds,
  ...grade9Manifest.factIds,
  ...grade10Manifest.factIds,
};
export const lessonFactId = (id: string) => factIds[id] ?? id;
export type Lesson = (typeof grade5Lessons)[number];
export interface LessonRun {
  version: 1;
  revision: string;
  key: string;
  cards: string[];
  completed: string[];
  shelfCat?: string;
  manualSelection?: boolean;
  /** New runs vary; saved runs keep their exact sequence across restarts/language changes. */
  seed?: number;
}
export const lessonByKey = (key: string) => allLessons.find((l) => l.key === key);
export function lessonObjectives(key: string | null, card: string): string[] {
  return (
    (key ? lessonByKey(key)?.units : undefined)
      ?.filter((u) => u.cardIds.includes(card))
      .map((u) => u.id) ?? []
  );
}
/** Cover each objective before filling remaining places, reserving unused facts for later visits. */
export function planLesson(
  lesson: Lesson,
  seen: ReadonlySet<string>,
  saved?: unknown,
  seed?: number
): LessonRun {
  const old = saved as LessonRun | undefined;
  if (
    old?.version === 1 &&
    old.key === lesson.key &&
    Array.isArray(old.cards) &&
    old.cards.length > 0 &&
    old.cards.length <= lesson.target &&
    new Set(old.cards.map(lessonFactId)).size === old.cards.length &&
    old.cards.every((id) => lesson.cardIds.includes(id)) &&
    Array.isArray(old.completed) &&
    old.completed.every((id) => old.cards.includes(id)) &&
    lesson.units.every((u) => (u.quizCardIds.length ? u.quizCardIds : u.cardIds).some((id) => old.cards.includes(id)))
  )
    return { ...old, revision: lesson.revision };
  const runSeed = (seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const random = lessonRandom(runSeed);
  const variety = lessonVariety(lesson.key, lesson.revision, lesson.cardIds, lessonFactId, random);
  const cards: string[] = [];
  const selectedFacts = new Set<string>();
  const seenFacts = new Set([...seen].map(lessonFactId));
  const available = (id: string) => !selectedFacts.has(lessonFactId(id));
  const unseen = (id: string) => !seenFacts.has(lessonFactId(id));
  const add = (id: string | undefined) => {
    if (id && available(id) && cards.length < lesson.target) {
      cards.push(id);
      selectedFacts.add(lessonFactId(id));
      variety.selected(id);
    }
  };
  const prefer = (ids: string[]) =>
    ids.find((id) => unseen(id) && available(id)) ?? ids.find(available);
  for (const unit of lesson.units) {
    if (!unit.quizCardIds.some((id) => cards.includes(id)))
      add(
        prefer(unit.quizCardIds.filter((id) => unseen(id))) ??
          prefer(unit.quizCardIds) ??
          prefer(unit.cardIds)
      );
  }
  // After the coverage anchors, rotate between examples and core material. Two
  // related slots per core slot allow the wider library to carry most of a rich run.
  // Every unseen pool is tried before any optional repeat. Scarce anchors may repeat.
  const core = lesson.units.map((u) => u.cardIds);
  const related = lesson.relatedGroups.map((g) => g.cardIds);
  let corePosition = Math.floor(random() * Math.max(1, core.length));
  let relatedPosition = Math.floor(random() * Math.max(1, related.length));
  const pick = (groups: string[][], isRelated: boolean, unseenOnly: boolean) => {
    const start = isRelated ? relatedPosition : corePosition;
    for (let offset = 0; offset < groups.length; offset++) {
      const position = (start + offset) % groups.length;
      let id: string | undefined;
      let best = -Infinity;
      for (const candidate of groups[position]!) {
        if (!available(candidate) || (unseenOnly && !unseen(candidate))) continue;
        const score = variety.score(candidate);
        if (score > best) { best = score; id = candidate; }
      }
      if (id) {
        add(id);
        if (isRelated) relatedPosition = position + 1;
        else corePosition = position + 1;
        return true;
      }
    }
    return false;
  };
  for (const unseenOnly of [true, false]) {
    let slot = 0;
    while (cards.length < lesson.target) {
      const useRelated = slot++ % 3 !== 2;
      if (
        !(useRelated
          ? pick(related, true, unseenOnly) || pick(core, false, unseenOnly)
          : pick(core, false, unseenOnly) || pick(related, true, unseenOnly))
      )
        break;
    }
  }
  return { version: 1, revision: lesson.revision, key: lesson.key, cards, completed: [], seed: runSeed };
}
