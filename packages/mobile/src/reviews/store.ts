import { lessonObjectives } from '../data/lessonPlan';
import { create } from 'zustand';
import { getSetting, setSetting } from '../db/repo';
import { loadQuestions } from '../data/cardDb';
import { getCard, questionForFact, competencyKeys, type CardChoice } from '../data/cards';
import { populatedPrerequisite, subcategoriesForCard } from '../data/subcategoryRegression';
import { newId, track, trackMany, telemetryPersona } from '../telemetry';
import {
  freshReview,
  observeCard,
  reviewDue,
  answerReview,
  nextQuestion,
  finishReview,
  deferReview,
  activateRemediation,
  remediationTarget,
  type Attempt,
  type ActiveRemediation,
  type ReadCard,
  type ReviewState,
} from './logic';

export interface CompletedReviewAttempt {
  attempt: Attempt;
  correct: boolean;
  seriesKind: 'single' | 'checkpoint' | 'topic' | 'remediation';
  seriesTitle: string;
  position: number;
  total: number;
}

interface Runtime {
  data: ReviewState | null;
  open: boolean;
  busy: boolean;
  error: string;
  pending: CardChoice | null;
}
export const useReviewStore = create<Runtime>(() => ({
  data: null,
  open: false,
  busy: false,
  error: '',
  pending: null,
}));
let lastPage: string | null = null;
let preparing: Promise<boolean> | null = null;
let retry: (() => Promise<void>) | null = null;
const key = (grade: number) => `cards.reviews.v1.${grade}`;
async function save(data: ReviewState, after?: () => void, background = false) {
  useReviewStore.setState({ busy: !background, error: '', data });
  const write = async () => {
    await setSetting(key(data.grade), JSON.stringify(data));
    useReviewStore.setState({ busy: false, error: '' });
    retry = null;
    after?.();
  };
  retry = write;
  try {
    await write();
  } catch {
    useReviewStore.setState({ busy: false, error: 'Could not save this review. Please retry.' });
  }
}
export async function retryReviewSave() {
  if (!retry) return;
  useReviewStore.setState({ busy: true });
  try {
    await retry();
  } catch {
    useReviewStore.setState({ busy: false, error: 'Could not save this review. Please retry.' });
  }
}
export async function initializeReviews(grade: number, resume = true) {
  if (useReviewStore.getState().data?.grade === grade) return;
  const raw = await getSetting(key(grade));
  const parsed = raw ? JSON.parse(raw) : freshReview(grade);
  // v1 shipped before awards and reinforcement. Both are additive, so old school-year
  // histories migrate in place without discarding an unfinished review.
  const readCard = (card: ReadCard): ReadCard => ({
    ...card,
    subcategories: card.subcategories ?? [],
  });
  const data: ReviewState = {
    ...parsed,
    awards: parsed.awards ?? {},
    nextSingleTurn: parsed.nextSingleTurn ?? parsed.turns + 5,
    recent: (parsed.recent ?? []).map(readCard),
    topic: {
      ...(parsed.topic ?? { key: null, title: '', cards: [] }),
      cards: (parsed.topic?.cards ?? []).map(readCard),
    },
    reinforcement: (parsed.reinforcement ?? []).map(readCard),
    remediation: parsed.remediation
      ? { ...parsed.remediation, viewed: (parsed.remediation.viewed ?? []).map(readCard) }
      : null,
    queue: (parsed.queue ?? []).map((series: ReviewState['queue'][number]) => ({
      ...series,
      topicKey: series.topicKey ?? null,
      remediationTarget: series.remediationTarget ?? null,
      items: series.items.map((attempt) => ({
        ...attempt,
        card: readCard(attempt.card),
      })),
    })),
  };
  if (data.version !== 1 || data.grade !== grade || !Array.isArray(data.queue) || !data.history)
    throw new Error('Invalid saved review');
  for (const series of data.queue)
    for (const a of series.items) {
      if (
        a.order.length !== a.question.o.length ||
        new Set(a.order).size !== a.order.length ||
        a.order.some((i) => !Number.isInteger(i) || i < 0 || i >= a.order.length)
      )
        throw new Error('Invalid saved answer order');
    }
  useReviewStore.setState({ data, open: resume && reviewDue(data), pending: null, error: '' });
  lastPage = null;
}
type ReviewPage = {
  pageKey: number;
  cardId: string;
  topic: string | null;
  title: string;
  endsTopic: boolean;
  topicCardCount?: number;
  grade: number;
  choice: CardChoice;
};
export function reviewPrepared(grade: number, pageKey: number) {
  return !preparing && !useReviewStore.getState().error && lastPage === `${grade}:${pageKey}`;
}
export function prepareReview(args: ReviewPage) {
  if (
    preparing ||
    useReviewStore.getState().busy ||
    useReviewStore.getState().open ||
    reviewPrepared(args.grade, args.pageKey)
  )
    return;
  preparing = interceptReview(args, true).finally(() => {
    preparing = null;
  });
}
export async function interceptReview(args: ReviewPage, background = false): Promise<boolean> {
  if (!background && preparing) await preparing;
  if (useReviewStore.getState().busy || useReviewStore.getState().open) return true;
  if (!background) useReviewStore.setState({ busy: true, pending: args.choice });
  try {
    await initializeReviews(args.grade, false);
    const s = useReviewStore.getState().data!;
    const page = `${args.grade}:${args.pageKey}`;
    let next = s;
    if (lastPage !== page) {
      const f = getCard(args.cardId);
      if (!f) {
        useReviewStore.setState({ busy: false });
        return false;
      }
      const candidates = [...s.recent, ...s.topic.cards].map((c) => c.factId);
      candidates.push(f.factId);
      await loadQuestions(candidates);
      next = observeCard(
        s,
        {
          id: f.id,
          factId: f.factId,
          concept:
            competencyKeys(f.id)
              .filter((c) => c !== 'off')
              .join('|') || f.topic,
          topic: args.topic,
          objectives: lessonObjectives(args.topic, f.id),
          subcategories: subcategoriesForCard(f, args.grade),
        },
        args.title,
        args.endsTopic,
        questionForFact,
        Date.now(),
        newId,
        args.topicCardCount
      );
      lastPage = page;
    }
    const open = reviewDue(next);
    await save(
      next,
      () => {
        if (!background) useReviewStore.setState({ open, pending: args.choice });
      },
      background
    );
    return open || !!useReviewStore.getState().error;
  } catch {
    retry = async () => {
      useReviewStore.setState({ error: '', busy: false });
      await interceptReview(args);
    };
    useReviewStore.setState({
      busy: false,
      error: 'Could not load this review. Please try again.',
      open: false,
    });
    return true;
  }
}
export function shownReview() {
  const s = useReviewStore.getState().data;
  const series = s?.queue[0];
  const a = series?.items[series.position];
  if (!s || !a) return;
  track(
    'quiz_shown',
    { ...telemetryPersona(), grade: s.grade, attempt_id: a.id, question_id: a.question.f },
    `${a.id}_shown`
  );
}
export async function selectReviewOption(
  selected: number,
  onGraded: (result: CompletedReviewAttempt) => void
) {
  const runtime = useReviewStore.getState();
  if (runtime.busy || runtime.error || !runtime.data) return;
  const s = runtime.data;
  const next = answerReview(s, selected, Date.now());
  if (next === s) return;
  const series = next.queue[0]!;
  const a = series.items[series.position]!;
  const correct = a.order[selected] === a.question.a;
  await save(next, () => {
    const props = {
      ...telemetryPersona(),
      grade: s.grade,
      attempt_id: a.id,
      question_id: a.question.f,
    };
    trackMany([
      { name: 'quiz_shown', props, id: `${a.id}_shown` },
      { name: 'quiz_answer_submitted', props, id: `${a.id}_submitted` },
      { name: 'quiz_graded', props: { ...props, correct }, id: `${a.id}_graded` },
    ]);
    onGraded({
      attempt: a,
      correct,
      seriesKind: series.kind,
      seriesTitle: series.title,
      position: series.position,
      total: series.items.length,
    });
  });
}

/** A reinforced card has landed in the ordinary feed; consume its one queued repeat. */
export async function acknowledgeReinforcement(cardId: string) {
  const s = useReviewStore.getState();
  if (!s.data) return;
  const reinforcement = s.data.reinforcement.filter((c) => c.id !== cardId);
  if (reinforcement.length === s.data.reinforcement.length) return;
  await save({ ...s.data, reinforcement }, undefined, true);
}
export async function continueReview(onExit?: (choice: CardChoice | null) => void) {
  const s = useReviewStore.getState();
  if (s.busy || s.error || !s.data) return;
  const next = nextQuestion(s.data);
  if (next === s.data) return;
  if (next.queue[0]?.kind === 'single' && onExit) {
    await save(finishReview(next), () => {
      useReviewStore.setState({ open: false, pending: null });
      onExit(s.pending);
    });
  } else await save(next);
}
export async function leaveReview(defer: boolean, onExit: (choice: CardChoice | null) => void) {
  const s = useReviewStore.getState();
  if (s.busy || s.error || !s.data) return;
  useReviewStore.setState({ busy: true });
  const plan = defer ? null : await remediationPlan(s.data).catch(() => null);
  let next = defer ? deferReview(s.data) : finishReview(s.data);
  if (plan) next = activateRemediation(next, plan);
  await save(next, () => {
    useReviewStore.setState({ open: false, pending: null });
    onExit(s.pending);
  });
}

async function remediationPlan(
  state: ReviewState
): Promise<Omit<ActiveRemediation, 'viewed' | 'round'> | null> {
  const series = state.queue[0];
  if (
    state.remediation ||
    !series ||
    series.kind !== 'topic' ||
    !series.items.length ||
    !remediationTarget(series)
  ) {
    return null;
  }

  const target = remediationTarget(series);
  if (!target) return null;
  const prerequisite = populatedPrerequisite(target, 3);
  if (!prerequisite) return null;

  const eligible: string[] = [];
  for (let offset = 0; offset < prerequisite.cardIds.length && eligible.length < 6; offset += 24) {
    const ids = prerequisite.cardIds.slice(offset, offset + 24);
    const facts = ids.map(getCard).filter((fact): fact is NonNullable<typeof fact> => !!fact);
    await loadQuestions(facts.map((fact) => fact.factId));
    for (const fact of facts) {
      if (questionForFact(fact.id) && !eligible.includes(fact.id)) eligible.push(fact.id);
      if (eligible.length === 6) break;
    }
  }
  if (eligible.length < 3) return null;
  return {
    target,
    prerequisite: prerequisite.subcategory,
    instructionalGrade: prerequisite.grade,
    title: series.title,
    cardIds: eligible,
    startedAt: Date.now(),
  };
}
export function hideReviewError() {
  useReviewStore.setState({ error: '', busy: false, open: false, pending: null });
}
