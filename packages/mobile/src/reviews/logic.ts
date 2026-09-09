import type { CardQuestion } from '../data/cards';
export interface ReadCard {
  id: string;
  factId: string;
  concept: string;
  objectives?: string[];
  topic: string | null;
  /** Finalized DepEd subcategories for the student's declared grade. */
  subcategories: string[];
}
export interface Attempt {
  id: string;
  attemptNumber: number;
  card: ReadCard;
  question: CardQuestion;
  order: number[];
  selected: number | null;
}
export interface Series {
  id: string;
  kind: 'single' | 'checkpoint' | 'topic' | 'remediation';
  /** Grade-local curriculum topic key (for example Q2.1). */
  topicKey: string | null;
  title: string;
  items: Attempt[];
  position: number;
  createdAt: number;
  remediationTarget: string | null;
}

export interface ActiveRemediation {
  /** Declared-grade subcategory whose recap was failed. */
  target: string;
  /** Earlier-grade subcategory currently being taught. */
  prerequisite: string;
  instructionalGrade: number;
  title: string;
  cardIds: string[];
  viewed: ReadCard[];
  round: number;
  startedAt: number;
}
export interface History {
  attempts: number;
  firstCorrect: boolean;
  correct: number;
  lastCorrect: boolean;
  lastAt: number;
  lastTurn: number;
  card: ReadCard;
}
export interface TopicAward {
  runs: number;
  bestCorrect: number;
  bestTotal: number;
  lastCorrect: number;
  lastTotal: number;
  updatedAt: number;
}
export interface ReviewState {
  version: 1;
  grade: number;
  turns: number;
  seen: Record<string, true>;
  recent: ReadCard[];
  topic: { key: string | null; title: string; cards: ReadCard[]; singleCount?: number };
  queue: Series[];
  history: Record<string, History>;
  /** Completed topic-review results, keyed by the grade-local curriculum topic key. */
  awards: Record<string, TopicAward>;
  /** Source cards missed in a quiz and due for one ordinary-feed reinforcement. */
  reinforcement: ReadCard[];
  /** One silent lower-level learning run at a time; declared `grade` never changes. */
  remediation: ActiveRemediation | null;
  notBeforeTurn: number;
  /** Ordinary-card turn when another standalone quiz may be offered. */
  nextSingleTurn: number;
}
export const freshReview = (grade: number): ReviewState => ({
  version: 1,
  grade,
  turns: 0,
  seen: {},
  recent: [],
  topic: { key: null, title: '', cards: [] },
  queue: [],
  history: {},
  awards: {},
  reinforcement: [],
  remediation: null,
  notBeforeTurn: 0,
  nextSingleTurn: 5,
});

/** Completion always earns one star; majority mastery earns two; 80% earns three. */
export function awardStars(a: TopicAward | undefined): number {
  if (!a || a.bestTotal <= 0) return 0;
  const ratio = a.bestCorrect / a.bestTotal;
  return ratio >= 0.8 ? 3 : ratio >= 0.6 ? 2 : 1;
}

/** Overall award is weighted by each completed topic's best recorded review. */
export function overallStars(s: ReviewState | null): number {
  if (!s) return 0;
  const awards = Object.values(s.awards);
  const total = awards.reduce((n, a) => n + a.bestTotal, 0);
  if (!total) return 0;
  const correct = awards.reduce((n, a) => n + a.bestCorrect, 0);
  const ratio = correct / total;
  return ratio >= 0.8 ? 3 : ratio >= 0.6 ? 2 : 1;
}
export function shuffleOptions(n: number, random = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
export function reviewDue(s: ReviewState): boolean {
  return s.queue.length > 0 && s.turns >= s.notBeforeTurn;
}
export function observeCard(
  s: ReviewState,
  card: ReadCard,
  title: string,
  endsTopic: boolean,
  question: (id: string) => CardQuestion | undefined,
  now: number,
  id: () => string,
  topicCardCount?: number
): ReviewState {
  const next: ReviewState = {
    ...s,
    turns: s.turns + 1,
    seen: { ...s.seen },
    recent: [...s.recent],
    queue: [...s.queue],
    topic: { ...s.topic, cards: [...s.topic.cards] },
    remediation: s.remediation ? { ...s.remediation, viewed: [...s.remediation.viewed] } : null,
  };
  if (next.remediation?.cardIds.includes(card.id)) {
    if (!next.remediation.viewed.some((viewed) => viewed.factId === card.factId)) {
      next.remediation.viewed.push(card);
    }
    const complete = next.remediation.cardIds.every((id) =>
      next.remediation!.viewed.some((viewed) => viewed.id === id)
    );
    const alreadyQueued = next.queue.some(
      (series) =>
        series.kind === 'remediation' && series.remediationTarget === next.remediation!.target
    );
    if (complete && !alreadyQueued) {
      const candidates = next.remediation.viewed
        .map((viewed) => ({ card: viewed, q: question(viewed.id) }))
        .filter(
          (candidate) =>
            candidate.q &&
            candidate.q.o.length >= 2 &&
            candidate.q.a >= 0 &&
            candidate.q.a < candidate.q.o.length
        )
        .slice(0, 3);
      if (candidates.length) {
        next.queue.push({
          id: id(),
          kind: 'remediation',
          topicKey: null,
          title: next.remediation.title,
          createdAt: now,
          remediationTarget: next.remediation.target,
          position: 0,
          items: candidates.map((candidate) => ({
            id: id(),
            attemptNumber: (next.history[candidate.card.factId]?.attempts ?? 0) + 1,
            card: candidate.card,
            question: candidate.q!,
            order: shuffleOptions(candidate.q!.o.length),
            selected: null,
          })),
        });
      }
    }
    return next;
  }
  if (!next.seen[card.factId]) {
    next.seen[card.factId] = true;
    next.recent.push(card);
  }
  if (next.topic.key !== card.topic) next.topic = { key: card.topic, title, cards: [] };
  if (!next.topic.cards.some((c) => c.factId === card.factId)) next.topic.cards.push(card);
  const checkpoint = next.recent.length >= 20;
  const single = !checkpoint && !endsTopic;
  // Short topics need at most two standalone checks before their closing review.
  // Count scheduled singles, not viewed cards, so sparse quiz coverage and restarts
  // cannot accidentally introduce a third standalone round.
  if (
    single &&
    card.topic !== null &&
    topicCardCount !== undefined &&
    topicCardCount < 20 &&
    (next.topic.singleCount ?? 0) >= 2
  )
    return next;
  if (
    single &&
    (next.turns < next.nextSingleTurn || next.turns < next.notBeforeTurn || next.queue.length)
  )
    return next;
  const pool = single
    ? next.topic.cards.slice(-5)
    : endsTopic
      ? next.topic.cards
      : next.recent.slice(-20);
  const limit = single ? 1 : endsTopic ? Math.min(5, Math.max(3, Math.ceil(pool.length / 10))) : 3;
  const reserved = new Set(next.queue.flatMap((series) => series.items.map((a) => a.card.factId)));
  const candidates = pool
    .map((c) => ({ card: c, q: question(c.id), history: next.history[c.factId] }))
    .filter((x) => !reserved.has(x.card.factId))
    .filter((x) => x.q && x.q.o.length >= 2 && x.q.a >= 0 && x.q.a < x.q.o.length)
    .filter(
      (x) =>
        !x.history ||
        next.turns - x.history.lastTurn >= 5 ||
        (x.history.lastCorrect && now - x.history.lastAt >= 3 * 86400000)
    );
  // Two new questions plus one spaced repeat when available. Prefer missed repeats,
  // but revisit correct answers too. A standalone quiz uses one new question first.
  const picked: typeof candidates = [];
  const concepts = new Set<string>();
  const take = (list: typeof candidates, n: number) => {
    for (const diverse of [true, false])
      for (const c of list) {
        if (picked.length >= n) break;
        if (
          picked.some((p) => p.card.factId === c.card.factId) ||
          (diverse &&
            (c.card.objectives?.length
              ? c.card.objectives.every((o) => concepts.has(o))
              : concepts.has(c.card.concept)))
        )
          continue;
        picked.push(c);
        for (const objective of c.card.objectives?.length ? c.card.objectives : [c.card.concept])
          concepts.add(objective);
      }
  };
  take(
    candidates.filter((c) => !c.history),
    Math.min(2, limit)
  );
  const repeats = candidates
    .filter((c) => c.history)
    .sort(
      (a, b) =>
        Number(a.history!.lastCorrect) - Number(b.history!.lastCorrect) ||
        a.history!.lastAt - b.history!.lastAt
    );
  take(repeats, Math.min(limit, picked.length + 1));
  take(
    candidates.filter((c) => !c.history || c.history.lastCorrect),
    limit
  );
  if (picked.length)
    next.queue.push({
      id: id(),
      kind: single ? 'single' : endsTopic ? 'topic' : 'checkpoint',
      topicKey: endsTopic ? next.topic.key : null,
      title: endsTopic ? title : '',
      createdAt: now,
      remediationTarget: null,
      position: 0,
      items: picked.map((c) => ({
        id: id(),
        attemptNumber: (c.history?.attempts ?? 0) + 1,
        card: c.card,
        question: c.q!,
        order: shuffleOptions(c.q!.o.length),
        selected: null,
      })),
    });
  if (picked.length) {
    next.nextSingleTurn = next.turns + 5;
    if (single) next.topic.singleCount = (next.topic.singleCount ?? 0) + 1;
  }
  // Standalone quizzes must not reset the 20-card checkpoint or topic coverage.
  if (!single) next.recent = [];
  if (endsTopic) next.topic = { key: null, title: '', cards: [] };
  return next;
}
export function answerReview(s: ReviewState, selected: number, now: number): ReviewState {
  const series = s.queue[0];
  const attempt = series?.items[series.position];
  if (
    !attempt ||
    attempt.selected !== null ||
    !Number.isInteger(selected) ||
    selected < 0 ||
    selected >= attempt.order.length
  )
    return s;
  const correct = attempt.order[selected] === attempt.question.a;
  const prior = s.history[attempt.card.factId];
  const updated = {
    ...series,
    items: series.items.map((a, i) => (i === series.position ? { ...a, selected } : a)),
  };
  return {
    ...s,
    reinforcement:
      series.kind === 'remediation'
        ? s.reinforcement
        : correct
          ? s.reinforcement.filter((c) => c.factId !== attempt.card.factId)
          : s.reinforcement.some((c) => c.factId === attempt.card.factId)
            ? s.reinforcement
            : [...s.reinforcement, attempt.card],
    queue: [updated, ...s.queue.slice(1)],
    history: {
      ...s.history,
      [attempt.card.factId]: {
        attempts: (prior?.attempts ?? 0) + 1,
        firstCorrect: prior?.firstCorrect ?? correct,
        correct: (prior?.correct ?? 0) + (correct ? 1 : 0),
        lastCorrect: correct,
        lastAt: now,
        lastTurn: s.turns,
        card: attempt.card,
      },
    },
  };
}
export function nextQuestion(s: ReviewState): ReviewState {
  const series = s.queue[0];
  if (!series || series.items[series.position]?.selected == null) return s;
  return { ...s, queue: [{ ...series, position: series.position + 1 }, ...s.queue.slice(1)] };
}
export function finishReview(s: ReviewState): ReviewState {
  const series = s.queue[0];
  if (!series || series.position < series.items.length) return s;
  let awards = s.awards;
  if (series.kind === 'topic' && series.topicKey && series.items.length) {
    const correct = seriesScore(series);
    const total = series.items.length;
    const prior = awards[series.topicKey];
    const better = !prior || correct / total > prior.bestCorrect / Math.max(1, prior.bestTotal);
    awards = {
      ...awards,
      [series.topicKey]: {
        runs: (prior?.runs ?? 0) + 1,
        bestCorrect: better ? correct : prior!.bestCorrect,
        bestTotal: better ? total : prior!.bestTotal,
        lastCorrect: correct,
        lastTotal: total,
        updatedAt: Date.now(),
      },
    };
  }
  let remediation = s.remediation;
  if (
    series.kind === 'remediation' &&
    remediation &&
    series.remediationTarget === remediation.target
  ) {
    const passed = series.items.length > 0 && seriesScore(series) * 2 > series.items.length;
    remediation = passed ? null : { ...remediation, viewed: [], round: remediation.round + 1 };
  }
  return {
    ...s,
    awards,
    remediation,
    queue: s.queue.slice(1),
    notBeforeTurn: s.turns + 5,
    nextSingleTurn: s.turns + 5,
  };
}

export function activateRemediation(
  s: ReviewState,
  plan: Omit<ActiveRemediation, 'viewed' | 'round'>
): ReviewState {
  if (s.remediation || !plan.cardIds.length) return s;
  return { ...s, remediation: { ...plan, viewed: [], round: 1 } };
}

/** Highest-frequency failed declared-grade subcategory after a strict-majority topic failure. */
export function remediationTarget(series: Series): string | null {
  if (
    series.kind !== 'topic' ||
    !series.items.length ||
    seriesScore(series) * 2 >= series.items.length
  ) {
    return null;
  }
  const failures = new Map<string, number>();
  for (const attempt of series.items) {
    const correct =
      attempt.selected !== null && attempt.order[attempt.selected] === attempt.question.a;
    if (correct) continue;
    for (const subcategory of attempt.card.subcategories) {
      failures.set(subcategory, (failures.get(subcategory) ?? 0) + 1);
    }
  }
  return [...failures].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}
export const deferReview = (s: ReviewState): ReviewState => ({ ...s, notBeforeTurn: s.turns + 5 });
export const seriesScore = (s: Series) =>
  s.items.filter((a) => a.selected !== null && a.order[a.selected] === a.question.a).length;
