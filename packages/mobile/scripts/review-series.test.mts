import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  freshReview,
  observeCard,
  reviewDue,
  answerReview,
  nextQuestion,
  finishReview,
  deferReview,
  seriesScore,
  shuffleOptions,
  awardStars,
  overallStars,
  activateRemediation,
  remediationTarget,
} from '../src/reviews/logic';
// Existing batch-specific cases isolate series selection from the standalone cadence.
const batchOnlyReview = (grade: number) => ({ ...freshReview(grade), nextSingleTurn: Number.POSITIVE_INFINITY });
let serial = 0;
const id = () => `attempt_${++serial}`;
const q = (x: string): any => ({
  f: x,
  q: { en: 'Question' },
  o: [{ en: 'A' }, { en: 'B' }, { en: 'C' }],
  a: 1,
});
const card = (n: number, topic: string | null = 'plants') => ({
  id: String(n),
  factId: String(n),
  concept: `concept${n % 4}`,
  topic,
  subcategories: ['g5-living_things-plant-reproduction'],
});
test('20 unique viewed cards create 3 questions; repeated views and unavailable quizzes do not pad sets', () => {
  let s = batchOnlyReview(6);
  for (let i = 0; i < 19; i++) s = observeCard(s, card(i), 'Plants', false, q, 0, id);
  s = observeCard(s, card(0), 'Plants', false, q, 0, id);
  assert.equal(s.queue.length, 0);
  s = observeCard(s, card(19), 'Plants', false, q, 0, id);
  assert.equal(s.queue[0].items.length, 3);
  assert.equal(new Set(s.queue[0].items.map((a) => a.card.concept)).size, 3);
  let short = batchOnlyReview(6);
  for (let i = 0; i < 3; i++)
    short = observeCard(
      short,
      card(i),
      'Plants',
      i === 2,
      (x) => (x === '0' ? q(x) : undefined),
      0,
      id
    );
  assert.equal(short.queue[0].items.length, 1);
});
test('coincident topic and checkpoint triggers create one bounded recap of the completed topic', () => {
  let s = batchOnlyReview(6);
  for (let i = 0; i < 20; i++) s = observeCard(s, card(i), 'Plants', i === 19, q, 0, id);
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0].kind, 'topic');
  assert.equal(s.queue[0].title, 'Plants');
  assert.ok(s.queue[0].items.length <= 5);
  assert.equal(s.topic.key, null);
  assert.equal(s.recent.length, 0);
});
test('answers, option order and summaries survive serialization; double grading is ignored', () => {
  let s = batchOnlyReview(6);
  for (let i = 0; i < 3; i++) s = observeCard(s, card(i), 'Plants', i === 2, q, 0, id);
  const order = s.queue[0].items[0].order;
  s = answerReview(s, order.indexOf(1), 1);
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored.queue[0].items[0].order, order);
  assert.equal(answerReview(s, 0, 2), s);
  assert.equal(seriesScore(s.queue[0]), 1);
  while (s.queue[0].position < s.queue[0].items.length) {
    const a = s.queue[0].items[s.queue[0].position];
    s = answerReview(s, a.order.indexOf(1), 3);
    s = nextQuestion(s);
  }
  assert.equal(seriesScore(s.queue[0]), 3);
  s = finishReview(s);
  assert.equal(s.queue.length, 0);
  assert.equal(Object.values(s.history)[0].firstCorrect, true);
  assert.equal(awardStars(s.awards.plants), 3);
  assert.equal(overallStars(s), 3);
  assert.equal(s.reinforcement.length, 0);
});
test('missed quizzes queue source cards for reinforcement and completed topics earn stars', () => {
  let s = batchOnlyReview(5);
  for (let i = 0; i < 3; i++) s = observeCard(s, card(i, 'circuits'), 'Circuits', i === 2, q, 0, id);
  while (s.queue[0].position < s.queue[0].items.length) {
    const a = s.queue[0].items[s.queue[0].position];
    s = answerReview(s, a.order.indexOf(0), 1);
    s = nextQuestion(s);
  }
  assert.equal(s.reinforcement.length, 3);
  assert.deepEqual(
    new Set(s.reinforcement.map((c) => c.factId)),
    new Set(s.queue[0].items.map((a) => a.card.factId))
  );
  s = finishReview(s);
  assert.equal(awardStars(s.awards.circuits), 1);
  assert.equal(s.awards.circuits.runs, 1);
});
test('defer preserves an unfinished set and repeats become eligible only after spacing', () => {
  let s = batchOnlyReview(6);
  for (let i = 0; i < 3; i++) s = observeCard(s, card(i), 'Plants', i === 2, q, 0, id);
  s = deferReview(s);
  assert.equal(reviewDue(s), false);
  const saved = s.queue[0].id;
  for (let i = 0; i < 5; i++) s = observeCard(s, card(i + 10), 'Plants', false, q, 1, id);
  assert.equal(reviewDue(s), true);
  assert.equal(s.queue[0].id, saved);
  let retry = batchOnlyReview(6);
  retry.history['0'] = {
    attempts: 1,
    firstCorrect: false,
    correct: 0,
    lastCorrect: false,
    lastAt: 0,
    lastTurn: 0,
    card: card(0),
  };
  retry = observeCard(retry, card(0), 'Plants', true, q, 1, id);
  assert.equal(retry.queue.length, 0);
  retry.turns = 6;
  retry = observeCard(retry, card(0), 'Plants', true, q, 2, id);
  assert.equal(retry.queue[0].items[0].card.factId, '0');
  const permutation = shuffleOptions(4, () => 0);
  assert.deepEqual([...permutation].sort(), [0, 1, 2, 3]);
});

test('pending sets do not reserve the same quiz twice; correct repeats require spacing', () => {
  let s = batchOnlyReview(6);
  for (let i = 0; i < 20; i++) s = observeCard(s, card(i), 'Plants', false, q, 0, id);
  s = deferReview(s);
  s = observeCard(s, card(20), 'Plants', true, q, 1, id);
  const questions = s.queue.flatMap((series) => series.items.map((a) => a.card.factId));
  assert.equal(new Set(questions).size, questions.length);
  let review = batchOnlyReview(6);
  review.history['0'] = {
    attempts: 1,
    firstCorrect: true,
    correct: 1,
    lastCorrect: true,
    lastAt: 0,
    lastTurn: 0,
    card: card(0),
  };
  review = observeCard(review, card(0), 'Plants', true, q, 86400000, id);
  assert.equal(review.queue.length, 0);
  review = observeCard(review, card(0), 'Plants', true, q, 4 * 86400000, id);
  assert.equal(review.queue[0].items[0].attemptNumber, 2);
  const a = review.queue[0].items[0];
  review = answerReview(review, a.order.indexOf(0), 4 * 86400000 + 1);
  assert.equal(review.history['0'].firstCorrect, true);
  assert.equal(review.history['0'].lastCorrect, false);
});

test('only a strict-majority topic failure selects a remediation subcategory', () => {
  let s = batchOnlyReview(5);
  for (let i = 0; i < 3; i++) s = observeCard(s, card(i), 'Plants', i === 2, q, 0, id);
  for (let i = 0; i < s.queue[0].items.length; i++) {
    const attempt = s.queue[0].items[s.queue[0].position];
    s = answerReview(s, attempt.order.indexOf(i === 0 ? 1 : 0), i + 1);
    s = nextQuestion(s);
  }
  assert.equal(remediationTarget(s.queue[0]), 'g5-living_things-plant-reproduction');
});

test('remedial cards create a recap; a majority pass restores declared-grade flow', () => {
  let s = activateRemediation(batchOnlyReview(5), {
    target: 'g5-living_things-plant-reproduction',
    prerequisite: 'g4-living_things-plant-structures',
    instructionalGrade: 4,
    title: 'Plant reproduction',
    cardIds: ['10', '11', '12'],
    startedAt: 1,
  });
  for (let i = 10; i <= 12; i++) s = observeCard(s, card(i), '', false, q, i, id);
  assert.equal(s.grade, 5);
  assert.equal(s.queue[0].kind, 'remediation');
  while (s.queue[0].position < s.queue[0].items.length) {
    const attempt = s.queue[0].items[s.queue[0].position];
    const correct = s.queue[0].position < 2;
    s = answerReview(s, attempt.order.indexOf(correct ? 1 : 0), 20);
    s = nextQuestion(s);
  }
  s = finishReview(s);
  assert.equal(s.remediation, null);
  assert.equal(s.grade, 5);
});

test('a failed remedial recap repeats the lower-level run without changing declared grade', () => {
  let s = activateRemediation(batchOnlyReview(5), {
    target: 'g5-living_things-plant-reproduction',
    prerequisite: 'g4-living_things-plant-structures',
    instructionalGrade: 4,
    title: 'Plant reproduction',
    cardIds: ['20', '21', '22'],
    startedAt: 1,
  });
  for (let i = 20; i <= 22; i++) s = observeCard(s, card(i), '', false, q, i, id);
  while (s.queue[0].position < s.queue[0].items.length) {
    const attempt = s.queue[0].items[s.queue[0].position];
    s = answerReview(s, attempt.order.indexOf(0), 30);
    s = nextQuestion(s);
  }
  s = finishReview(s);
  assert.equal(s.remediation?.round, 2);
  assert.deepEqual(s.remediation?.viewed, []);
  assert.equal(s.grade, 5);
});

function complete(s: ReturnType<typeof freshReview>, correct = true) {
  while (s.queue[0].position < s.queue[0].items.length) {
    const a = s.queue[0].items[s.queue[0].position];
    s = answerReview(s, a.order.indexOf(correct ? 1 : 0), s.turns * 1000);
    s = nextQuestion(s);
  }
  return finishReview(s);
}

test('single quizzes at 5, 10 and 15 cards coexist with a 20-card series containing one repeat and two new questions', () => {
  let s = freshReview(6);
  const shown: Array<[number, string, number]> = [];
  for (let i = 1; i <= 40; i++) {
    s = observeCard(s, card(i), 'Plants', false, q, i * 1000, id);
    if (!reviewDue(s)) continue;
    const series = s.queue[0];
    shown.push([i, series.kind, series.items.length]);
    if (series.kind === 'checkpoint') {
      assert.equal(series.items.filter(a => a.attemptNumber > 1).length, 1);
      assert.equal(series.items.filter(a => a.attemptNumber === 1).length, 2);
      assert.equal(new Set(series.items.map(a => a.card.factId)).size, 3);
      for (const a of series.items) assert.deepEqual([...a.order].sort(), [0, 1, 2]);
    }
    s = complete(s);
    s = JSON.parse(JSON.stringify(s)); // cadence and history survive restarts
  }
  assert.deepEqual(shown, [
    [5,'single',1], [10,'single',1], [15,'single',1], [20,'checkpoint',3],
    [25,'single',1], [30,'single',1], [35,'single',1], [40,'checkpoint',3],
  ]);
  assert.equal(Object.values(s.history).reduce((n,h)=>n+h.attempts,0),12);
});

test('repeat slot prefers a missed answer and does not reuse a just-answered quiz', () => {
  let s = freshReview(6);
  let missed = '';
  for (let i = 1; i <= 20; i++) {
    s = observeCard(s, card(i), 'Plants', false, q, i * 1000, id);
    if (i === 5) missed = s.queue[0].items[0].card.factId;
    if (i < 20 && reviewDue(s)) s = complete(s, i !== 5);
  }
  assert.equal(s.queue[0].items.filter(a=>a.attemptNumber>1)[0].card.factId, missed);
  assert.equal(s.queue[0].items.filter(a=>a.attemptNumber>1).length,1);
});

test('sparse question banks still offer available singles and never manufacture quiz content', () => {
  let s = freshReview(6);
  const sparse = (x: string) => x === '7' ? q(x) : undefined;
  for (let i=1;i<=7;i++) s=observeCard(s,card(i),'Plants',false,sparse,i,id);
  assert.equal(s.queue[0].kind,'single');
  assert.equal(s.queue[0].items[0].card.id,'7');
  let empty=freshReview(6);
  for(let i=1;i<=25;i++) empty=observeCard(empty,card(i),'Plants',false,()=>undefined,i,id);
  assert.equal(empty.queue.length,0);
});


test('topics below 20 cards omit the third standalone round and keep their closing review', () => {
  for (const size of [3, 5, 10, 14, 15, 16, 19, 20, 21]) {
    let s = freshReview(6);
    const singles: number[] = [];
    for (let i = 1; i <= size; i++) {
      s = observeCard(s, card(i), 'Plants', i === size, q, i * 1000, id, size);
      if (s.queue[0]?.kind === 'single' && reviewDue(s)) {
        singles.push(i);
        s = complete(s);
      } else if (s.queue[0]?.kind === 'checkpoint' && reviewDue(s)) s = complete(s);
      s = JSON.parse(JSON.stringify(s));
    }
    assert.ok(s.queue.some(series => series.kind === 'topic'), `closing review for ${size} cards`);
    if (size < 20) {
      assert.ok(singles.length <= 2, `at most two singles for ${size} cards`);
      assert.ok(!singles.includes(15), `no third round for ${size} cards`);
    } else assert.deepEqual(singles, [5, 10, 15]);
    if (size >= 14 && size < 20) assert.deepEqual(singles, [5, 10]);
  }
});

test('standalone allowance resets on a new short topic', () => {
  let s = freshReview(6);
  for (let i=1;i<=19;i++) {
    s=observeCard(s,card(i),'Plants',i===19,q,i*1000,id,19);
    if(reviewDue(s))s=complete(s);
  }
  const singles: number[]=[];
  for (let i=20;i<=38;i++) {
    s=observeCard(s,card(i,'circuits'),'Circuits',i===38,q,i*1000,id,19);
    if(reviewDue(s)) {
      if(s.queue[0].kind==='single')singles.push(i);
      s=complete(s);
    }
  }
  assert.equal(singles.length,2);
});


test('a recap uses distinct lesson objectives even when competency labels are identical', () => {
  let state = batchOnlyReview(5);
  const now = 1000000;
  for (let i = 0; i < 20; i++) {
    state = observeCard(state, {
      id: `objective-${i}`, factId: `objective-${i}`, concept: 'G5-L-1', topic: 'g5:digestion',
      subcategories: [], objectives: [i < 10 ? 'mouth' : 'stomach'],
    }, 'Digestion', false, q, now + i, id, 30);
  }
  assert.equal(state.queue.length, 1);
  assert.notDeepEqual(state.queue[0]!.items[0]!.card.objectives, state.queue[0]!.items[1]!.card.objectives);
});
