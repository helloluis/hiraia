import { DOMAIN_NAMES } from '@hiraia/shared/curriculum';
import { lessonFactId, lessonsForGrade, type Lesson, type LessonRun } from './lessonPlan';
import { lessonRandom, lessonVariety } from './lessonVariety';

const DOMAINS = {
  M: 'matter',
  L: 'living_things',
  F: 'force_motion_energy',
  E: 'earth_space',
} as const;
export interface ReadingCollection {
  key: string;
  grade: number;
  domain: keyof typeof DOMAINS;
  lesson: Lesson;
  topicKeys: string[];
}
const cache = new Map<number, ReadingCollection[]>();

/** These collections contain ONLY cards already admitted to lessons for this grade.
 * A taxonomy label, search hit or old automatic competency tag cannot add a card.
 * The four shared science headings are existing, localized curriculum vocabulary.
 */
export function readingCollections(grade: number): ReadingCollection[] {
  const cached = cache.get(grade);
  if (cached) return cached;
  const lessons = lessonsForGrade(grade);
  const collections: ReadingCollection[] = [];
  for (const [domain, name] of Object.entries(DOMAINS)) {
    const members = lessons.filter((l) => l.codes.some((c) => c.split('-')[1] === domain));
    const first = members[0];
    if (!first) continue;
    const facts = new Set<string>();
    const groups = members
      .map((l) => ({
        key: l.key,
        cardIds: l.cardIds.filter((id) => {
          const fact = lessonFactId(id);
          if (facts.has(fact)) return false;
          facts.add(fact);
          return true;
        }),
      }))
      .filter((g) => g.cardIds.length);
    const cardIds = groups.flatMap((g) => g.cardIds);
    if (!cardIds.length) continue;
    const key = `explore:g${grade}:${domain}`;
    const title = DOMAIN_NAMES[name];
    collections.push({
      key,
      grade,
      domain: domain as keyof typeof DOMAINS,
      topicKeys: members.map((l) => l.key),
      lesson: {
        ...first,
        key,
        sourceKey: key,
        title: { en: title.english, tl: title.tagalog, bis: title.cebuano },
        // Collections do not confer competency, objective or quiz coverage.
        units: [],
        codes: [],
        coreCardIds: [],
        subcategories: [],
        cardIds,
        relatedCardIds: cardIds,
        relatedGroups: groups,
        target: 20,
        revision: members.map((l) => `${l.key}:${l.revision}`).join('|'),
      },
    });
  }
  cache.set(grade, collections);
  return collections;
}

export function readingCollection(grade: number, key: string): ReadingCollection | undefined {
  return readingCollections(grade).find((c) => c.key === key);
}

/** Return actual eligible card IDs. A previously read alternate wording of the same
 * source is not advertised as new reading. Pools already select one ID per source.
 */
export function unreadReadingCards(
  ids: readonly string[],
  seen: ReadonlySet<string>,
  sourceOf = lessonFactId
): string[] {
  const readFacts = new Set([...seen].map(sourceOf));
  const selected = new Set<string>();
  return ids.filter((id) => {
    const fact = lessonFactId(id);
    if (seen.has(id) || readFacts.has(fact) || selected.has(fact)) return false;
    selected.add(fact);
    return true;
  });
}

export function planExtraReading(
  lesson: Lesson,
  seen: ReadonlySet<string>,
  returnTo: NonNullable<LessonRun['returnTo']>,
  saved?: unknown,
  seed?: number,
  sourceOf = lessonFactId
): LessonRun | null {
  const old = saved as LessonRun | undefined;
  // Saved order is authoritative even after some of its cards have been read.
  if (
    old?.version === 1 &&
    old.mode === 'exploration' &&
    old.key === lesson.key &&
    old.returnTo?.key === returnTo.key &&
    Array.isArray(old.cards) &&
    old.cards.length > 0 &&
    old.cards.length <= lesson.target &&
    old.cards.every((id) => lesson.cardIds.includes(id)) &&
    new Set(old.cards.map(lessonFactId)).size === old.cards.length &&
    Array.isArray(old.completed) &&
    old.completed.every((id) => old.cards.includes(id))
  )
    return { ...old, revision: lesson.revision, returnTo };

  const unseen = new Set(unreadReadingCards(lesson.cardIds, seen, sourceOf));
  if (!unseen.size) return null;
  const runSeed = (seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const random = lessonRandom(runSeed);
  const variety = lessonVariety(
    lesson.sourceKey,
    lesson.revision,
    [...unseen],
    lessonFactId,
    random
  );
  const cards: string[] = [];
  const groups = [
    ...lesson.units.map((u) => u.cardIds),
    ...lesson.relatedGroups.map((g) => g.cardIds),
  ];
  const grouped = new Set(groups.flat());
  const remaining = [...unseen].filter((id) => !grouped.has(id));
  if (remaining.length) groups.push(remaining);
  const start = Math.floor(random() * groups.length);
  // Short coherent blocks, rotating across reviewed topics, with no mandatory repeats.
  while (unseen.size && cards.length < lesson.target) {
    let progressed = false;
    for (let offset = 0; offset < groups.length && cards.length < lesson.target; offset++) {
      const group = groups[(start + offset) % groups.length]!;
      for (let slot = 0; slot < 4 && cards.length < lesson.target; slot++) {
        const next = group
          .filter((id) => unseen.has(id))
          .sort((a, b) => variety.score(b) - variety.score(a))[0];
        if (!next) break;
        cards.push(next);
        unseen.delete(next);
        variety.selected(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return {
    version: 1,
    mode: 'exploration',
    key: lesson.key,
    revision: lesson.revision,
    cards,
    completed: [],
    seed: runSeed,
    returnTo,
  };
}

export function suggestedCollections(
  grade: number,
  topicKey: string,
  seen: ReadonlySet<string>,
  sourceOf = lessonFactId
) {
  const collections = readingCollections(grade);
  const source = collections.find((c) => c.key === topicKey);
  const adjacent = collections.filter((c) => c.key !== topicKey && c.topicKeys.includes(topicKey));
  const candidates = source ? collections.filter((c) => c.key !== source.key) : adjacent;
  return candidates
    .map((c) => ({
      collection: c,
      unread: unreadReadingCards(c.lesson.cardIds, seen, sourceOf).length,
    }))
    .filter((c) => c.unread > 0)
    .sort((a, b) => b.unread - a.unread || a.collection.key.localeCompare(b.collection.key))
    .slice(0, 2);
}
