/**
 * Question-cards feed state (v1). App-orchestrated, zero-model, same doctrine as quiz
 * mode: every card/question is pre-verified bundled data; the store is a deterministic
 * walk over the card graph.
 *
 * Flow: card → (choose deep/lateral) → flip → next card … Every 4-5 pages the chosen
 * flip is INTERCEPTED by one question page asking about a recently-read fact (75% of
 * the pool has an exact MCQ). Answering shows a single "continue" note that resumes the
 * walk onto the card the kid originally chose — their choice is honored, never dropped.
 * Counters (pages read / questions correct) + the seen-set persist via the settings table.
 */
import { create } from 'zustand';

import {
  getCard,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  warmPage,
  type CardChoice,
  type CardFact,
  type CardQuestion,
} from '../data/cards';
import { loadTokenIndex } from '../data/cardDb';
import {
  recentTopics,
  sanitizeReward,
  templateReward,
  type RewardContent,
  type ViewLogEntry,
} from '../data/reward';
import { getSetting, setSetting } from '../db/repo';
import { useEngineStore } from './engineStore';

const SEEN_CAP = 2500; // persisted seen-set cap (pool is ~3.5k; cycling is fine)
// Trail of just-read cards. Two consumers: "ask about something the kid just saw" (quiz
// interjects) and the illustration cooldown in nextChoices (don't reuse a recent picture).
const RECENT_WINDOW = 5;
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

function persist(s: { pagesRead: number; correctCount: number; seen: Set<string> }) {
  void setSetting('cards.pages', String(s.pagesRead));
  void setSetting('cards.correct', String(s.correctCount));
  void setSetting('cards.seen', JSON.stringify([...s.seen].slice(-SEEN_CAP)));
}

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
  threadDepth: 0,
  askedFacts: new Set<string>(),
  rewardPrefetch: null,
  rewardPrefetching: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let pagesRead = 0;
    let correctCount = 0;
    let seen = new Set<string>();
    try {
      pagesRead = Number((await getSetting('cards.pages')) ?? 0) || 0;
      correctCount = Number((await getSetting('cards.correct')) ?? 0) || 0;
      seen = new Set<string>(JSON.parse((await getSetting('cards.seen')) ?? '[]'));
    } catch (e) {
      console.warn('[cards] hydrate failed, starting fresh', e);
    }
    const lang = useEngineStore.getState().language ?? 'tagalog';
    const first = startCard(seen);
    seen.add(first.id);
    // The card's prose lives in the database now, so it has to be here before the page
    // paints — this is the ONE await the feed has, and it covers the first card and the
    // pages it can turn to. The token index rides along for the duplicate check.
    // Best-effort: a database that will not open must NOT stop the feed from rendering. The
    // first build of this let the rejection escape and the app never left its splash screen.
    await Promise.all([
      loadTokenIndex().catch(() => undefined),
      warmPage([first.id], lang).catch((e) => console.warn('[cards] warm failed:', e)),
    ]);
    set({
      hydrated: true,
      pagesRead,
      correctCount,
      seen,
      current: first,
      choices: nextChoices(first.id, seen, lang, { threadDepth: 0, recentIds: [first.id] }),
      threadDepth: 0,
      recent: [first.id],
      viewLog: [{ factId: first.id, topic: first.topic, ts: Date.now() }],
      pageKey: 1,
    });
  },

  choose: (choice) => {
    const s = get();
    if (s.question || s.reward || s.response) return; // an interject page is up — resolve it first

    // REWARD due? (jittered 15-25 pages, needs enough distinct topics.) Rarer than the
    // quiz, so check it first; it intercepts the flip and resumes the choice after.
    if (s.untilReward <= 1 && recentTopics(s.viewLog).length >= REWARD_MIN_TOPICS) {
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const topics = recentTopics(s.viewLog);
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
    persist({ pagesRead: s.pagesRead, correctCount, seen: s.seen });
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
    const res = await searchCards(q, s.current?.id ?? null);
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
        const ans = await engine.answerQuery(q, lang);
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
      navigateTo(jumpCard(s.current?.id ?? null, s.seen), set, get);
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
    const dest = jumpCard(s.current?.id ?? null, s.seen);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    const pagesRead = s.pagesRead + 1;
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, lang, { threadDepth: 0, recentIds: [dest.id] }),
      threadDepth: 0, // the reroll already switched topic — start the new thread fresh
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
    persist({ pagesRead, correctCount: s.correctCount, seen });
  },
}));

type Set_ = (partial: Partial<CardState>) => void;
type Get_ = () => CardState;

/**
 * Navigate to an explicit card (from a search hit or a response-continue). Records it like a
 * normal page turn, sets an optional "you asked" banner, and resets the interject counter so
 * a question/reward doesn't fire on the very page after a topic jump.
 */
/**
 * Warm the page that was just committed and the ones it leads to.
 *
 * Deliberately NOT awaited: the card being shown was warmed a page ago, so this is preparing
 * the NEXT turn while the reader is still on this one. A page turn therefore never waits on
 * the database.
 */
function warmAfter(get: Get_) {
  const s = get();
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const recentFactIds = s.recent.map((id) => getCard(id)?.factId).filter((x): x is string => !!x);
  void warmPage([s.current?.id], lang, recentFactIds);
}

function navigateTo(fact: CardFact, set: Set_, get: Get_, banner?: string) {
  const s = get();
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const seen = new Set(s.seen);
  seen.add(fact.id);
  const recent = [...s.recent, fact.id].slice(-RECENT_WINDOW);
  const viewLog = [...s.viewLog, { factId: fact.id, topic: fact.topic, ts: Date.now() }].slice(
    -VIEWLOG_CAP
  );
  const pagesRead = s.pagesRead + 1;
  set({
    current: fact,
    choices: nextChoices(fact.id, seen, lang, { threadDepth: 0, recentIds: recent }),
    threadDepth: 0, // a search/topic jump starts a new thread
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
  persist({ pagesRead, correctCount: s.correctCount, seen });
  warmAfter(get);
}

/**
 * Light guard on a model-generated answer before it reaches a child: trim, strip any leaked
 * prompt scaffolding, collapse whitespace, and reject empty/degenerate output (the caller
 * then abstains rather than showing junk).
 */
function sanitizeAnswer(raw: string): string | null {
  let t = (raw ?? '').trim();
  if (!t) return null;
  t = t
    .replace(/^(sagot|answer|tubag)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  const viewLog = [
    ...s.viewLog,
    { factId: nextFact.id, topic: nextFact.topic, ts: Date.now() },
  ].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  const untilReward = s.untilReward - 1;

  // Taking the lateral fork is itself a topic switch, so it restarts the thread; otherwise
  // the counter walks up until nextChoices forks, then resets on the page that offered it.
  const depth = choice.kind === 'lateral' ? 0 : s.threadDepth + 1;
  const choices = nextChoices(nextFact.id, seen, lang, { threadDepth: depth, recentIds: recent });

  set({
    current: nextFact,
    choices,
    threadDepth: choices.length > 1 ? 0 : depth,
    seen,
    recent,
    viewLog,
    pagesRead,
    untilQuestion: s.untilQuestion - 1,
    untilReward,
    queryBanner: null, // a normal page-turn clears any lingering search banner
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount, seen });

  // Prefetch the LLM reward line a few cards ahead so it's fully rendered before it's due
  // (hides the on-device generation latency behind dwell time).
  if (untilReward <= REWARD_PREFETCH_AT) void prefetchReward(get, set);
  warmAfter(get);
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
    const raw = await engine.generateReward(topics, get().pagesRead, lang);
    const clean = sanitizeReward(raw);
    // Only accept if still un-shown and valid; otherwise the template covers it.
    if (clean && !get().reward) {
      set({
        rewardPrefetch: {
          text: clean,
          topics: topics.slice(0, 3),
          count: get().pagesRead,
          source: 'llm',
          minutes,
        },
      });
    }
  } catch (e) {
    console.warn('[cards] reward prefetch failed; template will be used', e);
  } finally {
    set({ rewardPrefetching: false });
  }
}
