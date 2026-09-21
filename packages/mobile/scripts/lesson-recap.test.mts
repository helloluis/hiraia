import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { completedLessonCards, lessonRunFinished, parseLessonRecap } from '../src/data/lessonRecap';
import { planLesson, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';

const C = await loadCards();
const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function compile(body: string, scope: Record<string, unknown>) {
  const js = transformSync(body, { loader: 'ts', target: 'es2022' }).code;
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}
const boundary = compile(
  section('function boundaryRecap(', 'type Set_') + '\nreturn boundaryRecap;',
  {
    completedLessonCards,
    lessonRunFinished,
    cursorTopic: C.cursorTopic,
    topicShelves: C.topicShelves,
  }
);

function fixture() {
  const original = C.curriculumCursor(5, 'g5:states-of-matter', new Set())!;
  const cards = original.lessonRun.cards;
  const last = cards[cards.length - 1];
  const currentTopic = {
    ...original,
    lessonRun: { ...original.lessonRun, completed: cards.slice(0, -1) },
  };
  const seen = new Set(cards);
  const curriculum = C.advanceCurriculum(currentTopic, last, seen);
  return {
    currentTopic,
    curriculum,
    current: C.getCard(last),
    seen,
    magnet: null,
    pageKey: 42,
    pagesRead: 30,
    correctCount: 8,
    choices: [{ factId: [...curriculum.idSet][0], kind: 'deep', label: '' }],
  };
}

test('recap covers only the finished run, retains destination and survives serialization', () => {
  const s = fixture();
  const recap = boundary(s);
  assert.ok(recap);
  assert.deepEqual(recap.cardIds, s.currentTopic.lessonRun.cards);
  assert.equal(recap.nextKey, s.curriculum.key);
  assert.equal(lessonRunFinished(s.currentTopic.lessonRun, s.current.id), true);
  const eligible = (key: string) => new Set(lessonsForGrade(5).find((l) => l.key === key)?.cardIds);
  assert.deepEqual(parseLessonRecap(JSON.stringify(recap), 5, eligible), recap);
  assert.equal(parseLessonRecap(JSON.stringify(recap), 6, eligible), null);
  assert.equal(
    parseLessonRecap(
      JSON.stringify({ ...recap, cardIds: [...recap.cardIds, 'unread'] }),
      5,
      eligible
    ),
    null
  );
  assert.equal(
    parseLessonRecap(JSON.stringify(recap), 5, () => new Set()),
    null
  );
  assert.equal(boundary({ ...s, magnet: { query: 'brain' } }), null);
  const partial = { ...s.currentTopic, lessonRun: { ...s.currentTopic.lessonRun, completed: [] } };
  assert.equal(boundary({ ...s, currentTopic: partial }), null);
  assert.deepEqual(completedLessonCards(partial.lessonRun, s.current.id), [s.current.id]);
});

test('post-quiz navigation inserts recap without another read; swipe continues exactly once', () => {
  let state: any = {
    ...fixture(),
    recent: [],
    viewLog: [],
    reinforcementQueue: [],
    remediationQueue: [],
    untilQuestion: 5,
    untilReward: 1,
    threadDepth: 0,
    question: null,
    reward: null,
    response: null,
  };
  const before = { pages: state.pagesRead, correct: state.correctCount, seen: [...state.seen] };
  const set = (patch: any) => {
    state = { ...state, ...patch };
  };
  let marked = 0;
  const advance = compile(
    section('function advance(', '// REWARD-LINE PREFETCH SCHEDULER') + '\nreturn advance;',
    {
      boundaryRecap: boundary,
      warmPage: async () => {},
      nextRewardGap: () => 20,
      getCard: C.getCard,
      useEngineStore: { getState: () => ({ language: 'english', grade: 5 }) },
      RECENT_WINDOW: 8,
      VIEWLOG_CAP: 40,
      magnetAfter: () => null,
      advanceCurriculum: C.advanceCurriculum,
      feedContext: (_m: any, c: any) => ({
        studentGrade: 5,
        currentQuarter: 1,
        now: 100,
        cardSeen: new Map(),
        competencySeen: new Map(),
        curriculum: c ? { ids: c.idSet } : undefined,
      }),
      markSeen: () => marked++,
      cardTitle: C.cardTitle,
      withoutCard: (ids: string[], id: string) => ids.filter((x) => x !== id),
      previewCache: null,
      nextChoices: C.nextChoices,
      withReinforcement: (choices: any) => choices,
      reviewFeedQueue: () => [],
      introduce: () => ({ titleCard: null }),
      persist: () => {},
      acknowledgeReinforcement: () => {},
      warmAfter: () => {},
    }
  );
  const choice = state.choices[0];
  const afterReview = compile(
    'return ({' +
      section('  continueAfterReview: (choice) => {', '  recordReviewGrade:') +
      '}).continueAfterReview;',
    {
      get: () => state,
      set,
      advance,
      remediationQueueFromReview: () => [],
      useReviewStore: { getState: () => ({ data: { reinforcement: [] } }) },
    }
  );
  afterReview(choice);
  assert.ok(state.lessonRecap);
  assert.equal(marked, 0);
  assert.equal(state.pagesRead, before.pages);
  assert.equal(state.correctCount, before.correct);
  assert.deepEqual([...state.seen], before.seen);
  assert.equal(state.pending, choice);
  const proceed = compile(
    'return ({' +
      section('  continueAfterLessonRecap: () => {', '  repeatLesson:') +
      '}).continueAfterLessonRecap;',
    { get: () => state, set, advance }
  );
  proceed();
  assert.equal(state.lessonRecap, null);
  assert.equal(state.current.id, choice.factId);
  assert.equal(state.pagesRead, before.pages + 1);
  assert.equal(marked, 1);
  assert.ok(state.seen.has(choice.factId));
  proceed();
  assert.equal(marked, 1, 'double tap cannot consume a second card');
});

test('repeat keeps the selected shelf and history but requests a fresh plan', () => {
  const state: any = fixture();
  state.lessonRecap = boundary(state);
  state.lessonRecap.run.shelfCat = 'a-selected-shelf';
  let entered: unknown[],
    sections = 0;
  state.enterCurriculum = (...args: unknown[]) => {
    entered = args;
  };
  const repeat = compile(
    'return ({' + section('  repeatLesson: () => {', '  titleCard: null,') + '}).repeatLesson;',
    {
      get: () => state,
      beginTitleSection: () => sections++,
    }
  );
  const before = [...state.seen];
  repeat();
  assert.deepEqual(entered!, [state.lessonRecap.key, undefined, 'a-selected-shelf']);
  assert.deepEqual([...state.seen], before);
  assert.equal(sections, 1);
  const lesson = lessonsForGrade(5).find((l) => l.key === 'g5:states-of-matter')!;
  const first = planLesson(lesson, new Set(), undefined, 23);
  const second = planLesson(lesson, new Set(first.cards), undefined, 99);
  assert.ok(second.cards.filter((id) => !first.cards.includes(id)).length >= 15);
});

test('core objectives stay in authored order and optional topic groups remain contiguous', () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => prefix + i);
  const coreA = ids('foundation', 6),
    coreB = ids('application', 6);
  const related = ['example-a', 'example-b', 'example-c'].map((key) => ({
    key,
    cardIds: ids(key, 10),
  }));
  const base = lessonsForGrade(5)[0]!;
  const lesson = {
    ...base,
    revision: 'synthetic',
    target: 25,
    units: [
      { ...base.units[0]!, cardIds: coreA, quizCardIds: coreA },
      { ...base.units[0]!, cardIds: coreB, quizCardIds: coreB },
    ],
    relatedGroups: related,
    cardIds: [...coreA, ...coreB, ...related.flatMap((g) => g.cardIds)],
  };
  const starts = new Set<string>();
  for (let seed = 0; seed < 20; seed++) {
    const run = planLesson(lesson, new Set(), undefined, seed);
    starts.add(run.cards[0]!);
    const groups = run.cards.map((id) =>
      coreA.includes(id)
        ? 0
        : coreB.includes(id)
          ? 1
          : related.findIndex((g) => g.cardIds.includes(id)) + 2
    );
    assert.equal(groups[0], 0);
    const blocks = groups.filter((g, i) => i === 0 || g !== groups[i - 1]);
    assert.equal(
      new Set(blocks).size,
      blocks.length,
      'no card-by-card bouncing back into a previous group'
    );
    assert.ok(groups.indexOf(1) > groups.lastIndexOf(0));
    assert.ok(groups.filter((g) => g >= 2).length >= 10, 'retains broad example selection');
  }
  assert.ok(starts.size >= 3, 'multiple starting examples, same prerequisite unit first');
});
