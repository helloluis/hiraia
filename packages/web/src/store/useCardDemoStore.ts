/**
 * Question-cards feed state — WEB DEMO port of packages/mobile/src/store/cardStore.ts
 * (keep the two in sync). Same deterministic, zero-model walk over the card graph:
 * card → choose deep/lateral → flip → next card, with an MCQ interjected every 4-5
 * pages and a reward recap every 6-10 (jittered). Web differences:
 *
 *  - in-memory only (no SQLite persistence) — counters reset on page reload;
 *  - no on-device model: rewards always use the deterministic template, and a typed
 *    query that misses retrieval shows the honest abstention card (with a note that
 *    the real app answers on-device) after a short "thinking" beat — that beat exists
 *    to demonstrate the app's submit-button→progress affordance;
 *  - typed queries are logged to the demo transcript (same endpoint the old chat demo
 *    used) for product insight;
 *  - actions take `language` as a parameter instead of reading an engine store.
 */
import { create } from 'zustand';

import type { LanguageKey } from '@/config/model';
import {
  getCard,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  type CardChoice,
  type CardFact,
  type CardQuestion,
} from '@/data/cards';
import {
  recentTopics,
  templateReward,
  type RewardContent,
  type ViewLogEntry,
} from '@/data/reward';
import { persist as logDemoMessage } from '@/store/useDemoStore';

const RECENT_WINDOW = 5; // "ask about something the kid just saw"
const VIEWLOG_CAP = 40; // session view-log for the reward recap (topic + timestamp)
const REWARD_MIN_TOPICS = 3; // don't reward until there's something to celebrate
const ASK_BEAT_MS = 750; // simulated "thinking" so the progress affordance reads

/**
 * A search result that isn't a straight card navigation. On web this is always an
 * honest abstention (there's no model to generate); the 'generated' shape is kept to
 * stay structurally aligned with the mobile store.
 */
export interface FeedResponse {
  query: string;
  kind: 'generated' | 'abstain';
  text: string | null; // generated answer (already localized) — never set on web
  suggestion: string | null; // topic label of the nearest card, for the abstention path
}

interface CardDemoState {
  hydrated: boolean;
  /** Current card on the pad (null until hydrate). */
  current: CardFact | null;
  choices: CardChoice[];
  /** Interject question page — when set, it replaces the card content this page. */
  question: CardQuestion | null;
  /** The choice that was intercepted by the question/reward (resumed on continue). */
  pending: CardChoice | null;
  /** True once the interject question has been answered (gates continue). */
  questionAnswered: boolean;
  /** Interject REWARD page — periodic "you've learned a lot!" recap. */
  reward: RewardContent | null;
  /** Search RESPONSE page — an abstention (see FeedResponse). */
  response: FeedResponse | null;
  /** True during the (simulated) "thinking" beat before an abstention page. */
  asking: boolean;
  /** Card to land on when the visitor continues past the response page. */
  responseAnchorId: string | null;
  /** "You asked: X" ribbon shown when a search navigated straight to a found card. */
  queryBanner: string | null;
  /** Monotonic page number — keys the flip + typewriter remounts. */
  pageKey: number;
  pagesRead: number;
  correctCount: number;
  questionsAsked: number;
  seen: Set<string>;
  recent: string[]; // last few factIds (question sourcing)
  viewLog: ViewLogEntry[]; // {factId, topic, ts} for the reward recap window
  untilQuestion: number; // pages left until the next interject question
  /** Cards walked since a branch was last OFFERED — drives single-path vs fork. */
  threadDepth: number;
  untilReward: number; // pages left until the next reward card (jittered)
  askedFacts: Set<string>; // don't re-ask the same fact this session

  hydrate: (language: LanguageKey) => void;
  /** Re-bake the (language-bound) choice labels after a language switch. */
  relocale: (language: LanguageKey) => void;
  choose: (choice: CardChoice, language: LanguageKey) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: (language: LanguageKey) => void;
  continueAfterReward: (language: LanguageKey) => void;
  /** Visitor typed a query: retrieval hit → found card; miss → abstention page. */
  ask: (query: string, language: LanguageKey) => void;
  continueAfterResponse: (language: LanguageKey) => void;
  /** "Reroll" — teleport to an unrelated fresh topic (escape a deep/stale thread). */
  jumpToRandom: (language: LanguageKey) => void;
}

const nextGap = () => 4 + Math.floor(Math.random() * 2); // question: every 4-5 pages
// reward: jittered so it lands as a dopamine hit, never on a fixed beat. Matches the
// mobile store's current testing value (6-10 pages); ship value is 15-25.
const nextRewardGap = () => 6 + Math.floor(Math.random() * 5);

export const useCardDemoStore = create<CardDemoState>()((set, get) => ({
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
  threadDepth: 0,
  untilReward: nextRewardGap(),
  askedFacts: new Set<string>(),

  hydrate: (language) => {
    if (get().hydrated) return;
    const first = startCard(new Set());
    const seen = new Set([first.id]);
    set({
      hydrated: true,
      seen,
      current: first,
      choices: nextChoices(first.id, seen, language, { threadDepth: 0 }),
      threadDepth: 0,
      recent: [first.id],
      viewLog: [{ factId: first.id, topic: first.topic, ts: Date.now() }],
      pageKey: 1,
    });
  },

  relocale: (language) => {
    const s = get();
    if (!s.hydrated || !s.current) return;
    set({ choices: nextChoices(s.current.id, s.seen, language, { threadDepth: s.threadDepth }) });
  },

  choose: (choice, language) => {
    const s = get();
    if (s.question || s.reward || s.response || s.asking) return; // an interject/ask is up

    // REWARD due? (jittered, needs enough distinct topics.) Rarer than the quiz, so
    // check it first; it intercepts the flip and resumes the choice after.
    if (s.untilReward <= 1 && recentTopics(s.viewLog).length >= REWARD_MIN_TOPICS) {
      const topics = recentTopics(s.viewLog);
      const minutes = Math.max(1, Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000));
      set({
        reward: templateReward(topics, s.pagesRead, minutes, language),
        pending: choice,
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
    advance(choice, set, get, language);
  },

  answerQuestion: (correct) => {
    const s = get();
    set({ correctCount: s.correctCount + (correct ? 1 : 0), questionAnswered: true });
  },

  continueAfterQuestion: (language) => {
    const s = get();
    if (!s.pending) return;
    const pending = s.pending;
    set({ question: null, pending: null, questionAnswered: false });
    advance(pending, set, get, language);
  },

  continueAfterReward: (language) => {
    const s = get();
    const pending = s.pending;
    set({ reward: null, pending: null });
    if (pending) advance(pending, set, get, language);
  },

  ask: (query, language) => {
    const q = query.trim();
    const s = get();
    if (!q || s.asking) return;

    // Retrieval-first: a confident local match navigates straight to that card (instant,
    // zero-model), with a "you asked" banner. The card becomes the new feed anchor.
    const res = searchCards(q, s.current?.id ?? null);
    logDemoMessage('user', q, language);
    if (res.best) {
      navigateTo(res.best, set, get, language, q);
      return;
    }

    // Miss: show the thinking affordance briefly, then the honest abstention card with
    // the nearest topic as a soft landing. (The real app would ask the warm on-device
    // model here; the browser demo has none.)
    const suggestion = res.suggestion;
    const anchorId = suggestion?.id ?? null;
    const fromPage = s.pageKey;
    set({ asking: true });
    setTimeout(() => {
      const cur = get();
      if (!cur.asking || cur.pageKey !== fromPage) return; // visitor moved on meanwhile
      set({
        asking: false,
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
        pageKey: cur.pageKey + 1,
      });
    }, ASK_BEAT_MS);
  },

  continueAfterResponse: (language) => {
    const s = get();
    const dest = (s.responseAnchorId && getCard(s.responseAnchorId)) || null;
    set({ response: null, responseAnchorId: null });
    if (dest) {
      navigateTo(dest, set, get, language);
    } else {
      navigateTo(jumpCard(s.current?.id ?? null, s.seen), set, get, language);
    }
  },

  jumpToRandom: (language) => {
    const s = get();
    const dest = jumpCard(s.current?.id ?? null, s.seen);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, language, { threadDepth: 0 }),
      threadDepth: 0, // the reroll already switched topic
      question: null,
      pending: null,
      questionAnswered: false,
      response: null,
      queryBanner: null,
      seen,
      recent: [dest.id], // fresh trail — the jump is a hard topic switch
      pagesRead: s.pagesRead + 1,
      untilQuestion: nextGap(), // don't interject right after a jump
      pageKey: s.pageKey + 1,
    });
  },
}));

type Set_ = (partial: Partial<CardDemoState>) => void;
type Get_ = () => CardDemoState;

/**
 * Navigate to an explicit card (from a search hit or a response-continue). Records it
 * like a normal page turn, sets an optional "you asked" banner, and resets the
 * question counter so an interject doesn't fire on the very page after a topic jump.
 */
function navigateTo(fact: CardFact, set: Set_, get: Get_, language: LanguageKey, banner?: string) {
  const s = get();
  const seen = new Set(s.seen);
  seen.add(fact.id);
  const recent = [...s.recent, fact.id].slice(-RECENT_WINDOW);
  const viewLog = [...s.viewLog, { factId: fact.id, topic: fact.topic, ts: Date.now() }].slice(-VIEWLOG_CAP);
  set({
    current: fact,
    choices: nextChoices(fact.id, seen, language, { threadDepth: 0 }),
    threadDepth: 0, // a search/topic jump starts a new thread
    seen,
    recent,
    viewLog,
    pagesRead: s.pagesRead + 1,
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
}

/** Advance the walk onto the chosen card (the normal page-turn). */
function advance(choice: CardChoice, set: Set_, get: Get_, language: LanguageKey) {
  const s = get();
  const nextFact = getCard(choice.factId);
  if (!nextFact) return;

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  const viewLog = [...s.viewLog, { factId: nextFact.id, topic: nextFact.topic, ts: Date.now() }].slice(-VIEWLOG_CAP);

  // Taking the lateral fork is itself a topic switch, so it restarts the thread.
  const depth = choice.kind === 'lateral' ? 0 : s.threadDepth + 1;
  const choices = nextChoices(nextFact.id, seen, language, { threadDepth: depth });

  set({
    current: nextFact,
    choices,
    threadDepth: choices.length > 1 ? 0 : depth,
    seen,
    recent,
    viewLog,
    pagesRead: s.pagesRead + 1,
    untilQuestion: s.untilQuestion - 1,
    untilReward: s.untilReward - 1,
    queryBanner: null, // a normal page-turn clears any lingering search banner
    pageKey: s.pageKey + 1,
  });
}
