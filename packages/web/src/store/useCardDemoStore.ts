/**
 * Question-cards feed state — WEB DEMO port of packages/mobile/src/store/cardStore.ts
 * (keep the two in sync). Same deterministic, zero-model walk over the card graph:
 * card → choose deep/lateral → flip → next card, with an MCQ interjected every 4-5
 * pages and a reward recap every 6-10 (jittered). Web differences:
 *
 *  - in-memory only (no SQLite persistence) — counters reset on page reload;
 *  - rewards always use the deterministic template (no local model to write one);
 *  - a typed query that misses the local card search is answered for REAL, by the same
 *    grounded path the phone runs — only the model lives on the VPS instead of in the
 *    handset. POST /api/demo/card retrieves from the full fact bank, classifies the query
 *    three ways (fact card / in-domain gap / off-domain) on the shared `isOffDomain` gate,
 *    and prints a card from the shared card prompt. The "thinking" beat is therefore real
 *    work now, not a simulated one;
 *  - typed queries AND the cards printed in answer are logged to the demo transcript (same
 *    endpoint the old chat demo used) for product insight;
 *  - actions take `language` (and, for the card path, `grade`) as parameters instead of
 *    reading an engine store;
 *  - the grade onboarding collected weights the DRAWS as well as the answer: `hydrate` builds
 *    a `feedWeigher` for it and every unforced pick (entry card, reroll, lateral fork) goes
 *    through it. The seen-decay half of the phone's rule is not ported — a demo that resets on
 *    reload has no seen-store to persist into.
 */
import { create } from 'zustand';

import { DEFAULT_GRADE, type GradeLevel } from '@/config/grades';
import type { LanguageKey } from '@/config/model';
import {
  choiceLabel,
  feedWeigher,
  getCard,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  type CardChoice,
  type CardFact,
  type CardQuestion,
  type FeedWeigher,
} from '@/data/cards';
import {
  recentTopics,
  templateReward,
  type RewardContent,
  type ViewLogEntry,
} from '@/data/reward';
import { persist as logDemoMessage } from '@/store/useDemoStore';

// The trail: what the reader just saw. Two jobs — sourcing the interject question ("ask
// about something the kid just saw") and feeding nextChoices' illustration/category
// cooldowns, which is why it is exactly SLUG_COOLDOWN long in cards.ts.
const RECENT_WINDOW = 5;

/**
 * How long the browser waits for /api/demo/card before printing the honest gap card instead.
 *
 * The route has its own 25 s ceiling on the generation, but that only bounds a SLOW answer —
 * it cannot bound a stalled socket (a VPS blip, a phone handing off between wifi and cell),
 * and while `asking` is true the input is disabled and every page turn is refused, so an
 * unbounded fetch wedges the whole feed until the visitor reloads the page. 12 s is inside a
 * child's patience and well under the route's own timeout, and the existing catch already
 * downgrades an abort to the gap card, so a timeout needs no branch of its own.
 */
const ASK_TIMEOUT_MS = 12_000;
const VIEWLOG_CAP = 40; // session view-log for the reward recap (topic + timestamp)
const REWARD_MIN_TOPICS = 3; // don't reward until there's something to celebrate

/**
 * A search result that isn't a straight card navigation — one of the three shapes the feed
 * can print in answer to a typed question. Same three the phone has (cardStore.FeedResponse):
 *
 *   generated — a grounded fact card written from the full bank;
 *   abstain   — an in-domain GAP ("no page about that yet"), offering the nearest DEMO-SUBSET
 *               topic as a soft landing. The suggestion comes from the local card search that
 *               already ran, not from the server: it has to be a card this demo can actually
 *               navigate to;
 *   offdomain — the query wasn't science. NO suggestion, by design — offering a science topic
 *               in answer to "roblox" is the behaviour this shape exists to remove.
 */
export interface FeedResponse {
  query: string;
  kind: 'generated' | 'abstain' | 'offdomain';
  text: string | null; // the printed card — set on 'generated' only
  /** Localized label of the nearest DEMO-SUBSET card; never set on 'offdomain'. */
  suggestion: string | null;
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
  /** The student's grade, as the feed is currently weighted for it. */
  grade: GradeLevel;
  /**
   * Curriculum draw weights for `grade` (data/cards.ts feedWeigher). Held here rather than
   * threaded through every action: it depends only on the grade and today's date, so it is
   * built once per session and passed to every unforced draw.
   */
  weights: FeedWeigher | null;

  hydrate: (language: LanguageKey, grade?: GradeLevel) => void;
  /** Re-bake the (language-bound) choice labels after a language switch. */
  relocale: (language: LanguageKey) => void;
  choose: (choice: CardChoice, language: LanguageKey) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: (language: LanguageKey) => void;
  continueAfterReward: (language: LanguageKey) => void;
  /**
   * Visitor typed a query. Retrieval hit in the bundled subset → navigate straight to that
   * card (instant, zero-model). Miss → ask the server for a real card: /api/demo/card.
   * `grade` pitches the generated card (onboarding's grade slide).
   */
  ask: (query: string, language: LanguageKey, grade?: number) => Promise<void>;
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
  grade: DEFAULT_GRADE,
  weights: null,

  hydrate: (language, grade = DEFAULT_GRADE) => {
    const prev = get();
    if (prev.hydrated) {
      // Already walking. A visitor who reopened onboarding and picked a DIFFERENT grade gets
      // the new weights from here on; the pages already read are not rewritten.
      if (prev.grade !== grade) set({ grade, weights: feedWeigher(grade) });
      return;
    }
    const weights = feedWeigher(grade);
    const first = startCard(new Set(), weights);
    const seen = new Set([first.id]);
    set({
      hydrated: true,
      grade,
      weights,
      seen,
      current: first,
      choices: nextChoices(first.id, seen, language, { threadDepth: 0, recentIds: [first.id], weights }),
      threadDepth: 0,
      recent: [first.id],
      viewLog: [{ factId: first.id, topic: first.topic, ts: Date.now() }],
      pageKey: 1,
    });
  },

  relocale: (language) => {
    const s = get();
    if (!s.hydrated || !s.current) return;
    set({
      choices: nextChoices(s.current.id, s.seen, language, {
        threadDepth: s.threadDepth,
        recentIds: s.recent,
        weights: s.weights ?? undefined,
      }),
    });
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

  ask: async (query, language, grade) => {
    const q = query.trim();
    const s = get();
    if (!q || s.asking) return;

    // Retrieval-first: a confident local match navigates straight to that card (instant,
    // zero-model), with a "you asked" banner. The card becomes the new feed anchor. This is
    // the common case and it never leaves the browser.
    const res = searchCards(q, s.current?.id ?? null);
    logDemoMessage('user', q, language);
    if (res.best) {
      navigateTo(res.best, set, get, language, q);
      return;
    }

    // Miss → ask the server for a real card. The demo ships ~5% of the deck, so a miss here is
    // usually a card that exists in the full app and not in this subset; the route retrieves
    // from the WHOLE fact bank, which is why it can answer questions this pool cannot.
    const suggestion = res.suggestion;
    const fromPage = s.pageKey;
    set({ asking: true });

    let kind: FeedResponse['kind'] = 'abstain';
    let text: string | null = null;
    try {
      const r = await fetch('/api/demo/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, language, grade }),
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
      if (r.ok) {
        const data = (await r.json()) as { kind?: string; text?: string | null };
        if (data.kind === 'generated' && data.text) {
          kind = 'generated';
          text = data.text;
        } else if (data.kind === 'offdomain') {
          kind = 'offdomain';
        }
      }
    } catch {
      // Network/route down → the honest gap card. A typed question always gets a page.
    }

    // The visitor may have turned the page (or asked again) while this was in flight; if so
    // the answer is stale and printing it would yank them off whatever they are now reading.
    const cur = get();
    if (!cur.asking || cur.pageKey !== fromPage) {
      set({ asking: false }); // clear the veil either way — nothing else can be in flight
      return;
    }

    if (text) logDemoMessage('assistant', text, language);

    // Off-domain gets NO nearest topic and NO anchor: the continue ticket resumes the ordinary
    // walk instead of landing on whichever science card happened to sit closest to a question
    // about a video game.
    const offDomain = kind === 'offdomain';
    set({
      asking: false,
      question: null,
      reward: null,
      queryBanner: null,
      response: {
        query: q,
        kind,
        text,
        // `topic` is the card's untranslated English slug-phrase — printing it raw ended every
        // Tagalog gap card on an English fragment ("Pero subukan natin ito: how geckos blend
        // in"). choiceLabel is the localizer every other choice in the feed already goes
        // through. Mirrored in packages/mobile/src/store/cardStore.ts — keep the two in sync.
        suggestion: offDomain || !suggestion ? null : choiceLabel(suggestion, language),
      },
      responseAnchorId: offDomain ? null : (suggestion?.id ?? null),
      pageKey: cur.pageKey + 1,
    });
  },

  continueAfterResponse: (language) => {
    const s = get();
    const dest = (s.responseAnchorId && getCard(s.responseAnchorId)) || null;
    set({ response: null, responseAnchorId: null });
    if (dest) {
      navigateTo(dest, set, get, language);
    } else {
      navigateTo(jumpCard(s.current?.id ?? null, s.seen, s.weights ?? undefined), set, get, language);
    }
  },

  jumpToRandom: (language) => {
    const s = get();
    // Gated on `asking` exactly as `choose` is: the reroll turned the page out from under an
    // answer that was still in flight, leaving the thinking veil and the disabled input stuck
    // over a card the visitor never asked about.
    if (s.asking) return;
    const dest = jumpCard(s.current?.id ?? null, s.seen, s.weights ?? undefined);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, language, {
        threadDepth: 0,
        recentIds: [dest.id],
        weights: s.weights ?? undefined,
      }),
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
    choices: nextChoices(fact.id, seen, language, {
      threadDepth: 0,
      recentIds: recent,
      weights: s.weights ?? undefined,
    }),
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
  const choices = nextChoices(nextFact.id, seen, language, {
    threadDepth: depth,
    recentIds: recent,
    weights: s.weights ?? undefined,
  });

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
