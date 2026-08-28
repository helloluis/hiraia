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
import { create } from 'zustand';

import { inferCurriculumQuarter, type SeenRecord } from '@hiraia/shared';

import { DEFAULT_GRADE } from '../config/grades';
import {
  competencyKeys,
  getCard,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  type CardChoice,
  type CardFact,
  type CardQuestion,
  type FeedContext,
} from '../data/cards';
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

const RECENT_WINDOW = 5; // "ask about something the kid just saw"
const VIEWLOG_CAP = 40; // session view-log for the reward recap (topic + timestamp)
const REWARD_PREFETCH_AT = 5; // start generating the reward text N cards before it's due
const REWARD_MIN_TOPICS = 3; // don't reward until there's something to celebrate

/**
 * A search result that isn't a straight card navigation: either a model-generated grounded
 * answer, or an honest abstention. (A retrieval HIT navigates directly to the found card
 * with a `queryBanner` instead — no FeedResponse needed.)
 */
export interface FeedResponse {
  query: string;
  kind: 'generated' | 'abstain';
  text: string | null; // generated answer (already localized)
  suggestion: string | null; // topic label of the nearest card, for the abstention path
}

interface CardState {
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
  /** "Ang tanong mo: X" ribbon shown when a search navigated straight to a found card. */
  queryBanner: string | null;
  /** Monotonic page number — keys the flip + typewriter remounts. */
  pageKey: number;
  pagesRead: number;
  correctCount: number;
  questionsAsked: number;
  /** Cards shown THIS SESSION — the hard "don't repeat this sitting" filter. Deliberately not
   *  persisted: across restarts the SQLite seen-store only LOWERS a card's weight (never zero). */
  seen: Set<string>;
  recent: string[]; // last few factIds (question sourcing)
  viewLog: ViewLogEntry[]; // {factId, topic, ts} for the reward recap window
  untilQuestion: number; // pages left until the next interject question
  untilReward: number; // pages left until the next reward card (jittered)
  askedFacts: Set<string>; // don't re-ask the same fact this session
  rewardPrefetch: RewardContent | null; // pre-generated reward text, ready to show
  rewardPrefetching: boolean; // a generation is in flight

  hydrate: () => Promise<void>;
  choose: (choice: CardChoice) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: () => void;
  continueAfterReward: () => void;
  /** Kid typed a query: retrieval-first → found card, else warm-model answer, else abstain. */
  ask: (query: string) => Promise<void>;
  continueAfterResponse: () => void;
  /** Kick a background model warm-up so reward text can be generated (non-blocking). */
  warmModel: () => void;
  /** "Shake to reroll" — teleport to an unrelated fresh topic (escape a deep/stale thread). */
  jumpToRandom: () => void;
}

const nextGap = () => 4 + Math.floor(Math.random() * 2); // question: every 4-5 pages
// reward: jittered 15-25 pages so it lands as a dopamine hit, never on a fixed beat.
// TODO(testing): temporarily 6-10 so the reward is reachable in a short play session —
// restore to `15 + rand(0..10)` before ship.
const nextRewardGap = () => 6 + Math.floor(Math.random() * 5);

function persist(s: { pagesRead: number; correctCount: number }) {
  void setSetting('cards.pages', String(s.pagesRead));
  void setSetting('cards.correct', String(s.correctCount));
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

/** Fresh weighting context for one draw: grade + clock are re-read every time. */
function feedContext(): FeedContext {
  return {
    studentGrade: useEngineStore.getState().grade ?? DEFAULT_GRADE,
    currentQuarter: inferCurriculumQuarter(new Date()).quarter,
    now: Date.now(),
    cardSeen: seenStore.cards,
    competencySeen: seenStore.competencies,
  };
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
  recordCardSeen(card.id, codes[0] ?? 'off', now).catch((e) => console.warn('[cards] recordCardSeen failed', e));
  for (const code of codes.slice(1)) {
    recordCompetencySeen(code, now).catch((e) => console.warn('[cards] recordCompetencySeen failed', e));
  }
}

let hydrating: Promise<void> | null = null;

export const useCardStore = create<CardState>()((set, get) => ({
  hydrated: false,
  current: null,
  choices: [],
  question: null,
  pending: null,
  questionAnswered: false,
  reward: null,
  response: null,
  asking: false,
  responseAnchorId: null,
  queryBanner: null,
  pageKey: 0,
  pagesRead: 0,
  correctCount: 0,
  questionsAsked: 0,
  seen: new Set<string>(),
  recent: [],
  viewLog: [],
  untilQuestion: nextGap(),
  untilReward: nextRewardGap(),
  askedFacts: new Set<string>(),
  rewardPrefetch: null,
  rewardPrefetching: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrating) return hydrating; // re-entrant call (StrictMode double effect / remount) shares one draw
    hydrating = (async () => {
      let pagesRead = 0;
      let correctCount = 0;
      const seen = new Set<string>(); // session-only (see CardState.seen)
      try {
        pagesRead = Number((await getSetting('cards.pages')) ?? 0) || 0;
        correctCount = Number((await getSetting('cards.correct')) ?? 0) || 0;
        const stored = await loadSeen();
        seenStore.cards = stored.cards;
        seenStore.competencies = stored.competencies;
      } catch (e) {
        console.warn('[cards] hydrate failed, starting fresh', e);
      }
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const ctx = feedContext();
      const first = startCard(seen, ctx);
      seen.add(first.id);
      markSeen(first, ctx.now);
      set({
        hydrated: true,
        pagesRead,
        correctCount,
        seen,
        current: first,
        choices: nextChoices(first.id, seen, lang, ctx),
        recent: [first.id],
        viewLog: [{ factId: first.id, topic: first.topic, ts: ctx.now }],
        pageKey: 1,
      });

    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  choose: (choice) => {
    const s = get();
    if (s.question || s.reward || s.response) return; // an interject page is up — resolve it first

    // REWARD due? (jittered 15-25 pages, needs enough distinct topics.) Rarer than the
    // quiz, so check it first; it intercepts the flip and resumes the choice after.
    if (s.untilReward <= 1 && recentTopics(s.viewLog).length >= REWARD_MIN_TOPICS) {
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const topics = recentTopics(s.viewLog);
      const minutes = Math.max(1, Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000));
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

    // Interject QUESTION due? Ask about a RECENTLY-READ fact (not the one we're heading
    // to) that has an exact MCQ and wasn't asked this session. If nothing qualifies,
    // defer and retry next page.
    if (s.untilQuestion <= 1) {
      const candidates = s.recent
        .filter((id) => id !== choice.factId && !s.askedFacts.has(id))
        .map((id) => questionForFact(id))
        .filter((q): q is CardQuestion => !!q);
      const picked = candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]!
        : null;
      if (picked) {
        set({
          question: picked,
          pending: choice,
          questionAnswered: false,
          untilQuestion: nextGap(),
          askedFacts: new Set(s.askedFacts).add(picked.f),
          questionsAsked: s.questionsAsked + 1,
          pageKey: s.pageKey + 1,
        });
        return;
      }
    }
    advance(choice, set, get);
  },

  answerQuestion: (correct) => {
    const s = get();
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
    const lang = useEngineStore.getState().language ?? 'tagalog';

    // Retrieval-first: a confident local match navigates straight to that card (instant,
    // zero-model), with a "you asked" banner. The card becomes the new feed anchor.
    const res = searchCards(q, s.current?.id ?? null);
    if (res.best) {
      navigateTo(res.best, set, get, q);
      return;
    }

    // Miss → try the warm model for a grounded answer; anything less is an honest abstention.
    const suggestion = res.suggestion;
    const anchorId = suggestion?.id ?? null;
    const es = useEngineStore.getState();
    const engine = es.engine;
    if (engine?.isReady() && engine.answerQuery) {
      set({ asking: true });
      try {
        // Under the model lock: the single-instance model may be mid-chat or re-priming a grade.
        const ans = await withModelLock(() => engine.answerQuery!(q, lang));
        const clean = sanitizeAnswer(ans.text);
        if (ans.grounded && clean && !get().response) {
          set({
            asking: false,
            question: null,
            reward: null,
            queryBanner: null,
            response: { query: q, kind: 'generated', text: clean, suggestion: null },
            responseAnchorId: anchorId,
            pageKey: get().pageKey + 1,
          });
          return;
        }
      } catch (e) {
        console.warn('[cards] answerQuery failed; abstaining', e);
      }
      set({ asking: false });
    }

    // Abstain — honest "I don't know that yet", offering the nearest topic as a soft landing.
    set({
      question: null,
      reward: null,
      queryBanner: null,
      response: {
        query: q,
        kind: 'abstain',
        text: null,
        suggestion: suggestion ? suggestion.topic : null,
      },
      responseAnchorId: anchorId,
      pageKey: get().pageKey + 1,
    });
  },

  continueAfterResponse: () => {
    const s = get();
    const dest = (s.responseAnchorId && getCard(s.responseAnchorId)) || null;
    set({ response: null, responseAnchorId: null });
    if (dest) {
      navigateTo(dest, set, get);
    } else {
      navigateTo(jumpCard(s.current?.id ?? null, s.seen, feedContext()), set, get);
    }
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
    const ctx = feedContext();
    const dest = jumpCard(s.current?.id ?? null, s.seen, ctx);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    markSeen(dest, ctx.now);
    const pagesRead = s.pagesRead + 1;
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, lang, ctx),
      question: null,
      pending: null,
      questionAnswered: false,
      response: null,
      queryBanner: null,
      seen,
      recent: [dest.id], // fresh trail — the jump is a hard topic switch
      pagesRead,
      untilQuestion: nextGap(), // don't interject right after a jump
      pageKey: s.pageKey + 1,
    });
    persist({ pagesRead, correctCount: s.correctCount });
  },
}));

type Set_ = (partial: Partial<CardState>) => void;
type Get_ = () => CardState;

/**
 * Navigate to an explicit card (from a search hit or a response-continue). Records it like a
 * normal page turn, sets an optional "you asked" banner, and resets the interject counter so
 * a question/reward doesn't fire on the very page after a topic jump.
 */
function navigateTo(fact: CardFact, set: Set_, get: Get_, banner?: string) {
  const s = get();
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const ctx = feedContext();
  const seen = new Set(s.seen);
  seen.add(fact.id);
  markSeen(fact, ctx.now);
  const recent = [...s.recent, fact.id].slice(-RECENT_WINDOW);
  const viewLog = [...s.viewLog, { factId: fact.id, topic: fact.topic, ts: ctx.now }].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  set({
    current: fact,
    choices: nextChoices(fact.id, seen, lang, ctx),
    seen,
    recent,
    viewLog,
    pagesRead,
    question: null,
    reward: null,
    response: null,
    pending: null,
    questionAnswered: false,
    queryBanner: banner ?? null,
    untilQuestion: nextGap(), // don't interject right after a search / topic jump
    untilReward: s.untilReward - 1,
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });
}

/**
 * Light guard on a model-generated answer before it reaches a child: trim, strip any leaked
 * prompt scaffolding, collapse whitespace, and reject empty/degenerate output (the caller
 * then abstains rather than showing junk).
 */
function sanitizeAnswer(raw: string): string | null {
  let t = (raw ?? '').trim();
  if (!t) return null;
  t = t.replace(/^(sagot|answer|tubag)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (t.length < 8) return null;
  if (t.length > 320) t = t.slice(0, 317).trimEnd() + '…';
  return t;
}

/** Advance the walk onto the chosen card (the normal page-turn). */
function advance(choice: CardChoice, set: Set_, get: Get_) {
  const s = get();
  const nextFact = getCard(choice.factId);
  if (!nextFact) return;
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const ctx = feedContext();

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  markSeen(nextFact, ctx.now);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  const viewLog = [...s.viewLog, { factId: nextFact.id, topic: nextFact.topic, ts: ctx.now }].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  const untilReward = s.untilReward - 1;

  set({
    current: nextFact,
    choices: nextChoices(nextFact.id, seen, lang, ctx),
    seen,
    recent,
    viewLog,
    pagesRead,
    untilQuestion: s.untilQuestion - 1,
    untilReward,
    queryBanner: null, // a normal page-turn clears any lingering search banner
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });

  // Prefetch the LLM reward line a few cards ahead so it's fully rendered before it's due
  // (hides the on-device generation latency behind dwell time).
  if (untilReward <= REWARD_PREFETCH_AT) void prefetchReward(get, set);
}

/**
 * Generate the reward line in the background (once) if the model is warm. Grounded on the
 * kid's real recent topics; sanitized + fell back to a template by the caller on any doubt.
 */
async function prefetchReward(get: Get_, set: Set_) {
  const s = get();
  if (s.rewardPrefetch || s.rewardPrefetching) return;
  const es = useEngineStore.getState();
  const engine = es.engine;
  if (!engine?.isReady() || !engine.generateReward) return;
  const topics = recentTopics(s.viewLog);
  if (topics.length < REWARD_MIN_TOPICS) return;
  const lang = es.language ?? 'tagalog';
  const minutes = Math.max(1, Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000));

  set({ rewardPrefetching: true });
  try {
    const raw = await withModelLock(() => engine.generateReward!(topics, get().pagesRead, lang));
    const clean = sanitizeReward(raw);
    // Only accept if still un-shown and valid; otherwise the template covers it.
    if (clean && !get().reward) {
      set({ rewardPrefetch: { text: clean, topics: topics.slice(0, 3), count: get().pagesRead, source: 'llm', minutes } });
    }
  } catch (e) {
    console.warn('[cards] reward prefetch failed; template will be used', e);
  } finally {
    set({ rewardPrefetching: false });
  }
}
