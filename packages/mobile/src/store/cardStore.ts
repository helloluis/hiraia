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
  startCard,
  type CardChoice,
  type CardFact,
  type CardQuestion,
} from '../data/cards';
import { getSetting, setSetting } from '../db/repo';
import { useEngineStore } from './engineStore';

const SEEN_CAP = 2500; // persisted seen-set cap (pool is ~3.5k; cycling is fine)
const RECENT_WINDOW = 5; // "ask about something the kid just saw"

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
  /** Monotonic page number — keys the flip + typewriter remounts. */
  pageKey: number;
  pagesRead: number;
  correctCount: number;
  questionsAsked: number;
  seen: Set<string>;
  recent: string[]; // last few factIds (question sourcing)
  untilQuestion: number; // pages left until the next interject
  askedFacts: Set<string>; // don't re-ask the same fact this session

  hydrate: () => Promise<void>;
  choose: (choice: CardChoice) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: () => void;
  /** "Shake to reroll" — teleport to an unrelated fresh topic (escape a deep/stale thread). */
  jumpToRandom: () => void;
}

const nextGap = () => 4 + Math.floor(Math.random() * 2); // every 4-5 pages

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
  pageKey: 0,
  pagesRead: 0,
  correctCount: 0,
  questionsAsked: 0,
  seen: new Set<string>(),
  recent: [],
  untilQuestion: nextGap(),
  askedFacts: new Set<string>(),

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
    set({
      hydrated: true,
      pagesRead,
      correctCount,
      seen,
      current: first,
      choices: nextChoices(first.id, seen, lang),
      recent: [first.id],
      pageKey: 1,
    });
  },

  choose: (choice) => {
    const s = get();
    if (s.question) return; // a question page is up — must answer/continue first

    // Interject due? Ask about a RECENTLY-READ fact (not the one we're heading to)
    // that has an exact MCQ and wasn't asked this session. The kid's choice is stashed
    // and resumed after the answer. If nothing qualifies, defer and retry next page.
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

  jumpToRandom: () => {
    const s = get();
    const lang = useEngineStore.getState().language ?? 'tagalog';
    const dest = jumpCard(s.current?.id ?? null, s.seen);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    const pagesRead = s.pagesRead + 1;
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, lang),
      question: null,
      pending: null,
      questionAnswered: false,
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

/** Advance the walk onto the chosen card (the normal page-turn). */
function advance(choice: CardChoice, set: Set_, get: Get_) {
  const s = get();
  const nextFact = getCard(choice.factId);
  if (!nextFact) return;
  const lang = useEngineStore.getState().language ?? 'tagalog';

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  const pagesRead = s.pagesRead + 1;

  set({
    current: nextFact,
    choices: nextChoices(nextFact.id, seen, lang),
    seen,
    recent,
    pagesRead,
    untilQuestion: s.untilQuestion - 1,
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount, seen });
}
