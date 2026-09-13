import { titleForCard, type TitleCardContent } from '../data/titleCard';
import { reviewDue } from '../reviews/logic';
import {
  initializeReviews,
  beginTitleSection,
  interceptReview,
  prepareReview,
  reviewPrepared,
  useReviewStore,
  acknowledgeReinforcement,
  type CompletedReviewAttempt,
} from '../reviews/store';
/**
 * Question-cards feed state (v1). App-orchestrated, zero-model, same doctrine as quiz
 * mode: every card/question is pre-verified bundled data; the store is a deterministic
 * walk over the card graph.
 *
 * Flow: card → (choose deep/lateral) → flip → next card … Every 4-5 pages the chosen
 * flip is INTERCEPTED by one question page asking about a recently-read fact (75% of
 * the pool has an exact MCQ). Answering shows a single "continue" note that resumes the
 * walk onto the card the kid originally chose — their choice is honored, never dropped.
 * Counters (pages read / questions correct) persist via the settings table. The seen-set is
 * SESSION-ONLY; across restarts seen-ness lives in the SQLite seen-store as a weight, not a filter.
 * Every draw is weighted by a FeedContext (rag/pipeline/FEED-WEIGHTING.md): the student's
 * grade, the inferred curriculum quarter, and the SQLite seen-store (card + competency).
 */
import { gradeQuiz } from '../telemetry/views';
import { AppState } from 'react-native';
import { create } from 'zustand';
// `sanitizeCardAnswer` is the guard that trims a model-generated card, strips the prompt's
// own SAGOT:/ANSWER:/TUBAG: cue if it is echoed, and caps the card at the length
// ResponseCard is laid out for. It sits next to the prompt it cleans up after
// (@hiraia/shared prompts/cards.ts) so the web demo's card route applies the same one.
import {
  inferCurriculumQuarter,
  sanitizeCardAnswer,
  type Language,
  type SeenRecord,
} from '@hiraia/shared';

import {
  advanceCurriculum,
  cardTitle,
  cardTitleById,
  choiceLabel,
  competencyKeys,
  curriculumCursor,
  cursorTopic,
  topicTitle,
  estimatedCurriculumCursor,
  getCard,
  hasServableCurriculum,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  warmPage,
  type CardChoice,
  type CardFact,
  type CardQuestion,
  type CurriculumCursor,
  type FeedContext,
} from '../data/cards';
import { loadTokenIndex } from '../data/cardDb';
import {
  recentTopics,
  sanitizeReward,
  templateReward,
  type RewardContent,
  type ViewLogEntry,
} from '../data/reward';
import { getSetting, loadSeen, recordCardSeen, recordCompetencySeen, setSetting } from '../db/repo';
import { withModelLock } from '../engine/modelLock';
import { useEngineStore } from './engineStore';

// Trail of just-read cards. Two consumers: "ask about something the kid just saw" (quiz
// interjects) and the illustration cooldown in nextChoices (don't reuse a recent picture).
const RECENT_WINDOW = 5;
const VIEWLOG_CAP = 40; // session view-log for the reward recap (topic + timestamp)
// The weak-hit off-domain consult's deadline: past this, serve the match (never let a wedged
// embedder swallow a child's question into a void). Same budget as the web mirror's
// CLASSIFY_TIMEOUT_MS (packages/web/src/store/useCardDemoStore.ts) — keep the two in sync.
const WEAK_CONSULT_TIMEOUT_MS = 4_000;
/**
 * The REWARD-LINE PREFETCH window and its gate. The LLM reward line may be generated once
 * the reward is within REWARD_PREFETCH_AT cards of being due — but only DURING A DWELL: the
 * reader has been on the current page for REWARD_PREFETCH_DWELL_MS with no finger on the
 * card, no ask pending, no reward page already up (a quiz or response page is a dwell like
 * any other). It is ABORTED the instant a drag starts, a page turns, an ask begins, the app
 * leaves the foreground or the engine is swapped, and re-armed on the next qualifying dwell,
 * until the reward is due; if it is due with no line, templateReward serves.
 *
 * REWARD_PREFETCH_MAX_ABORTS bounds the retry storm. A reader who swipes every ~3 s would
 * otherwise start a generation on EVERY page (dwell fires at 2.5 s, drag aborts it at 3 s):
 * each attempt costs a prompt prefill on all cores until the cancel lands, so unbounded
 * retries would reproduce the stall on a page-by-page basis. After this many aborted
 * attempts in one reward cycle the store stops trying and the template serves; the counter
 * resets when the reward page is served (untilReward jumps back up).
 *
 * WHY (measured on device, 2026-09-06): this generation is the only model work the reader
 * did not initiate, and it ran under ~5 of every 6–10 pages with llama.cpp on all 8 cores
 * (~7.3 busy) — exactly the swipes whose incoming page took 380–1110 ms to paint, while
 * swipes with <1 core busy painted in 35–100 ms. The card's flight runs on the UI thread,
 * which those threads starved. The line is praise-only (the prompt forbids topics and
 * facts), so losing an attempt costs nothing a template does not cover.
 *
 * 2500 ms: longer than the whole swipe (release → commit → first paint → the 380 ms
 * flight) with margin, and shorter than a child's typical read of a card — so a reader who
 * is actually reading still gets the generated line before the reward page.
 */
const REWARD_PREFETCH_AT = 5;
const REWARD_PREFETCH_DWELL_MS = 2_500;
const REWARD_PREFETCH_MAX_ABORTS = 2;
const REWARD_MIN_TOPICS = 3; // don't reward until there's something to celebrate

/**
 * A search result that isn't a straight card navigation. Three shapes:
 *   generated — a model-written fact card, grounded on the fact bank;
 *   abstain   — an in-domain GAP: science, but no page for it yet (offers the nearest topic);
 *   offdomain — not science at all ("roblox"): we say we are only a science tutor, and
 *               deliberately offer NO topic (suggesting a science card to a child who asked
 *               about a game is the behaviour this split exists to remove).
 * (A retrieval HIT navigates directly to the found card with an ActiveMagnet instead — its
 * query is the "you asked" ribbon — no FeedResponse needed.)
 */
export interface FeedResponse {
  query: string;
  kind: 'generated' | 'abstain' | 'offdomain';
  text: string | null; // generated answer (already localized)
  suggestion: string | null; // topic label of the nearest card — the abstain path only
  /**
   * The card's ILLUSTRATION, as a catalog slug — the `generated` shape only, and null far more
   * often than not. RETRIEVAL picked it (engine.answerQuery → resolveFactImage on the grounded
   * fact the card states); the model was never asked what to draw. Null is an ordinary outcome, not a
   * failure: ResponseCard then prints the card as a poster, exactly as a factoid card without
   * art does, rather than reaching for a picture that would be wrong.
   */
  slug: string | null;
}

/**
 * The ACTIVE asked-topic magnet — "You asked 'dinosaur'", holding while the feed lines the
 * topic up (see MagnetPull in data/cards.ts for the pull itself).
 *
 *   query  — what the child typed; it IS the banner copy (the banner lives exactly as long
 *            as the magnet, which is what makes the [x] and the auto-release honest).
 *   idSet  — the magnet set, computed ONCE at ask time from the search's own scoring
 *            (SearchResult.magnet). Per page-turn it is only ever LOOKED UP, never re-scored.
 *   served — how many magnet cards have been served since the ask; the pull's decay clock.
 *
 * Cleared by the [x], another search, Calendar selection, or Randomize.
 * Once direct matches run out, adjacent cards can follow while the keyword stays visible. Quiz/reward interjects never touch it — they are interruptions, not topic changes.
 */
export interface ActiveMagnet {
  query: string;
  idSet: ReadonlySet<string>;
  served: number;
  dynamic?: { attempts: number; sourceFactIds: string[]; texts: string[] };
}

/**
 * CALENDAR MODE — "walk the MATATAG outline for my grade, topic by topic, exhausting each".
 * The cursor (data/cards.ts CurriculumCursor): the grade the outline was opened for, the TOPIC
 * currently held (a CG Content title, by key), the union of its competencies' card sets, and
 * its row index. Held as the store's `curriculum`, and the ribbon under the ask box shows
 * exactly while it is non-null.
 *
 * Unlike the magnet it is a FILTER, not a pull: while held, every draw is confined to `idSet`
 * (FeedContext.curriculum). Advances on each page-turn through `advanceCurriculum` — the same
 * object while the topic still has a servable card, the next non-empty topic in CG order once
 * it is exhausted, a review pass after Q4. Cleared by: the ribbon's [x]
 * (exitCurriculum), that end-of-outline release, and nothing else — an ask serves its card as a
 * one-off and the walk resumes, Randomize leaves curriculum for the keyword feed, interjects never touch it.
 * The magnet and the cursor are mutually exclusive by construction: entering either clears the
 * other on a Calendar selection; searching pauses the saved cursor while the magnet holds. The topic key is persisted separately per grade in the active profile database.
 */
export type ActiveCurriculum = CurriculumCursor;

interface CardState {
  titleCard: TitleCardContent | null;
  introducedTopic: string | null;
  continueAfterTitle: () => void;
  hydrated: boolean;
  /** Current card on the pad (null until hydrate). */
  current: CardFact | null;
  choices: CardChoice[];
  /** Interject question page — when set, it replaces the card content this page. */
  question: CardQuestion | null;
  /** The choice that was intercepted by the question (resumed on continue). */
  pending: CardChoice | null;
  /** True once the interject question has been answered (gates swipe-to-continue). */
  questionAnswered: boolean;
  /** Interject REWARD page — periodic "you've learned a lot!" recap (LLM or template). */
  reward: RewardContent | null;
  /** Search RESPONSE page — a generated grounded answer or an abstention (see FeedResponse). */
  response: FeedResponse | null;
  /** True while a fallback generation is in flight (retrieval missed, model is answering). */
  asking: boolean;
  /** Card to land on when the kid continues past a generated/abstain response page. */
  responseAnchorId: string | null;
  /**
   * The asked-topic magnet. Its `query` is also the "Ang tanong mo: X" ribbon — the ribbon
   * shows exactly while a magnet is active, so dismissing one dismisses the other.
   */
  magnet: ActiveMagnet | null;
  /** Calendar mode's cursor (see ActiveCurriculum); the curriculum ribbon shows while non-null. */
  curriculum: ActiveCurriculum | null;
  currentTopic: ActiveCurriculum | null;
  /** Monotonic page number — keys the flip + typewriter remounts. */
  pageKey: number;
  pagesRead: number;
  correctCount: number;
  questionsAsked: number;
  /** Curriculum uses saved coverage plus this session; Randomize starts a fresh session trail. */
  seen: Set<string>;
  recent: string[]; // last few card ids (question sourcing + nextChoices' picture cooldown)
  viewLog: ViewLogEntry[]; // {factId, topic, ts} for the reward recap window
  untilQuestion: number; // pages left until the next interject question
  /**
   * Cards walked since a branch was last OFFERED. Drives the single-path-vs-fork decision
   * in nextChoices (see BRANCH_EVERY). Lives here, not in cards.ts, so the graph module
   * stays pure. Session-only — a fresh launch starts a fresh thread.
   */
  threadDepth: number;
  untilReward: number; // pages left until the next reward card (jittered)
  askedFacts: Set<string>; // don't re-ask the same fact this session
  /** Missed quiz-source cards waiting for one deliberate repeat in the ordinary feed. */
  reinforcementQueue: string[];
  /** Earlier-grade cards in the active silent subcategory remediation run. */
  remediationQueue: string[];
  rewardPrefetch: RewardContent | null; // pre-generated reward text, ready to show
  /** A reward generation is in flight (dwell-gated + abortable — see REWARD_PREFETCH_AT). */
  rewardPrefetching: boolean;

  hydrate: () => Promise<void>;
  /**
   * The finger is on the card (the pan's onStart). Aborts any reward generation in flight
   * and holds the dwell clock: nothing speculative runs while the reader is moving a page.
   */
  markDragStart: () => void;
  /** The finger left the card (the pan's onFinalize, committed or sprung back): re-arm the dwell. */
  markDragEnd: () => void;
  choose: (choice: CardChoice) => void;
  prepareReview: () => void;
  chooseWithoutReview: (choice: CardChoice) => void;
  continueAfterReview: (choice: CardChoice | null) => void;
  recordReviewGrade: (result: CompletedReviewAttempt) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: () => void;
  continueAfterReward: () => void;
  /** Kid typed a query: retrieval-first → found card, else warm-model answer, else abstain. */
  ask: (query: string) => Promise<void>;
  /** The banner's [x]: drop the asked-topic magnet (and with it the ribbon); the feed keeps going. */
  dismissQuery: () => void;
  /**
   * Enter calendar mode at a TOPIC of the CURRENT grade's outline (the sheet's row tap, by
   * OutlineTopic.key): clears any magnet, holds the topic, and lands on its best next unseen
   * card. A key the outline does not list (no cards at this grade) is ignored.
   */
  enterCurriculum: (key: string, savedRun?: unknown, shelfCat?: string) => void;
  /** The curriculum ribbon's [x]: leave calendar mode; the feed continues where it is. */
  exitCurriculum: () => void;
  continueAfterResponse: () => void;
  /** Kick a background model warm-up so reward text can be generated (non-blocking). */
  warmModel: () => void;
  /** "Shake to reroll" — teleport to an unrelated fresh topic (escape a deep/stale thread). */
  jumpToRandom: () => void;
}

const nextGap = () => 5; // standalone quiz cadence is owned by reviews/logic.ts
// reward: jittered 15-25 pages so it lands as a dopamine hit, never on a fixed beat.
// (Was a 6-10 TESTING value through the Sept 2/5 public builds — restored 2026-09-06. Besides
// being the intended cadence, it shrinks the window in which the reward line is being
// generated under the reader's swipes — see prefetchReward.)
const nextRewardGap = () => 15 + Math.floor(Math.random() * 11);

function persist(s: { pagesRead: number; correctCount: number }) {
  void setSetting('cards.pages', String(s.pagesRead));
  void setSetting('cards.correct', String(s.correctCount));
}

/**
 * Topic labels for the reward recap, resolved from the card database at display time (the log
 * may have been written before the row was warm) and falling back to whatever was logged.
 */
function recapTopics(log: ViewLogEntry[], language: Language): string[] {
  return recentTopics(
    log.map((e) => ({ ...e, topic: cardTitleById(e.factId, language) || e.topic }))
  );
}

/**
 * In-memory mirror of the SQLite seen-store (card_seen / competency_seen): loaded once at
 * hydrate, bumped as each card is shown (so in-session draws decay too) and written through
 * fire-and-forget. It is a weight-reduction memory, never a blocklist — the only hard filter is
 * the `seen` set above, which lives for one session.
 */
const seenStore: { cards: Map<string, SeenRecord>; competencies: Map<string, SeenRecord> } = {
  cards: new Map(),
  competencies: new Map(),
};

/**
 * Fresh weighting context for one draw: grade + clock are re-read every time. The magnet rides
 * along as an O(set) overlay in the weigher; the curriculum cursor as the draw's restriction.
 * Callers mid-transition pass the magnet/cursor they are ABOUT to commit (get() would hand
 * back the previous page's); the defaults read the store.
 */
function feedContext(
  magnet: ActiveMagnet | null = useCardStore.getState().magnet,
  curriculum: ActiveCurriculum | null = useCardStore.getState().curriculum
): FeedContext {
  return {
    studentGrade: useEngineStore.getState().grade,
    currentQuarter: inferCurriculumQuarter(new Date()).quarter,
    now: Date.now(),
    cardSeen: seenStore.cards,
    competencySeen: seenStore.competencies,
    magnet: magnet ? { ids: magnet.idSet, served: magnet.served } : undefined,
    curriculum: !magnet && curriculum ? { ids: curriculum.idSet } : undefined,
  };
}

/** A magnet for this ask, or null when the search head-matched nothing (no set, no pull). */
function formMagnet(query: string, ids: readonly string[]): ActiveMagnet | null {
  return ids.length ? { query, idSet: new Set(ids), served: 0 } : null;
}

function remediationQueueFromReview() {
  const active = useReviewStore.getState().data?.remediation;
  if (!active) return [];
  const viewed = new Set(active.viewed.map((card) => card.id));
  return active.cardIds.filter((id) => !viewed.has(id));
}

function reviewFeedQueue(remediation: readonly string[], reinforcement: readonly string[]) {
  return [...remediation, ...reinforcement.filter((id) => !remediation.includes(id))];
}

function withoutCard(queue: readonly string[], cardId: string) {
  return queue.filter((id) => id !== cardId);
}

/** Put the oldest scheduled learning card at the front of the next visible branch. */
function withReinforcement(
  choices: CardChoice[],
  queue: readonly string[],
  currentId: string,
  language: Language,
  cursor?: ActiveCurriculum | null,
  magnet: ActiveMagnet | null = useCardStore.getState().magnet
): CardChoice[] {
  if (magnet) return choices;
  // A manual Calendar destination takes precedence over older reinforcement/remediation.
  // Keep off-topic entries queued for a later eligible run; do not consume them here.
  const id = queue.find((candidate) => candidate !== currentId && !!getCard(candidate) &&
    (!cursor?.manualSelection || cursor.idSet.has(candidate)));
  if (!id) return choices;
  const fact = getCard(id)!;
  const forced: CardChoice = { factId: id, label: choiceLabel(fact, language), kind: 'deep' };
  const rest = choices.filter((choice) => choice.factId !== id);
  return [forced, ...rest].slice(0, Math.max(1, choices.length));
}

/**
 * The magnet after `fact` becomes current on an ORDINARY page-turn: serving one of its own
 * cards advances the decay clock, and exhaustion — no unseen member servable from the new
 * page under nextChoices' own gates — releases it (auto-release, silent). `seen`/`recent`
 * are the post-turn values, i.e. they already include `fact`.
 */
function magnetAfter(
  m: ActiveMagnet | null,
  fact: CardFact,
  seen: ReadonlySet<string>,
  recent: readonly string[]
): ActiveMagnet | null {
  if (!m) return null;
  const served = m.idSet.has(fact.id) ? m.served + 1 : m.served;
  // Keep the keyword and its dismiss control visible even when direct matches run out.
  // The graph can then supply adjacent topics until the learner dismisses the magnet.
  return served === m.served ? m : { ...m, served };
}

function bump(map: Map<string, SeenRecord>, key: string, now: number) {
  map.set(key, { times: (map.get(key)?.times ?? 0) + 1, lastSeen: now });
}

/** A card became current: bump its card_seen + competency_seen rows (memory, then SQLite). */
function markSeen(card: CardFact, now: number) {
  // Every code the card serves decays (a card drawn for its secondary cell must dampen THAT competency too).
  const codes = competencyKeys(card.id);
  bump(seenStore.cards, card.id, now);
  for (const code of codes) if (code !== 'off') bump(seenStore.competencies, code, now); // untagged cards are not a group
  recordCardSeen(card.id, codes[0] ?? 'off', now).catch((e) =>
    console.warn('[cards] recordCardSeen failed', e)
  );
  for (const code of codes.slice(1)) {
    recordCompetencySeen(code, now).catch((e) =>
      console.warn('[cards] recordCompetencySeen failed', e)
    );
  }
}

let hydrating: Promise<void> | null = null;

export const useCardStore = create<CardState>()((set, get) => ({
  hydrated: false,
  current: null,
  titleCard: null,
  introducedTopic: null,
  continueAfterTitle: () => {
    if (!get().titleCard) return;
    beginTitleSection();
    set({ titleCard: null, pageKey: get().pageKey + 1 });
  },
  choices: [],
  question: null,
  pending: null,
  questionAnswered: false,
  reward: null,
  response: null,
  asking: false,
  responseAnchorId: null,
  magnet: null,
  curriculum: null,
  currentTopic: null,
  pageKey: 0,
  pagesRead: 0,
  correctCount: 0,
  questionsAsked: 0,
  seen: new Set<string>(),
  recent: [],
  viewLog: [],
  untilQuestion: nextGap(),
  untilReward: nextRewardGap(),
  threadDepth: 0,
  askedFacts: new Set<string>(),
  reinforcementQueue: [],
  remediationQueue: [],
  rewardPrefetch: null,
  rewardPrefetching: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrating) return hydrating; // re-entrant call (StrictMode double effect / remount) shares one draw
    hydrating = (async () => {
      let pagesRead = 0;
      let correctCount = 0;
      const seen = new Set<string>();
      try {
        pagesRead = Number((await getSetting('cards.pages')) ?? 0) || 0;
        correctCount = Number((await getSetting('cards.correct')) ?? 0) || 0;
        // Saved coverage advances the curriculum; the random feed uses it only as a weight.
        const stored = await loadSeen();
        seenStore.cards = stored.cards;
        seenStore.competencies = stored.competencies;
      } catch (e) {
        console.warn('[cards] hydrate failed, starting fresh', e);
      }
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const grade = useEngineStore.getState().grade;
      await initializeReviews(grade);
      const reinforcementQueue =
        useReviewStore.getState().data?.reinforcement.map((card) => card.id) ?? [];
      const remediationQueue = remediationQueueFromReview();
      const savedKey = await getSetting(`cards.curriculum.${grade}`).catch(() => null);
      const estimated = estimatedCurriculumCursor(
        grade,
        inferCurriculumQuarter(new Date()).fraction
      );
      const rawRun = await getSetting(`cards.lessonRun.${grade}`).catch(() => null);
      let savedRun: unknown;
      try {
        savedRun = rawRun ? JSON.parse(rawRun) : undefined;
      } catch {
        /* rebuild an invalid plan */
      }
      const resumeKey =
        (grade === 3 ||
          grade === 4 ||
          grade === 5 ||
          grade === 6 ||
          grade === 7 ||
          grade === 8 ||
          grade === 9 ||
          grade === 10) &&
        typeof (savedRun as { key?: unknown })?.key === 'string'
          ? (savedRun as { key: string }).key
          : savedKey;
      const saved = resumeKey
        ? curriculumCursor(grade, resumeKey, new Set(seenStore.cards.keys()), savedRun)
        : null;
      // Profile databases isolate this history; only curriculum mode uses lifetime coverage.
      for (const id of seenStore.cards.keys()) seen.add(id);
      const initial = saved ?? estimated;
      let curriculum = initial && advanceCurriculum(initial, null, seen);
      let ctx = feedContext(null, curriculum);
      const currentTopic = curriculum;
      const first = curriculum ? jumpCard(null, seen, ctx) : startCard(seen, ctx);
      const consumedReinforcement = reinforcementQueue.includes(first.id);
      const initialReinforcement = withoutCard(reinforcementQueue, first.id);
      const initialRemediation = withoutCard(remediationQueue, first.id);
      seen.add(first.id);
      markSeen(first, ctx.now);
      // Token index first — it is what the duplicate check reads, so the choices have to be
      // drawn after it, not beside it.
      // Best-effort: a database that will not open must NOT stop the feed from rendering. The
      // first build of this let the rejection escape and the app never left its splash screen.
      await loadTokenIndex().catch(() => undefined);
      curriculum = curriculum && advanceCurriculum(curriculum, first.id, seen);
      ctx = feedContext(null, curriculum);
      // Draw the choices HERE, then warm exactly them. They are what the reader can tap, so
      // they are what must be warm; re-deriving them inside warmPage would pick different
      // cards (the draw is weighted, and the weights move between calls) and the page the
      // reader actually turned to would paint with no body text.
      const choices = withReinforcement(
        nextChoices(first.id, seen, lang, {
          threadDepth: 0,
          recentIds: [first.id],
          ctx,
        }),
        reviewFeedQueue(initialRemediation, initialReinforcement),
        first.id,
        lang,
        curriculum
      );
      // The card's prose lives in the database now, so it has to be here before the page
      // paints — this is the ONE await the feed has, and it covers the first card and the
      // pages it can turn to.
      await warmPage([first.id, ...choices.map((c) => c.factId)]).catch((e) =>
        console.warn('[cards] warm failed:', e)
      );
      set({
        hydrated: true,
        pagesRead,
        correctCount,
        seen,
        current: first,
        ...introduce(first, currentTopic, null),
        currentTopic,
        curriculum,
        choices,
        reinforcementQueue: initialReinforcement,
        remediationQueue: initialRemediation,
        threadDepth: 0,
        recent: [first.id],
        viewLog: [{ factId: first.id, topic: cardTitle(first, lang) || first.topic, ts: ctx.now }],
        pageKey: 1,
      });
      if (consumedReinforcement) void acknowledgeReinforcement(first.id);
    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  markDragStart: () => {
    rewardJob.dragging = true;
    abortRewardPrefetch('drag started');
  },

  markDragEnd: () => {
    if (!rewardJob.dragging) return;
    rewardJob.dragging = false;
    // A sprung-back card is the same page — the dwell starts over from the moment the finger
    // left it. A committed swipe has already turned the page (the page-turn hook armed and
    // saw `dragging`, so this is the arm that actually counts for it).
    armRewardDwell();
  },

  prepareReview: () => {
    const s = get();
    if (!s.current || s.titleCard || s.question || s.reward || s.response || !s.choices[0]) return;
    const topic = s.currentTopic && cursorTopic(s.currentTopic);
    prepareReview({
      pageKey: s.pageKey,
      cardId: s.current.id,
      topic: s.currentTopic?.key ?? null,
      title: topic ? topicTitle(topic, useEngineStore.getState().language ?? 'english') : '',
      endsTopic: !!s.currentTopic && s.currentTopic.key !== s.curriculum?.key,
      topicCardCount: s.currentTopic?.idSet.size,
      grade: useEngineStore.getState().grade,
      choice: s.choices[0],
    });
  },
  choose: (choice) => {
    const s = get();
    if (s.titleCard) { get().continueAfterTitle(); return; }
    if (
      !s.current ||
      s.question ||
      s.reward ||
      s.response ||
      useReviewStore.getState().busy ||
      useReviewStore.getState().open
    )
      return;
    const grade = useEngineStore.getState().grade;
    const review = useReviewStore.getState().data;
    if (reviewPrepared(grade, s.pageKey) && review && !reviewDue(review)) {
      get().chooseWithoutReview(choice);
      return;
    }
    const topic = s.currentTopic && cursorTopic(s.currentTopic);
    void interceptReview({
      pageKey: s.pageKey,
      cardId: s.current.id,
      topic: s.currentTopic?.key ?? null,
      title: topic ? topicTitle(topic, useEngineStore.getState().language ?? 'english') : '',
      endsTopic: !!s.currentTopic && s.currentTopic.key !== s.curriculum?.key,
      topicCardCount: s.currentTopic?.idSet.size,
      grade,
      choice,
    }).then((blocked) => {
      if (!blocked && get().pageKey === s.pageKey && useEngineStore.getState().grade === grade)
        get().chooseWithoutReview(choice);
    });
  },
  continueAfterReview: (choice) => {
    const data = useReviewStore.getState().data;
    set({
      reinforcementQueue: data?.reinforcement.map((card) => card.id) ?? [],
      remediationQueue: remediationQueueFromReview(),
    });
    if (!choice) return;
    const s = get();
    if (s.magnet && !s.magnet.idSet.has(choice.factId)) {
      const next = nextChoices(s.current?.id ?? '', s.seen,
        useEngineStore.getState().language ?? 'english', { ctx: feedContext(), recentIds: s.recent })[0];
      if (next) advance(next, set, get);
    } else if (!s.magnet && s.curriculum?.manualSelection && !s.curriculum.idSet.has(choice.factId)) {
      // An older quiz can finish after a Calendar jump, but its saved destination is stale.
      const next = jumpCard(s.current?.id ?? null, s.seen, feedContext(null, s.curriculum));
      advance({ factId: next.id, label: '', kind: 'deep' }, set, get);
    } else advance(choice, set, get);
  },
  recordReviewGrade: (result) => {
    const s = get();
    const correctCount = s.correctCount + (result.correct ? 1 : 0);
    const reinforcementQueue =
      useReviewStore.getState().data?.reinforcement.map((card) => card.id) ?? s.reinforcementQueue;
    const remediationQueue = remediationQueueFromReview();
    set({
      correctCount,
      reinforcementQueue,
      remediationQueue,
      questionsAsked: s.questionsAsked + 1,
    });
    persist({ pagesRead: s.pagesRead, correctCount });
  },
  chooseWithoutReview: (choice) => {
    const s = get();
    if (s.question || s.reward || s.response) return; // an interject page is up — resolve it first

    // REWARD due? (jittered 15-25 pages, needs enough distinct topics.) Rarer than the
    // quiz, so check it first; it intercepts the flip and resumes the choice after.
    if (s.untilReward <= 1 && recentTopics(s.viewLog).length >= REWARD_MIN_TOPICS) {
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const topics = recapTopics(s.viewLog, lang);
      const minutes = Math.max(
        1,
        Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000)
      );
      // Use the prefetched LLM line if it's ready; else the deterministic template.
      const content = s.rewardPrefetch ?? templateReward(topics, s.pagesRead, minutes, lang);
      set({
        reward: content,
        pending: choice,
        rewardPrefetch: null,
        untilReward: nextRewardGap(),
        pageKey: s.pageKey + 1,
      });
      return;
    }

    advance(choice, set, get);
  },

  answerQuestion: (correct) => {
    const s = get();
    if (!s.question || s.questionAnswered) return;
    gradeQuiz(s.pageKey, s.question.f, useEngineStore.getState().language || 'english', correct);
    const correctCount = s.correctCount + (correct ? 1 : 0);
    set({ correctCount, questionAnswered: true }); // enables the corner-swipe-to-continue fallback
    persist({ pagesRead: s.pagesRead, correctCount });
  },

  continueAfterQuestion: () => {
    const s = get();
    if (!s.pending) return;
    const pending = s.pending;
    set({ question: null, pending: null, questionAnswered: false });
    advance(pending, set, get);
  },

  continueAfterReward: () => {
    const s = get();
    const pending = s.pending;
    set({ reward: null, pending: null });
    if (pending) advance(pending, set, get);
  },

  ask: async (query) => {
    const q = query.trim();
    const s = get();
    if (!q || s.asking) return;
    set({ titleCard: null });
    // The child asked: the speculative reward line yields NOW, before the search's embedding
    // (which is not under the model lock and would otherwise share the CPU with it). The
    // `asking` edge in the page-turn hook below is the backstop for the generation itself.
    abortRewardPrefetch('ask started');
    const lang = useEngineStore.getState().language ?? 'tagalog';

    // Retrieval-first: a confident local match navigates straight to that card (instant,
    // zero-model), with a "you asked" banner. The card becomes the new feed anchor.
    // The feed context is passed so that cards which are EQUALLY about the query — same
    // coverage, same aboutness share — are separated by the same curriculum weight every draw
    // uses, rather than by pool ordinal. It never gates a result; see searchCards.
    const stillCurrent = () => get().pageKey === s.pageKey;
    set({ asking: true });
    let res: Awaited<ReturnType<typeof searchCards>>;
    try {
      res = await searchCards(q, s.current?.id ?? null, feedContext());
    } catch (e) {
      if (stillCurrent()) set({ asking: false });
      console.warn('[cards] search failed', e);
      return;
    }
    if (!stillCurrent()) return;
    if (res.best) {
      // STRONG hit (the common case): the card is genuinely ABOUT a word the child typed, so it
      // is self-evidently in-domain — serve it instantly, zero-model, exactly as before.
      //
      // WEAK hit (searchCards' weak band, ~6% of gate queries): no card is really ABOUT the
      // words typed. Junk lands here ("kumusta ka" → a hand-wave card) but so do ordinary
      // in-domain phrasings whose aboutness is diluted by function words ("para saan ang
      // ating puso" → the rib-cage card that answers it) — see WEAK_ABOUT in data/cards.ts.
      // So consult the CALIBRATED off-domain gate BEFORE serving (the same judgement the miss
      // path makes, one embed + the in-RAM retrieval scan, no generation, no model lock).
      // Only weak hits pay this round-trip.
      //
      // SAFE DEGRADATION: when the gate cannot judge (embedder still downloading/warming/
      // failed → null), the probe throws, OR it fails to settle within the same ~4s budget
      // the web mirror gives its consult (useCardDemoStore CLASSIFY_TIMEOUT_MS — QVAC embed
      // stalls are a known failure mode and LocalEngine.embed has no internal deadline),
      // SERVE the match — today's behaviour. A missing model must never cost a child a card;
      // the gate can only ever swap a junk serve for the honest "I'm only a science tutor"
      // card, never swap a card for silence.
      //
      // `asking` is held for the duration of the consult so a second tap re-entering `ask`
      // (the guard above) cannot race a consult that is still in flight.
      let weakOff: boolean | null = null;
      if (res.weak) {
        const probe = useEngineStore.getState().engine;
        if (probe?.weakHitOffDomain) {
          set({ asking: true });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            weakOff = await Promise.race([
              probe.weakHitOffDomain(q),
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), WEAK_CONSULT_TIMEOUT_MS);
              }),
            ]);
          } catch (e) {
            console.warn('[cards] weak-hit off-domain probe failed; serving the match', e);
          } finally {
            clearTimeout(timer);
            if (stillCurrent()) set({ asking: false });
          }
        }
      }
      if (!stillCurrent()) return;
      if (weakOff !== true) {
        // On-topic landing: form the magnet — the query, its aboutness-ranked set (already
        // computed by the search we just paid for), decay clock at zero. It REPLACES any
        // previous magnet: a new ask is a topic change by definition.
        // Search pauses the current curriculum run until the keyword is dismissed.
        const ids = res.magnet.length ? res.magnet : [res.best.id];
        const seen = new Set(get().seen);
        if (ids.filter(id => !seen.has(id)).length < Math.min(5, ids.length)) {
          for (const id of ids) seen.delete(id);
          set({ seen }); // Permit an explicit revisit without erasing stored activity.
        }
        navigateTo(res.best, set, get, { magnet: formMagnet(q, ids) });
        return;
      }
      // Weak hit AND off-domain: the matched card would have been a wrong answer to a
      // non-science query. Same card as the miss-path off-domain outcome below — no suggestion
      // and no anchor, for the same reason spelled out there. No magnet either (and any old
      // one is dropped): off-domain is not a topic the feed can line up.
      set({
        question: null,
        reward: null,
        magnet: null,
        asking: false,
        response: { query: q, kind: 'offdomain', text: null, suggestion: null, slug: null },
        responseAnchorId: null,
        pageKey: get().pageKey + 1,
      });
      return;
    }

    // Miss → try the warm model for a grounded fact card; anything less is an honest miss.
    const suggestion = res.suggestion;
    const es = useEngineStore.getState();
    const engine = es.engine;
    // Set only by answerQuery, and only when the embedder was up to judge it: the query wasn't
    // science, so neither a card nor a science topic is the right answer.
    let offDomain = false;
    if (engine?.isReady() && engine.answerQuery) {
      set({ asking: true });
      try {
        // NOT wrapped in withModelLock: answerQuery takes it itself, around the generation and
        // nothing else. Retrieval and the off-domain judgement are model-free, and holding the
        // lock across them made a static sentence wait for whatever was already generating.
        const ans = await engine.answerQuery!(q, lang);
        if (!stillCurrent()) return;
        offDomain = ans.offDomain === true;
        const clean = sanitizeCardAnswer(ans.text);
        if (ans.grounded && clean && !get().response) {
          const adjacent = await searchCards(ans.relatedQuery || q, s.current?.id ?? null, feedContext(null, null));
          const ids = res.magnet.length ? res.magnet : adjacent.magnet;
          if (!stillCurrent()) return;
          set({
            asking: false,
            question: null,
            reward: null,
            // A GROUNDED generated card is an on-topic landing too, so it forms the magnet
            // (from the same ask-time search scoring). Often empty — a true gap head-matches
            // nothing — and then there is no magnet and no ribbon, just the response card.
            // The curriculum run stays paused beneath this search.
            magnet: { query: q, idSet: new Set(ids), served: 0,
              dynamic: { attempts: 1, sourceFactIds: ans.sourceFactIds ?? [], texts: [clean] } },
            response: {
              query: q,
              kind: 'generated',
              text: clean,
              suggestion: null,
              // Retrieval's pick, above the measured floor, already checked to be art this
              // device can actually draw — or null, which prints the poster.
              slug: ans.slug ?? null,
            },
            responseAnchorId: adjacent.best?.id ?? suggestion?.id ?? null,
            pageKey: get().pageKey + 1,
          });
          return;
        }
      } catch (e) {
        console.warn('[cards] answerQuery failed; abstaining', e);
      }
      if (!stillCurrent()) return;
      set({ asking: false });
    }
    if (!stillCurrent()) return;

    // Honest miss. In-domain gap → "no page on that yet", offering the nearest topic as a soft
    // landing. Off-domain → "I'm only a science tutor", with NO nearest topic and no anchor:
    // the continue ticket resumes the ordinary walk instead of landing on whichever science
    // card happened to sit closest to a question about a video game.
    // The card's LOCALIZED name, never `topic` — that field is an untranslated English
    // slug-phrase, so printing it raw ended every Tagalog and Cebuano gap card on an English
    // fragment ("Pero subukan natin ito: how geckos blend in with pale color"). The curated
    // title first, then the same label the feed's own choices use. Mirrored in the web demo
    // (packages/web/src/store/useCardDemoStore.ts) — keep the two in sync.
    const nearest = suggestion
      ? cardTitle(suggestion, lang) || choiceLabel(suggestion, lang)
      : null;
    set({
      question: null,
      reward: null,
      asking: false,
      magnet: null, // a gap/offdomain outcome forms no magnet, and retires any previous one
      response: {
        query: q,
        kind: offDomain ? 'offdomain' : 'abstain',
        text: null,
        suggestion: offDomain ? null : nearest,
        // A miss is not ABOUT anything, so there is nothing to illustrate. The disc-centred
        // layout is the whole card.
        slug: null,
      },
      responseAnchorId: offDomain ? null : (suggestion?.id ?? null),
      pageKey: get().pageKey + 1,
    });
  },

  dismissQuery: () => {
    // The banner's [x]: the topic is boring them. Magnet + ribbon go together; the feed
    // continues from wherever it is — the current page and its choices stand, and the next
    // page-turn simply draws unmagnetized.
    const s = get();
    if (!s.magnet) return;
    set({ magnet: null, asking: false, responseAnchorId: null });
    if (s.current && !s.response) set({ choices: nextChoices(s.current.id, s.seen,
      useEngineStore.getState().language ?? 'english', { ctx: feedContext(null, s.curriculum), recentIds: s.recent }) });
  },

  enterCurriculum: (key, savedRun, shelfCat) => {
    const s = get();
    const grade = useEngineStore.getState().grade;
    const picked = curriculumCursor(
      grade,
      key,
      new Set([...seenStore.cards.keys(), ...s.seen]),
      savedRun,
      shelfCat
    );
    if (!picked) return; // not on this grade's outline (no cards) — the sheet never offers it
    if (!savedRun) {
      picked.manualSelection = true;
      if (picked.lessonRun) picked.lessonRun.manualSelection = true;
    }
    // A Calendar tap is an explicit destination, even when the topic was already read.
    // Start a review pass when nothing remains servable in that topic. Only reset the
    // feed's exclusion set: persistent card views, quiz results and awards stay intact.
    const coverage = new Set([...seenStore.cards.keys(), ...s.seen]);
    const cursor = savedRun ? (advanceCurriculum(picked, null, coverage) ?? picked) : picked;
    if (!hasServableCurriculum(s.current?.id ?? null, cursor.idSet, coverage)) {
      for (const id of cursor.idSet) coverage.delete(id);
    }
    set({ seen: coverage });
    // The landing card: the topic's best next unseen card under the ordinary weigher (grade
    // band, seen-decay) — jumpCard confined to the set.
    const dest = jumpCard(s.current?.id ?? null, coverage, feedContext(null, cursor));
    // Entering clears the magnet (mutually exclusive) and commits the cursor in the same turn.
    navigateTo(dest, set, get, { magnet: null, curriculum: cursor });
  },

  exitCurriculum: () => {
    // The curriculum ribbon's [x]: the cursor and the ribbon go together; the current page and
    // its choices stand, and the next page-turn draws unrestricted.
    // Curriculum mode is left explicitly with Randomize; the topic sheet changes its topic.
  },

  continueAfterResponse: async () => {
    const s = get();
    if (s.asking) return;
    const magnet = s.magnet;
    const dynamic = magnet?.dynamic;
    const engine = useEngineStore.getState().engine;
    const lang = useEngineStore.getState().language ?? 'english';
    if (s.response?.kind === 'generated' && magnet && dynamic && dynamic.attempts < 3 &&
        dynamic.sourceFactIds.length && engine?.isReady() && engine.answerQuery) {
      set({ asking: true });
      try {
        const ans = await engine.answerQuery(magnet.query, lang, { excludeFactIds: dynamic.sourceFactIds });
        if (get().magnet !== magnet || get().response !== s.response) return;
        const clean = sanitizeCardAnswer(ans.text);
        const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (ans.grounded && clean && !dynamic.texts.some(text => normalize(text) === normalize(clean)) &&
            ans.sourceFactIds?.length && ans.sourceFactIds.every(id => !dynamic.sourceFactIds.includes(id))) {
          set({ asking: false, magnet: { ...magnet, dynamic: {
            attempts: dynamic.attempts + 1,
            sourceFactIds: [...dynamic.sourceFactIds, ...ans.sourceFactIds], texts: [...dynamic.texts, clean],
          } }, response: { ...s.response, text: clean, slug: ans.slug ?? null }, pageKey: get().pageKey + 1 });
          return;
        }
      } catch (e) {
        console.warn('[cards] search follow-up unavailable; using existing cards', e);
      } finally {
        if (get().magnet === magnet) set({ asking: false });
      }
    }
    // A dismissed/replaced search must not navigate when its old generation settles.
    if (get().magnet !== magnet || get().response !== s.response) return;
    const dest = (s.responseAnchorId && getCard(s.responseAnchorId)) || null;
    set({ response: null, responseAnchorId: null, asking: false });
    navigateTo(dest ?? jumpCard(s.current?.id ?? null, s.seen, feedContext()), set, get);
  },

  warmModel: () => {
    // Background, non-blocking: load the model so reward text can be generated. The feed
    // itself never waits on this (zero-model); if it isn't ready when a reward is due, the
    // deterministic template is used instead.
    const es = useEngineStore.getState();
    if (es.engine?.isReady() || es.isReady) return;
    const lang = es.language;
    if (lang) void es.changeLanguage(lang);
  },

  jumpToRandom: () => {
    const s = get();
    const lang = useEngineStore.getState().language ?? 'tagalog';
    // Randomize alone opts into the keyword-associated feed for this session.
    const ctx = feedContext(null, null);
    const seen = new Set(s.recent);
    const dest = jumpCard(s.current?.id ?? null, seen, ctx);
    const consumedReinforcement = s.reinforcementQueue.includes(dest.id);
    const reinforcementQueue = withoutCard(s.reinforcementQueue, dest.id);
    const remediationQueue = withoutCard(s.remediationQueue, dest.id);
    seen.add(dest.id);
    markSeen(dest, ctx.now);
    const curriculum = null;
    const after = ctx;
    const pagesRead = s.pagesRead + 1;
    const choices = withReinforcement(
      nextChoices(dest.id, seen, lang, {
        threadDepth: 0,
        recentIds: [dest.id],
        ctx: after,
      }),
      reviewFeedQueue(remediationQueue, reinforcementQueue),
      dest.id,
      lang
    );
    set({
      current: dest,
      ...introduce(dest, null, s.introducedTopic),
      asking: false,
      choices,
      threadDepth: 0, // the reroll already switched topic — start the new thread fresh
      question: null,
      pending: null,
      questionAnswered: false,
      response: null,
      magnet: null, // 🎲 = "surprise me": the asked topic is released, ribbon and all
      curriculum,
      currentTopic: null,
      reinforcementQueue,
      remediationQueue,
      seen,
      recent: [dest.id], // fresh trail — the jump is a hard topic switch
      pagesRead,
      untilQuestion: nextGap(), // don't interject right after a jump
      pageKey: s.pageKey + 1,
    });
    if (consumedReinforcement) void acknowledgeReinforcement(dest.id);
    persist({ pagesRead, correctCount: s.correctCount });
  },
}));

/**
 * The choices the store WILL serve once the card underneath becomes current.
 *
 * The deck prints that card in full on the sheet behind the top one — illustration, type and
 * choice tickets — so the preview has to be drawn from the same inputs `advance` will use: the
 * same seen set, the same trail, the same thread depth and the same weighting context. Drawn
 * with defaults instead (no ctx, a one-element seen set) it names a different deep card on
 * roughly half of pages, and the label the reader had already started reading on the sheet
 * beneath would swap the instant the swipe completed.
 *
 * Only meaningful on a single-path page: a fork shows two blank coloured sheets, never a
 * printed preview, so there is nothing to agree with.
 */
export function previewChoices(language: Language): CardChoice[] {
  const s = useCardStore.getState();
  const choice = s.choices.length === 1 ? s.choices[0] : undefined;
  const next = choice ? getCard(choice.factId) : undefined;
  if (!choice || !next) return [];
  const seen = new Set(s.seen);
  seen.add(next.id);
  const recent = [...s.recent, next.id].slice(-RECENT_WINDOW);
  const reinforcementQueue = withoutCard(s.reinforcementQueue, next.id);
  const remediationQueue = withoutCard(s.remediationQueue, next.id);
  // The same magnet transition advance() will make — including the auto-release. Previewing
  // with the CURRENT magnet instead would name a different deep card on the page where the
  // magnet expires, and the sheet beneath would swap labels the instant the swipe completed.
  // The curriculum cursor likewise: the sheet on the page where a topic runs out must already
  // be printed from the NEXT topic's cards, because that is what the swipe will serve.
  const choices = withReinforcement(
    nextChoices(next.id, seen, language, {
      threadDepth: choice.kind === 'lateral' ? 0 : s.threadDepth + 1,
      recentIds: recent,
      ctx: feedContext(
        magnetAfter(s.magnet, next, seen, recent),
        s.curriculum && (s.magnet ? s.curriculum : advanceCurriculum(s.curriculum, next.id, seen))
      ),
    }),
    reviewFeedQueue(remediationQueue, reinforcementQueue),
    next.id,
    language,
    s.curriculum && (s.magnet ? s.curriculum : advanceCurriculum(s.curriculum, next.id, seen))
  );
  // Remember the draw so advance() can ADOPT it instead of paying nextChoices (~21ms of
  // TERM_INDEX walking) again inside the swipe's critical commit — and warm the previewed
  // targets now, during reading time, so the next turn's warmAfter is a cache hit. Adoption
  // also makes the printed preview EXACTLY what the swipe serves: the deep slot was always
  // deterministic (magnetCoin), but the lateral is a weighted random draw, and recomputing
  // it in advance() could legitimately name a different card than the sheet beneath showed.
  previewCache = {
    pageKey: s.pageKey,
    factId: next.id,
    language,
    magnet: s.magnet,
    curriculum: s.curriculum,
    choices,
  };
  void warmPage(choices.map((c) => c.factId));
  return choices;
}

/**
 * The last preview, keyed on everything that could invalidate it: the page it was drawn on
 * (pageKey — every navigation bumps it, so seen/recent/threadDepth are covered), the card it
 * was drawn FOR, the language, and the magnet OBJECT (dismissQuery can null the magnet without
 * turning a page, and a preview drawn under the pull must not be served after the [x]) — and
 * the curriculum cursor OBJECT for the same reason (exitCurriculum nulls it without a turn).
 * Module-scope on purpose: it is a memo of a pure derivation, not state, and the store's
 * public API is unchanged.
 */
let previewCache: {
  pageKey: number;
  factId: string;
  language: Language;
  magnet: ActiveMagnet | null;
  curriculum: ActiveCurriculum | null;
  choices: CardChoice[];
} | null = null;

type Set_ = (partial: Partial<CardState>) => void;
type Get_ = () => CardState;

/**
 * Navigate to an explicit card (from a search hit or a response-continue). Records it like a
 * normal page turn, commits the ask's magnet when one was just formed (its query is the
 * "you asked" ribbon), and resets the interject counter so a question/reward doesn't fire on
 * the very page after a topic jump.
 */
/**
 * Warm the page that was just committed and the ones it leads to.
 *
 * Deliberately NOT awaited: the card being shown was warmed a page ago, so this is preparing
 * the NEXT turn while the reader is still on this one. A page turn therefore never waits on
 * the database.
 *
 * It warms `s.choices` — the store's OWN targets, the two cards the reader can actually tap —
 * and never lets warmPage re-derive them. The draw is weighted (grade, quarter, seen-decay)
 * and the weights move on every page, so a second `nextChoices` call would name a different
 * card; the page the reader turned to would then be cold, and `textOf` is a synchronous cache
 * read with no subscription, so it would stay blank for the whole dwell.
 */
function warmAfter(get: Get_) {
  const s = get();
  const recentFactIds = s.recent.map((id) => getCard(id)?.factId).filter((x): x is string => !!x);
  void warmPage([s.current?.id, ...s.choices.map((c) => c.factId)], recentFactIds);
}

/**
 * What a navigation commits alongside the card. `magnet` is the just-formed magnet of an ask
 * (absent = keep the store's, as a response-continue does); `curriculum` is the cursor being
 * entered (absent = keep the store's).
 */
interface NavigateOpts {
  magnet?: ActiveMagnet | null;
  curriculum?: ActiveCurriculum | null;
}

function navigateTo(fact: CardFact, set: Set_, get: Get_, opts: NavigateOpts = {}) {
  const s = get();
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const seen = new Set(s.seen);
  seen.add(fact.id);
  const recent = [...s.recent, fact.id].slice(-RECENT_WINDOW);
  // The magnet override is the just-formed magnet of an ask (undefined = keep the store's, as
  // a response-continue does). Landing on one of its own cards advances the decay clock, but
  // the exhaustion check deliberately does NOT run here: a just-asked one-card topic still
  // gets its "You asked" ribbon on the very page that answered it. The release fires on the
  // next ordinary turn (advance), where an exhausted set has no pull anyway.
  const base = opts.magnet === undefined ? s.magnet : opts.magnet;
  const magnet = base && base.idSet.has(fact.id) ? { ...base, served: base.served + 1 } : base;
  // The curriculum cursor DOES run its exhaustion check here, unlike the magnet: a topic
  // entered from the sheet whose only servable card is the one just landed on has been
  // exhausted by that landing, and "attempt to exhaust, then move on" means the ribbon should
  // already name the next topic the swipe will serve. An ask's one-off landing (off-set) leaves
  // the cursor where it was unless the held topic has genuinely nothing left from here.
  const held = opts.curriculum === undefined ? s.curriculum : opts.curriculum;
  const curriculum = held && (magnet ? held : advanceCurriculum(held, fact.id, seen));
  const ctx = feedContext(magnet, curriculum);
  markSeen(fact, ctx.now);
  const viewLog = [
    ...s.viewLog,
    { factId: fact.id, topic: cardTitle(fact, lang) || fact.topic, ts: ctx.now },
  ].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  const consumedReinforcement = s.reinforcementQueue.includes(fact.id);
  const reinforcementQueue = withoutCard(s.reinforcementQueue, fact.id);
  const remediationQueue = withoutCard(s.remediationQueue, fact.id);
  const choices = withReinforcement(
    nextChoices(fact.id, seen, lang, { threadDepth: 0, recentIds: recent, ctx }),
    reviewFeedQueue(remediationQueue, reinforcementQueue),
    fact.id,
    lang,
    curriculum,
    magnet
  );
  set({
    current: fact,
    ...introduce(fact, held, s.introducedTopic),
    asking: false,
    currentTopic: !magnet && held?.idSet.has(fact.id) ? held : null,
    choices,
    threadDepth: 0, // a search/topic jump starts a new thread
    seen,
    recent,
    viewLog,
    pagesRead,
    reinforcementQueue,
    remediationQueue,
    question: null,
    reward: null,
    response: null,
    pending: null,
    questionAnswered: false,
    magnet,
    curriculum,
    untilQuestion: nextGap(), // don't interject right after a search / topic jump
    untilReward: s.untilReward - 1,
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });
  if (consumedReinforcement) void acknowledgeReinforcement(fact.id);
  warmAfter(get);
}

/** Advance the walk onto the chosen card (the normal page-turn). */
function advance(choice: CardChoice, set: Set_, get: Get_) {
  const s = get();
  const nextFact = getCard(choice.factId);
  if (!nextFact) return;
  const lang = useEngineStore.getState().language ?? 'tagalog';

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  // The magnet after this turn: decay clock advanced if a magnet card was just served,
  // AUTO-RELEASED (null, ribbon gone, silently) once no unseen member is servable from here.
  // The choices below are drawn with the post-turn magnet, so the pull and the release both
  // take effect on the page where they happened.
  const magnet = magnetAfter(s.magnet, nextFact, seen, recent);
  // The curriculum cursor after this turn: the same object while the held topic still has a
  // servable card from here, the next non-empty competency in CG order once it is exhausted,
  // null (released, ribbon gone) past the end of the outline — see advanceCurriculum.
  const curriculum = s.curriculum && (magnet ? s.curriculum : advanceCurriculum(s.curriculum, nextFact.id, seen));
  const ctx = feedContext(magnet, curriculum);
  markSeen(nextFact, ctx.now);
  const viewLog = [
    ...s.viewLog,
    { factId: nextFact.id, topic: cardTitle(nextFact, lang) || nextFact.topic, ts: ctx.now },
  ].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  const untilReward = s.untilReward - 1;
  const consumedReinforcement = s.reinforcementQueue.includes(nextFact.id);
  const reinforcementQueue = withoutCard(s.reinforcementQueue, nextFact.id);
  const remediationQueue = withoutCard(s.remediationQueue, nextFact.id);

  // Taking the lateral fork is itself a topic switch, so it restarts the thread; otherwise
  // the counter walks up until nextChoices forks, then resets on the page that offered it.
  const depth = choice.kind === 'lateral' ? 0 : s.threadDepth + 1;
  // Adopt the preview's draw when it is provably this exact turn (see previewCache): the
  // sheet beneath already printed those tickets, and this is the single biggest cost inside
  // the swipe commit. Fork picks, interject resumes, rerolls and asks all miss the key and
  // pay the ordinary compute path.
  const cached = previewCache;
  const naturalChoices =
    cached &&
    cached.pageKey === s.pageKey &&
    cached.factId === nextFact.id &&
    cached.language === lang &&
    cached.magnet === s.magnet &&
    cached.curriculum === s.curriculum
      ? cached.choices
      : nextChoices(nextFact.id, seen, lang, { threadDepth: depth, recentIds: recent, ctx });
  const choices = withReinforcement(
    naturalChoices,
    reviewFeedQueue(remediationQueue, reinforcementQueue),
    nextFact.id,
    lang,
    curriculum,
    magnet
  );

  set({
    current: nextFact,
    ...introduce(nextFact, s.curriculum, s.introducedTopic),
    // Reinforcement may briefly revisit a missed card from an earlier topic. Keep the
    // calendar cursor moving underneath, but do not mislabel that refresher as the held row.
    currentTopic: !magnet && s.curriculum?.idSet.has(nextFact.id) ? s.curriculum : null,
    choices,
    threadDepth: choices.length > 1 ? 0 : depth,
    seen,
    recent,
    viewLog,
    pagesRead,
    untilQuestion: s.untilQuestion - 1,
    untilReward,
    reinforcementQueue,
    remediationQueue,
    magnet, // persists across ordinary turns until [x] / auto-release / new ask / reroll
    curriculum, // persists across ordinary turns until [x] / end-of-outline release
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });
  if (consumedReinforcement) void acknowledgeReinforcement(nextFact.id);

  // The reward-line prefetch is NOT kicked from here any more. It used to start on this
  // page-turn whenever the reward was within REWARD_PREFETCH_AT cards — i.e. a full
  // llama.cpp completion began exactly as the next page was painting and the card was in
  // flight, and that was the measured stall. It is now DWELL-GATED: the page-turn hook
  // (the pageKey subscription below the store) aborts any generation in flight and arms a
  // dwell timer; the generation starts only once the reader has sat on this page for
  // REWARD_PREFETCH_DWELL_MS with no finger on it. See REWARD_PREFETCH_AT.
  warmAfter(get);
}

// ---------------------------------------------------------------------------------------
// REWARD-LINE PREFETCH SCHEDULER (see REWARD_PREFETCH_AT for the contract and the measurement).
// Module-scope, not store state: it is bookkeeping for one speculative background job — a
// dwell timer, a "finger is down" flag, the AbortController of the generation in flight, and
// the count of attempts this reward cycle has already lost — none of which a component renders.
// ---------------------------------------------------------------------------------------
const rewardJob: {
  dwell: ReturnType<typeof setTimeout> | null;
  dragging: boolean;
  inflight: { ctrl: AbortController; t0: number } | null;
  aborts: number;
} = { dwell: null, dragging: false, inflight: null, aborts: 0 };

/**
 * True when a generated line is still wanted this cycle: the reward is near, none is held or
 * showing, and the cycle has not burned its attempt budget. This is the ARM-time predicate —
 * it deliberately ignores `rewardPrefetching`, because right after an abort the cancelled run
 * is still winding down (the flag stays up until its stream ends), and a dwell armed for the
 * NEW page must not be refused for that; prefetchReward re-checks the flag at fire time.
 */
function rewardNear(s: CardState): boolean {
  return (
    s.untilReward <= REWARD_PREFETCH_AT &&
    !s.titleCard &&
    !s.rewardPrefetch &&
    !s.reward &&
    rewardJob.aborts < REWARD_PREFETCH_MAX_ABORTS
  );
}

/** The FIRE-time predicate: rewardNear, and no generation (even a cancelling one) in flight. */
function rewardWanted(s: CardState): boolean {
  return rewardNear(s) && !s.rewardPrefetching;
}

/**
 * Stop the speculative generation NOW (finger down, page turned, ask started) and drop any
 * armed dwell. The abort travels: AbortController → LocalEngine.generateReward's listener →
 * SDK `cancel({ requestId })` → the worker's hard model cancel → the stream ends `cancelled`
 * → generateReward rejects → withModelLock's slot settles → the lock is free. A cancel that
 * never lands only means the run finishes on its own within its `predict` cap, exactly as
 * before this gate existed; the caller's own signal is already `aborted` either way, so the
 * attempt is treated as lost and the next qualifying dwell retries.
 */
function abortRewardPrefetch(reason: string) {
  if (rewardJob.dwell) {
    clearTimeout(rewardJob.dwell);
    rewardJob.dwell = null;
  }
  const job = rewardJob.inflight;
  if (!job) return;
  rewardJob.inflight = null;
  rewardJob.aborts += 1;
  job.ctrl.abort();
  console.log(
    `[reward] prefetch aborted ${Date.now() - job.t0}ms · ${reason} · ` +
      `attempt ${rewardJob.aborts}/${REWARD_PREFETCH_MAX_ABORTS}`
  );
}

/**
 * (Re)start the dwell clock for the CURRENT page. Fires prefetchReward after
 * REWARD_PREFETCH_DWELL_MS of stillness; every call restarts it (a page turn, a finger
 * lifting), and it is refused outright while a finger is down — markDragEnd arms it then.
 * Cheap pre-check so the common case (reward far off) costs no timer at all.
 */
function armRewardDwell() {
  if (rewardJob.dwell) {
    clearTimeout(rewardJob.dwell);
    rewardJob.dwell = null;
  }
  if (rewardJob.dragging || !rewardNear(useCardStore.getState())) return;
  rewardJob.dwell = setTimeout(() => {
    rewardJob.dwell = null;
    void prefetchReward();
  }, REWARD_PREFETCH_DWELL_MS);
}

/**
 * Generate the reward line in the background — ONE attempt, at the end of a qualifying
 * dwell. Praise-only (LocalEngine.generateReward's prompt names no topic and no fact);
 * sanitized here and covered by templateReward on any doubt, so an aborted, failed or empty
 * attempt never costs the child anything but the LLM's phrasing.
 *
 * Every gate is re-read at fire time, not arm time: the reward still near and unheld, no
 * finger down, NO ASK PENDING (a child's own question outranks a speculative line, and the
 * two would otherwise queue on the same model lock), the engine actually ready. Anything
 * failing simply skips this dwell; the next page turn or finger-lift arms another.
 */
async function prefetchReward() {
  const s = useCardStore.getState();
  if (!rewardWanted(s) || rewardJob.dragging || s.asking || rewardJob.inflight) return;
  // Never in the background. Android pauses JS timers while the app is backgrounded and
  // fires the overdue ones on resume — possibly BEFORE the AppState 'active' event has
  // re-armed the dwell — so the fire-time check is what keeps a resume from starting a
  // generation under the reader's first swipe. The foreground hook then arms a fresh dwell.
  if (AppState.currentState === 'background') return;
  const es = useEngineStore.getState();
  const engine = es.engine;
  if (!engine?.isReady() || !engine.generateReward) return;
  const lang = es.language ?? 'tagalog';
  const topics = recapTopics(s.viewLog, lang);
  if (topics.length < REWARD_MIN_TOPICS) return;
  const minutes = Math.max(1, Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000));

  const ctrl = new AbortController();
  const t0 = Date.now();
  rewardJob.inflight = { ctrl, t0 };
  useCardStore.setState({ rewardPrefetching: true });
  // Logged because this generation is the measured cause of mid-swipe stalls (2026-09-06:
  // the app burned ~7 of 8 cores during every stalled swipe and <1 during smooth ones) — the
  // marks let a logcat line up a stall with the generation that was running under it. With
  // the dwell gate in place, a '[reward] prefetch start' should never sit inside a '[swipe]'
  // pair; an 'aborted' should follow every drag that interrupts one.
  console.log(`[reward] prefetch start · ${topics.length} topics · ${s.pagesRead} pages`);
  try {
    // withModelLock semantics are unchanged: the generation is serialized with the ask.
    // If the abort lands while this is still QUEUED behind the lock, nothing is generated —
    // the slot settles at once and the lock passes on.
    const raw = await withModelLock<string | null>(() =>
      ctrl.signal.aborted
        ? Promise.resolve(null)
        : engine.generateReward!(topics, useCardStore.getState().pagesRead, lang, ctrl.signal)
    );
    // Whatever happens from here, the job is over: a late abort has nothing to cancel.
    if (rewardJob.inflight?.ctrl === ctrl) rewardJob.inflight = null;
    if (raw === null) return; // aborted before it started — already logged by the abort
    console.log(`[reward] prefetch generated in ${Date.now() - t0}ms`);
    const clean = sanitizeReward(raw);
    // Only accept if still un-shown and valid; otherwise the template covers it.
    if (clean && !useCardStore.getState().reward) {
      useCardStore.setState({
        rewardPrefetch: {
          text: clean,
          topics: topics.slice(0, 3),
          count: useCardStore.getState().pagesRead,
          source: 'llm',
          minutes,
        },
      });
    }
  } catch (e) {
    // An aborted attempt is the designed outcome of a drag, not a failure — it was logged
    // by abortRewardPrefetch; only a genuine failure is worth a warning.
    if (!ctrl.signal.aborted)
      console.warn('[cards] reward prefetch failed; template will be used', e);
  } finally {
    if (rewardJob.inflight?.ctrl === ctrl) rewardJob.inflight = null;
    // The flag is cleared even on abort, so isReady/asking are never held hostage by this
    // job and the next qualifying dwell can start a fresh attempt.
    useCardStore.setState({ rewardPrefetching: false });
    // An ABORTED attempt re-arms the dwell for the page the reader is on NOW (unless one is
    // already armed): the page-turn that aborted this run arms nothing itself once a cancel
    // is winding down, and a finger still on the card is refused by armRewardDwell. Bounded
    // by REWARD_PREFETCH_MAX_ABORTS through rewardNear, so this cannot loop. A generation
    // that FAILED or was sanitised away is not re-armed here — it keeps the once-per-page
    // cadence (the next page turn), never a retry every dwell.
    if (ctrl.signal.aborted && !rewardJob.dwell) armRewardDwell();
  }
}

/**
 * THE PAGE-TURN HOOK. Every navigation in this store bumps `pageKey` (advance, navigateTo,
 * jumpToRandom, every interject and response page), so one subscription is the single place
 * that says "the reader moved": abort whatever was generating and start a fresh dwell on the
 * new page. `asking` flipping on is the other trigger — the child's own question must not
 * queue behind a speculative line on the model lock (the ask itself ends in a page turn on
 * every path, which re-arms). Deliberately a subscription rather than a call at each site:
 * the contract is "a page turned", not "advance() ran".
 */
useCardStore.subscribe((s, prev) => {
  if (s.asking && !prev.asking) abortRewardPrefetch('ask started');
  // untilReward only ever counts DOWN, except when the reward page is served and the next
  // gap is drawn — that jump is the start of a new cycle, and the attempt budget renews.
  if (s.untilReward > prev.untilReward) rewardJob.aborts = 0;
  if (s.pageKey === prev.pageKey) return;
  abortRewardPrefetch('page turned');
  armRewardDwell();
});

/**
 * THE ENGINE HOOK. A language change shuts the old engine down (engineStore.changeLanguage →
 * prev.shutdown() → unloadModel) — a reward generation still running on it must be cancelled
 * first, not left for the unload to find. The engine object swapping or readiness dropping is
 * that moment. Readiness RISING is the mirror case: a dwell that fired while the model was
 * cold skipped (prefetchReward's isReady gate) and nothing else re-arms until the next page
 * turn, so the warm-up completing arms one for the page the reader is on.
 */
useCardStore.subscribe((s, prev) => {
  if (s.curriculum && s.curriculum !== prev.curriculum) {
    if (s.curriculum.lessonRun)
      void setSetting(
        `cards.lessonRun.${s.curriculum.grade}`,
        JSON.stringify(s.curriculum.lessonRun)
      ).catch((e) => console.warn('[cards] saving lesson failed', e));
    void setSetting(`cards.curriculum.${s.curriculum.grade}`, s.curriculum.key).catch((e) =>
      console.warn('[cards] saving curriculum failed', e)
    );
  }
});

useEngineStore.subscribe((s, prev) => {
  if (s.grade !== prev.grade && useCardStore.getState().hydrated) {
    const cursor = estimatedCurriculumCursor(s.grade, inferCurriculumQuarter(new Date()).fraction);
    void Promise.all([
      getSetting(`cards.curriculum.${s.grade}`),
      getSetting(`cards.lessonRun.${s.grade}`),
    ])
      .catch(() => [null, null])
      .then(([key, rawRun]) => {
        if (useEngineStore.getState().grade !== s.grade) return;
        const saved = key && curriculumCursor(s.grade, key);
        const next = saved || cursor;
        let savedRun: unknown;
        try {
          savedRun = rawRun ? JSON.parse(rawRun) : undefined;
        } catch {
          /* replan */
        }
        const resumeKey =
          (s.grade === 3 ||
            s.grade === 4 ||
            s.grade === 5 ||
            s.grade === 6 ||
            s.grade === 7 ||
            s.grade === 8 ||
            s.grade === 9 ||
            s.grade === 10) &&
          typeof (savedRun as { key?: unknown })?.key === 'string'
            ? (savedRun as { key: string }).key
            : next?.key;
        if (resumeKey) useCardStore.getState().enterCurriculum(resumeKey, savedRun);
      });
  }
  if (s.engine !== prev.engine || (prev.isReady && !s.isReady))
    abortRewardPrefetch('engine changed');
  if (s.isReady && !prev.isReady) armRewardDwell();
});

/**
 * THE FOREGROUND HOOK. Backgrounded, the reader is not reading: a running generation is
 * cancelled (no point heating the phone for a line nobody is walking toward) and the dwell is
 * dropped — Android pauses JS timers in the background anyway, so an armed dwell would
 * otherwise fire the moment the app resumed, i.e. exactly as the reader's first swipe lands.
 * Returning to the foreground starts a fresh dwell on the current page instead.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') armRewardDwell();
  else abortRewardPrefetch(`app ${state}`);
});

function introduce(fact: CardFact, cursor: CurriculumCursor | null, previous: string | null) {
  const content = titleForCard(fact, useEngineStore.getState().grade, cursor);
  return { titleCard: content && content.key !== previous ? content : null, introducedTopic: content?.key ?? previous };
}
