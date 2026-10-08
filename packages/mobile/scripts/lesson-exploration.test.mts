import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { loadCards } from './load-cards-node.mts';
import { auditedGrades, lessonsForGrade, lessonFactId, planLesson } from '../src/data/lessonPlan';
import {
  planExtraReading,
  readingCollections,
  suggestedCollections,
  unreadReadingCards,
} from '../src/data/lessonExploration';
import { parseLessonRecap } from '../src/data/lessonRecap';

const C = await loadCards();
test('a previously viewed alternate bank card is not advertised as new reading', () => {
  const index = JSON.parse(
    readFileSync(new URL('../src/generated/cardsIndex.generated.json', import.meta.url), 'utf8')
  );
  const inLessons = new Set(
    auditedGrades.flatMap((g) => lessonsForGrade(g).flatMap((l) => l.cardIds))
  );
  const outside = new Map(
    index.cards.filter((c: any) => !inLessons.has(c.id)).map((c: any) => [c.factId, c.id])
  );
  const original = [...inLessons].find((id) => outside.has(C.getCard(id)?.factId))!;
  assert.ok(original, 'Real alternate-wording fixture');
  const alternate = outside.get(C.getCard(original).factId) as string;
  const seen = new Set([alternate]);
  assert.deepEqual(
    unreadReadingCards([original], seen, (id) => C.getCard(id)?.factId ?? id),
    []
  );
  const lesson = auditedGrades
    .flatMap((g) => lessonsForGrade(g))
    .find((l) => l.cardIds.includes(original))!;
  const extra = C.curriculumCursor(
    Number(/^g(\d+)/.exec(lesson.key)![1]),
    lesson.key,
    seen,
    undefined,
    undefined,
    { key: lesson.key }
  );
  assert.ok(!extra.lessonRun.cards.includes(original));
});
for (const grade of auditedGrades) {
  test(`Grade ${grade}: optional collections reach every reviewed source without adding unreviewed cards`, () => {
    const lessons = lessonsForGrade(grade);
    const allowed = new Set(lessons.flatMap((l) => l.cardIds));
    const required = new Set([...allowed].map(lessonFactId));
    const read = new Set<string>();
    const originalTopics = C.curriculumOutline(grade).map((t: any) => t.key);
    const collections = readingCollections(grade);
    assert.equal(collections.length, 4);
    for (const collection of collections) {
      const topic = C.readingCollectionTopics(grade).find((t: any) => t.key === collection.key);
      assert.ok(topic);
      assert.deepEqual(new Set(C.cardsForTopic(topic)), new Set(collection.lesson.cardIds));
      assert.deepEqual(collection.lesson.units, []);
      assert.deepEqual(collection.lesson.codes, []);
      for (const id of collection.lesson.cardIds) assert.ok(allowed.has(id), id);
      let iterations = 0;
      for (;;) {
        const cursor = C.curriculumCursor(grade, collection.key, read);
        if (!cursor) break;
        assert.ok(++iterations <= allowed.size);
        assert.equal(cursor.lessonRun.mode, 'exploration');
        assert.equal(C.cursorTopic(cursor).key, collection.key);
        assert.ok(cursor.lessonRun.cards.length <= 20);
        for (const id of cursor.lessonRun.cards) {
          assert.ok(!read.has(id), `repeated extra card: ${id}`);
          read.add(id);
        }
      }
      assert.equal(C.readingAvailability(grade, collection.key, read).unread, 0);
    }
    assert.deepEqual(new Set([...read].map(lessonFactId)), required);
    assert.deepEqual(
      C.curriculumOutline(grade).map((t: any) => t.key),
      originalTopics
    );
  });
}

test('read-more runs contain only unread cards, preserve a shelf, and return to the exact next lesson', () => {
  const lesson = lessonsForGrade(5).find((l) => l.key === 'g5:states-of-matter')!;
  const initial = planLesson(lesson, new Set(), undefined, 11);
  const seen = new Set(initial.cards);
  const dest = C.curriculumOutline(5).find((t: any) => t.key !== lesson.key)!;
  const next = C.curriculumCursor(5, dest.key, seen)!;
  const extra = C.curriculumCursor(5, lesson.key, seen, undefined, undefined, {
    key: next.key,
    run: next.lessonRun,
  });
  assert.ok(extra?.lessonRun.cards.length);
  assert.ok(extra.lessonRun.cards.every((id: string) => !seen.has(id)));
  assert.deepEqual(
    planLesson(lesson, seen, extra.lessonRun, 11).mode,
    undefined,
    'optional run cannot replace required coverage'
  );
  let cursor = extra;
  for (const id of extra.lessonRun.cards) {
    seen.add(id);
    cursor = C.advanceCurriculum(cursor, id, seen);
  }
  assert.equal(cursor.key, next.key);
  assert.deepEqual(cursor.lessonRun, next.lessonRun);
  const topic = C.curriculumOutline(5).find((t: any) => t.key === lesson.key)!;
  const shelf = C.topicShelves(topic, 'english').find((s: any) => s.ids.size >= 3)!;
  const scoped = C.curriculumCursor(5, lesson.key, new Set(), undefined, shelf.cat, {
    key: next.key,
  });
  assert.ok(scoped.lessonRun.cards.every((id: string) => shelf.ids.has(id)));
  assert.equal(scoped.lessonRun.shelfCat, shelf.cat);
});

test('a partially read collection survives serialization and resumes the interrupted core run', () => {
  const original = C.curriculumCursor(7, C.curriculumOutline(7)[0].key)!;
  original.lessonRun.completed = original.lessonRun.cards.slice(0, 3);
  const collection = readingCollections(7)[0]!;
  const seen = new Set<string>(original.lessonRun.completed);
  const extra = C.curriculumCursor(7, collection.key, seen, undefined, undefined, {
    key: original.key,
    run: original.lessonRun,
  });
  extra.lessonRun.completed = extra.lessonRun.cards.slice(0, 4);
  for (const id of extra.lessonRun.completed) seen.add(id);
  const restored = C.curriculumCursor(
    7,
    collection.key,
    seen,
    JSON.parse(JSON.stringify(extra.lessonRun))
  );
  assert.deepEqual(restored.lessonRun, extra.lessonRun);
  let cursor = restored;
  for (const id of extra.lessonRun.cards.slice(4)) cursor = C.advanceCurriculum(cursor, id, seen);
  assert.equal(cursor.key, original.key);
  assert.deepEqual(cursor.lessonRun.cards, original.lessonRun.cards);
  assert.deepEqual(cursor.lessonRun.completed, original.lessonRun.completed);
  assert.equal(C.curriculumCursor(6, collection.key, seen, extra.lessonRun), null);
  assert.equal(
    C.curriculumCursor(7, collection.key, seen, {
      ...extra.lessonRun,
      returnTo: { key: 'g5:states-of-matter' },
    }),
    null
  );
});

test('exhausted collection recap is valid after restart even though no unread run can start', () => {
  const collection = readingCollections(4)[0]!;
  const run = planExtraReading(
    collection.lesson,
    new Set(),
    { key: lessonsForGrade(4)[0]!.key },
    undefined,
    13
  )!;
  run.completed = [...run.cards];
  const seen = new Set(collection.lesson.cardIds);
  assert.equal(C.curriculumCursor(4, collection.key, seen), null);
  const recap = {
    version: 1,
    grade: 4,
    key: collection.key,
    title: collection.lesson.title,
    run,
    cardIds: run.cards,
    nextKey: run.returnTo!.key,
  };
  const parsed = parseLessonRecap(JSON.stringify(recap), 4, (key) => {
    const topic = C.readingCollectionTopics(4).find((t: any) => t.key === key);
    return topic ? C.cardsForTopic(topic) : null;
  });
  assert.deepEqual(parsed, recap);
  assert.ok(C.curriculumCursor(4, collection.key, seen, parsed!.run));
});

test('related suggestions are grade-bound, relevant, and disappear when fully read', () => {
  const lesson = lessonsForGrade(6)[0]!;
  const suggestions = suggestedCollections(6, lesson.key, new Set());
  assert.ok(suggestions.length);
  assert.ok(
    suggestions.every(
      (s) => s.collection.grade === 6 && s.collection.topicKeys.includes(lesson.key)
    )
  );
  const all = new Set(readingCollections(6).flatMap((c) => c.lesson.cardIds));
  assert.deepEqual(suggestedCollections(6, lesson.key, all), []);
});

test('store actions retain the original lesson when exploring from a recap or another collection', () => {
  const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
  const from = source.indexOf('  readMore: () => {');
  const to = source.indexOf('  titleCard: null,', from);
  assert.ok(from >= 0 && to > from);
  const code = transformSync(`return ({${source.slice(from, to)}});`, { loader: 'ts' }).code;
  const original = C.curriculumCursor(5, 'g5:states-of-matter');
  const collection = readingCollections(5)[0]!;
  const destination = { key: original.key, run: original.lessonRun };
  const calls: unknown[][] = [];
  const state: any = {
    curriculum: original,
    lessonRecap: null,
    enterCurriculum: (...args: unknown[]) => calls.push(args),
  };
  const actions = new Function('get', 'useEngineStore', code)(() => state, {
    getState: () => ({ grade: 5 }),
  });
  actions.exploreCollection(collection.key);
  assert.deepEqual(calls.pop(), [collection.key, undefined, undefined, destination]);
  state.curriculum = C.curriculumCursor(
    5,
    collection.key,
    new Set(),
    undefined,
    undefined,
    destination
  );
  actions.exploreCollection(readingCollections(5)[1]!.key);
  assert.deepEqual(calls.pop(), [readingCollections(5)[1]!.key, undefined, undefined, destination]);
  state.lessonRecap = {
    grade: 5,
    key: original.key,
    run: { shelfCat: 'matter' },
    nextKey: destination.key,
    nextRun: destination.run,
  };
  actions.readMore();
  assert.deepEqual(calls.pop(), [original.key, undefined, 'matter', destination]);
  actions.exploreCollection(collection.key);
  assert.deepEqual(calls.pop(), [collection.key, undefined, undefined, destination]);
  state.lessonRecap.grade = 4;
  actions.readMore();
  actions.exploreCollection('explore:g4:M');
  assert.equal(calls.length, 0, 'another profile grade cannot supply navigation');
});

test('optional reading cannot change quiz state or grant curriculum stars', async () => {
  const source = readFileSync(new URL('../src/reviews/store.ts', import.meta.url), 'utf8');
  const code = source
    .slice(
      source.indexOf('export async function interceptReview('),
      source.indexOf('export function shownReview(')
    )
    .replace('export ', '');
  let writes = 0;
  const store = {
    getState: () => ({ busy: false, open: false }),
    setState: () => {
      writes++;
    },
  };
  const js = transformSync(`${code}\nreturn interceptReview;`, { loader: 'ts' }).code;
  const intercept = new Function('preparing', 'useReviewStore', js)(null, store);
  assert.equal(await intercept({ exploration: true }), false);
  assert.equal(writes, 0);
});

test('resetting session exclusions for a repeat does not reset persistent card progress', () => {
  const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
  const code = source
    .slice(
      source.indexOf('export function readingHistory('),
      source.indexOf('/**\n * Fresh weighting context')
    )
    .replace('export ', '');
  const persisted = {
    cards: new Map([
      ['card-a', { count: 3 }],
      ['card-b', { count: 1 }],
    ]),
  };
  const fn = new Function(
    'seenStore',
    transformSync(code + '\nreturn readingHistory;', { loader: 'ts' }).code
  )(persisted);
  const snapshot = fn();
  snapshot.delete('card-a');
  assert.deepEqual([...fn()], ['card-a', 'card-b']);
  persisted.cards.set('card-c', { count: 1 });
  assert.equal(fn().size, 3);
});
