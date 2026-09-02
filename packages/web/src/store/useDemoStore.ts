import { create } from 'zustand';
import { DEFAULT_GRADE, toGradeLevel, type GradeLevel } from '@/config/grades';
import type { LanguageKey } from '@/config/model';

/**
 * Store for the in-browser "Try the web demo" lightbox.
 *
 * Mirrors the mobile app's first-launch flow (onboarding → cold-start loader → the
 * question-cards feed). The feed itself lives in useCardDemoStore; this store owns the
 * lightbox shell state (phase, language, grade) and the transcript logger.
 *
 * ONBOARDING runs ONCE per browser, like the app's runs once per install: the three
 * answers it collects are written to localStorage under ONBOARDING_KEY and a returning
 * visitor lands straight on the cold-start loader. The loader still plays every time,
 * because on device it is the model actually loading — it is not part of onboarding.
 *
 * Persistence: the queries a visitor types into the feed are logged to `demo_messages`
 * via POST /api/demo/messages (see `persist`, called from useCardDemoStore), keyed by an
 * anonymous session id kept in localStorage. That id survives reloads on the same browser
 * but not across browsers. We keep these transcripts for product insight, not as per-user
 * history — there are no accounts here, and nothing reads them back: with the chat surface
 * removed there is no thread to restore.
 */

export type DemoPhase = 'onboarding' | 'loading' | 'cards';

interface DemoState {
  isOpen: boolean;
  restoring: boolean;
  phase: DemoPhase;
  language: LanguageKey | null;
  /**
   * The student's grade, collected on onboarding page 2 and persisted per browser.
   *
   * HOW FAR IT REACHES, precisely, so nobody has to guess:
   *   1. it WEIGHTS THE DRAWS. demo-cards.json now carries each card's MATATAG competency tag
   *      and the feed runs the app's own `curriculumMultiplier` over it (@hiraia/shared/
   *      curriculum, FEED-WEIGHTING.md) — measured on this subset, a Grade 10 session draws
   *      16.8% of its cards from Grade 10 material against 6.1% unweighted, and a Grade 3
   *      session 28.3% from Grade 3 against 16.6%;
   *   2. it pitches the GENERATED card, through /api/demo/card (which clamps it).
   * What is NOT ported is the phone's seen-decay: that needs a persistent seen-store, and this
   * demo resets on reload. The session's own `seen` set still blocks repeats.
   */
  grade: GradeLevel;

  openDemo: () => void;
  closeDemo: () => void;
  /** Onboarding page 1 — does NOT advance the phase; the carousel owns its own paging. */
  pickLanguage: (language: LanguageKey) => void;
  /**
   * Change the language AFTER onboarding, from inside the feed. Separate from `pickLanguage`
   * because it also rewrites the saved record: onboarding promised "you can change this later"
   * (LANG_REASSURE), and a change that is forgotten on reload does not keep that promise.
   */
  setLanguage: (language: LanguageKey) => void;
  /** Onboarding page 2. */
  pickGrade: (grade: GradeLevel) => void;
  /** The gold Ticket on onboarding page 3: remember the answers and warm the demo up. */
  finishOnboarding: () => void;
  /** Show onboarding again from the top (Settings-style "watch it again"). */
  restartOnboarding: () => void;
  finishLoading: () => void;
}

const DEMO_SESSION_KEY = 'hiraia_demo_session';

/** Stable anonymous id for this browser's demo, created lazily and persisted. */
function getDemoSessionId(): string {
  const fallback = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (typeof window === 'undefined') return 'ssr';
  try {
    let id = localStorage.getItem(DEMO_SESSION_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback();
      localStorage.setItem(DEMO_SESSION_KEY, id);
    }
    return id;
  } catch {
    return fallback();
  }
}

/**
 * What onboarding collected, remembered per browser so a returning visitor is not asked
 * again. localStorage (not a cookie, not the demo_messages table): it is a UI preference of
 * this browser, nothing about it needs to reach the server, and the demo has no accounts to
 * hang it off. Versioned in the key so a future flow with different questions can ignore an
 * old record instead of half-restoring it.
 */
const ONBOARDING_KEY = 'hiraia_demo_onboarding_v1';

interface OnboardingRecord {
  language: LanguageKey;
  grade: GradeLevel;
}

const LANGUAGE_KEYS: LanguageKey[] = ['tagalog', 'english', 'cebuano'];

/** Read the saved onboarding answers, or null if there are none / they are unreadable. */
function readOnboarding(): OnboardingRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingRecord>;
    const language = LANGUAGE_KEYS.find((l) => l === parsed.language);
    const grade = toGradeLevel(parsed.grade);
    // Both or neither: a record missing its language cannot skip the language page, and a
    // half-restore would drop the visitor into a feed in a language they never picked.
    if (!language || !grade) return null;
    return { language, grade };
  } catch {
    return null; // private mode, disabled storage, or a hand-edited value
  }
}

function writeOnboarding(record: OnboardingRecord) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable — the visitor just sees onboarding again next time */
  }
}

function clearOnboarding() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Fire-and-forget: log a message to the demo transcript. Never blocks the UI. */
export function persist(
  role: 'user' | 'assistant',
  content: string,
  language: LanguageKey | null,
  kind?: 'factoid'
) {
  if (typeof window === 'undefined') return;
  void fetch('/api/demo/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: getDemoSessionId(), role, content, kind, language }),
  }).catch(() => {});
}

export const useDemoStore = create<DemoState>((set, get) => ({
  isOpen: false,
  restoring: false,
  phase: 'onboarding',
  language: null,
  grade: DEFAULT_GRADE,

  // Opening the demo is now SYNCHRONOUS. It used to await GET /api/demo/messages to restore
  // this browser's prior chat thread, holding the lightbox on a spinner (`restoring`) while
  // it did. There is no thread to restore any more, so the visitor lands on onboarding or
  // the loader immediately.
  openDemo: () => {
    // Onboarding is first-visit-only. A saved record is this browser's own answers, so the
    // visitor goes straight to the loader with the language and grade they picked.
    const saved = readOnboarding();
    set({
      isOpen: true,
      phase: saved ? 'loading' : 'onboarding',
      language: saved?.language ?? null,
      grade: saved?.grade ?? DEFAULT_GRADE,
    });
  },

  closeDemo: () =>
    set({
      isOpen: false,
      // Reset to the unonboarded shape; the next openDemo re-reads the saved record and
      // decides again, so a visitor who finished onboarding never sees it twice.
      phase: 'onboarding',
      language: null,
    }),

  pickLanguage: (language) => set({ language }),

  setLanguage: (language) => {
    set({ language });
    writeOnboarding({ language, grade: get().grade });
  },

  pickGrade: (grade) => set({ grade }),

  finishOnboarding: () => {
    const { language, grade } = get();
    // No language, no start. This used to fall through to `phase: 'loading'` and simply not
    // write the record, which meant a visitor who reached the Ticket without picking (the
    // pager was swipeable past page 1) ran the whole demo on the `?? 'tagalog'` fallback — a
    // preference they never stated — and was re-onboarded on every subsequent visit, because
    // there was nothing saved to read back. The carousel gates its pager too; this is the
    // backstop, and it is a refusal rather than a silent default.
    if (!language) return;
    writeOnboarding({ language, grade });
    set({ phase: 'loading' });
  },

  restartOnboarding: () => {
    clearOnboarding();
    set({ phase: 'onboarding', language: null, grade: DEFAULT_GRADE });
  },

  finishLoading: () => {
    // The loader hands off to the question-cards feed — the demo's only content surface.
    set({ phase: 'cards' });
  },
}));
