import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { auditedGrades, lessonsForGrade, planLesson, lessonFactId } from '../src/data/lessonPlan';
import { readingCollections, planExtraReading } from '../src/data/lessonExploration';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const inventory = [
  ...read('../src/generated/cardsIndex.generated.json').cards,
  ...read('../src/data/grade5LessonSupplement.json').cards,
  ...read('../src/data/grade3LessonSupplement.json').cards,
  ...read('../src/data/grade4LessonSupplement.json').cards,
  ...read('../src/data/grade6LessonSupplement.json').cards,
  ...read('../src/data/grade7LessonSupplement.json').cards,
  ...read('../src/data/grade8LessonSupplement.json').cards,
  ...read('../src/data/grade9LessonSupplement.json').cards,
  ...read('../src/data/grade10LessonSupplement.json').cards,
];
const facts = (ids: Iterable<string>) =>
  new Set([...ids].map((id) => C.getCard(id)?.factId ?? lessonFactId(id)));
const tagged = new Map<number, Set<string>>();
for (const card of inventory)
  for (const code of C.competencyKeys(card.id)) {
    const grade = Number(/^G(\d+)-/.exec(code)?.[1]);
    if (grade) {
      if (!tagged.has(grade)) tagged.set(grade, new Set());
      tagged.get(grade)!.add(card.factId);
    }
  }
const allCalendarFacts = new Set<string>();
const allCalendarCards = new Set<string>();
const grades = [3, 4, 5, 6, 7, 8, 9, 10].map((grade) => {
  const topics = C.curriculumOutline(grade).map((t: any) => ({
    key: t.key,
    title: t.title.en,
    reachableCards: C.cardsForTopic(t).size,
    reachableFacts: facts(C.cardsForTopic(t)).size,
  }));
  const reachable = facts(C.curriculumOutline(grade).flatMap((t: any) => [...C.cardsForTopic(t)]));
  const reachableCards = new Set<string>(
    C.curriculumOutline(grade).flatMap((t: any) => [...C.cardsForTopic(t)])
  );
  for (const id of reachableCards) allCalendarCards.add(id);
  for (const fact of reachable) allCalendarFacts.add(fact);
  const shelves = new Map<string, Set<string>>();
  for (const card of inventory) {
    if (!tagged.get(grade)?.has(card.factId) || reachable.has(card.factId)) continue;
    for (const cat of card.cats?.length ? card.cats : ['uncategorized']) {
      if (!shelves.has(cat)) shelves.set(cat, new Set());
      shelves.get(cat)!.add(card.factId);
    }
  }
  return {
    grade,
    reachableCards: reachableCards.size,
    outsideCalendarShelves: [...shelves]
      .map(([category, ids]) => ({ category, uniqueFacts: ids.size }))
      .sort((a, b) => b.uniqueFacts - a.uniqueFacts || a.category.localeCompare(b.category)),
    taggedFacts: tagged.get(grade)?.size ?? 0,
    reachableFacts: reachable.size,
    taggedButOutsideCalendar: [...(tagged.get(grade) ?? [])].filter((id) => !reachable.has(id))
      .length,
    sequencing: lessonsForGrade(grade).length
      ? 'bounded two-pool lessons'
      : 'existing topic-exhaustion sequencing',
    topics,
  };
});
function simulate(grade: number) {
  const lessons = lessonsForGrade(grade);
  const seen = new Set<string>();
  const byLesson = new Map(lessons.map((l) => [l.key, new Set<string>()]));
  const snapshots: any[] = [];
  for (let visit = 1; visit <= 20; visit++) {
    for (const lesson of lessons) {
      // The audit is a reproducible projection, not a random student session.
      const run = planLesson(lesson, seen, undefined, visit);
      for (const id of run.cards) {
        seen.add(id);
        byLesson.get(lesson.key)!.add(lessonFactId(id));
      }
    }
    if ([1, 3, 5, 10, 20].includes(visit))
      snapshots.push({
        visitsPerLesson: visit,
        uniqueCards: seen.size,
        uniqueFacts: facts(seen).size,
        lessons: lessons.map((l) => ({
          key: l.key,
          eligibleCards: l.cardIds.length,
          uniqueFacts: byLesson.get(l.key)!.size,
          eligibleFacts: facts(l.cardIds).size,
        })),
      });
  }
  const core = facts(lessons.flatMap((l) => l.coreCardIds));
  const coreCards = new Set(lessons.flatMap((l) => l.coreCardIds));
  const allCards = new Set(lessons.flatMap((l) => l.cardIds));
  const all = facts(lessons.flatMap((l) => l.cardIds));
  const seenFacts = facts(seen);
  return {
    coreCards: coreCards.size,
    reachableCards: allCards.size,
    additionalCards: allCards.size - coreCards.size,
    coreFacts: core.size,
    reachableFacts: all.size,
    newlyReachableFacts: all.size - core.size,
    simulations: snapshots,
    outsideAfter20Visits: [...all].filter((id) => !seenFacts.has(id)).length,
  };
}
function explore(grade: number) {
  const seen = new Set<string>();
  let runs = 0;
  for (const c of readingCollections(grade)) {
    for (;;) {
      const run = planExtraReading(
        c.lesson,
        seen,
        { key: lessonsForGrade(grade)[0]!.key },
        undefined,
        runs + 1
      );
      if (!run) break;
      assert.ok(++runs < 1000, 'Nonterminating optional reading');
      for (const id of run.cards) {
        assert.ok(!seen.has(id));
        seen.add(id);
      }
    }
  }
  return {
    grade,
    collectionCount: readingCollections(grade).length,
    boundedRuns: runs,
    uniqueCards: seen.size,
    eligibleCards: new Set(readingCollections(grade).flatMap((c) => c.lesson.cardIds)).size,
    unreadAfterExploring: readingCollections(grade)
      .flatMap((c) => c.lesson.cardIds)
      .filter((id) => !seen.has(id)).length,
  };
}
const projections = Object.fromEntries(
  auditedGrades.map((grade) => [`grade${grade}`, simulate(grade)])
);
const report = {
  schema: 2,
  scope:
    'Card IDs are the primary counting unit. Source facts are reported separately. Simulations measure reachability, not actual student engagement or mastery.',
  cards: (() => {
    const main = new Set<string>(
      read('../src/generated/cardsIndex.generated.json').cards.map((c: any) => c.id)
    );
    const used = [...main].filter((id) => allCalendarCards.has(id)).length;
    return {
      mainBank: main.size,
      mainBankInCurriculum: used,
      mainBankOutsideCurriculum: main.size - used,
      mainBankPercentInCurriculum: (100 * used) / main.size,
      supplementalInCurriculum: [...allCalendarCards].filter((id) => !main.has(id)).length,
      allCurriculum: allCalendarCards.size,
    };
  })(),
  optionalReadingSimulations: auditedGrades.map(explore),
  inventoryFacts: new Set(inventory.map((c) => c.factId)).size,
  allCalendarFacts: allCalendarFacts.size,
  outsideAllCalendars: new Set(
    inventory.filter((c) => !allCalendarFacts.has(c.factId)).map((c) => c.factId)
  ).size,
  grades,
  ...projections,
};
const path = new URL('../../../docs/content-reach.json', import.meta.url);
const text = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--check'))
  assert.equal(readFileSync(path, 'utf8'), text, 'Content reach report is stale');
else writeFileSync(path, text);
console.log(
  JSON.stringify(
    {
      cards: report.cards,
      optionalReadingSimulations: report.optionalReadingSimulations,
      lessonVisits: Object.fromEntries(
        Object.entries(projections).map(([grade, values]) => [
          grade,
          {
            ...values,
            simulations: values.simulations.map(
              ({ visitsPerLesson, uniqueCards, uniqueFacts }: any) => ({
                visitsPerLesson,
                uniqueCards,
                uniqueFacts,
              })
            ),
          },
        ])
      ),
    },
    null,
    2
  )
);
