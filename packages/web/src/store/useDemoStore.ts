import { create } from 'zustand';
import { DEFAULT_GRADE, toGradeLevel, type GradeLevel } from '@/config/grades';
import type { LanguageKey } from '@/config/model';
import { pickFactoidText } from '@/data/factoids';

/**
 * Store for the in-browser "Try the web demo" lightbox.
 *
 * Mirrors the mobile app's first-launch flow (onboarding → cold-start loader → the
 * question-cards feed). The feed itself lives in useCardDemoStore; this store owns the
 * lightbox shell state (phase, language, grade, transcript logging).
 *
 * ONBOARDING runs ONCE per browser, like the app's runs once per install: the three
 * answers it collects are written to localStorage under ONBOARDING_KEY and a returning
 * visitor lands straight on the cold-start loader. The loader still plays every time,
 * because on device it is the model actually loading — it is not part of onboarding.
 *
 * Persistence: typed queries (and any legacy chat messages) are logged to
 * `demo_messages` via /api/demo/messages, keyed by an anonymous session id kept in
 * localStorage. That id survives reloads on the same browser but not across
 * browsers. We keep these transcripts for product insight, not as per-user
 * history — there are no accounts here.
 */

export type DemoPhase = 'onboarding' | 'loading' | 'cards' | 'chat';

export interface DemoMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind?: 'factoid';
  /** true while the text is still streaming in (drives the typing affordance). */
  streaming?: boolean;
}

interface DemoState {
  isOpen: boolean;
  /** true while we fetch any prior transcript for this browser's session. */
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
  messages: DemoMessage[];
  isResponding: boolean;
  /** ids of factoids shown this session, so the opener doesn't repeat itself. */
  shownFactoidIds: string[];

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
  showColdStartFactoid: () => void;
  sendMessage: (text: string) => void;
}

let idCounter = 0;
const nextId = () => `demo-${Date.now()}-${idCounter++}`;

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

/** Stream `fullText` into the message with `id`, char-batches on a ~20ms tick. */
function streamInto(
  set: (fn: (state: DemoState) => Partial<DemoState>) => void,
  get: () => DemoState,
  id: string,
  fullText: string,
  onDone?: () => void
) {
  const speed = 18; // ms per tick
  const charsPerTick = 3;
  let index = 0;

  const tick = () => {
    // Bail out if the lightbox was closed (or this message dropped) mid-stream.
    if (!get().isOpen || !get().messages.some((m) => m.id === id)) return;

    index = Math.min(index + charsPerTick, fullText.length);
    const slice = fullText.slice(0, index);
    const done = index >= fullText.length;

    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: slice, streaming: !done } : m
      ),
    }));

    if (done) {
      onDone?.();
      return;
    }
    setTimeout(tick, speed);
  };

  setTimeout(tick, speed);
}

/** The intent-distilled model reasons in a leading <think>…</think> block, and may end a
 *  reply with an `[image: …]` control token (the phone resolves it to a bundled
 *  illustration — the web demo has no picture retrieval, so we strip it). Show only the
 *  final answer text in the demo (empty while still thinking → the bubble shows its dots). */
function stripThink(s: string): string {
  // 1) drop the reasoning block — show only what follows </think>
  const close = s.indexOf('</think>');
  let out: string;
  if (close >= 0) out = s.slice(close + '</think>'.length).replace(/<think>/g, '');
  else if (s.includes('<think>')) return '';
  else out = s;
  // 2) strip completed [image: …] tokens, then any trailing partial one still streaming
  //    in (so "…[image: a ca" never flashes before its closing bracket arrives)
  out = out.replace(/\[image:[^\]]*\]/gi, '').replace(/\[image:[^\]]*$/i, '');
  return out.replace(/^\s+/, '').replace(/[ \t]+$/, '');
}

/** Fallback preview reply per language, used only if the model backend is unreachable. */
const CANNED_REPLY: Record<LanguageKey, string> = {
  tagalog:
    'Magandang tanong! 🌟 Sa totoong Hiraia app, sasagutin ko ito gamit ang on-device ' +
    'na AI na tumatakbo nang offline mismo sa iyong telepono. Ang web demo na ito ay ' +
    'preview lang ng karanasan — i-download ang app para sa buong tutor na kasama mo ' +
    'kahit walang internet!',
  english:
    "Great question! 🌟 In the real Hiraia app, I'd answer this using the on-device AI " +
    'that runs fully offline right on your phone. This web demo is just a preview of the ' +
    'experience — download the app to get the full tutor, even without internet!',
  cebuano:
    'Maayong pangutana! 🌟 Sa tinuod nga Hiraia app, tubagon nako kini gamit ang on-device ' +
    'nga AI nga modagan offline mismo sa imong telepono. Kini nga web demo usa lang ka ' +
    'preview sa kasinatian — i-download ang app para sa kompleto nga tutor, bisan walay internet!',
};

interface DemoRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  kind?: string | null;
  language?: string | null;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  isOpen: false,
  restoring: false,
  phase: 'onboarding',
  language: null,
  grade: DEFAULT_GRADE,
  messages: [],
  isResponding: false,
  shownFactoidIds: [],

  openDemo: async () => {
    // Onboarding is first-visit-only. A saved record is this browser's own answers, so the
    // visitor goes straight to the loader with the language and grade they picked.
    const saved = readOnboarding();
    set({
      isOpen: true,
      restoring: true,
      phase: saved ? 'loading' : 'onboarding',
      language: saved?.language ?? null,
      grade: saved?.grade ?? DEFAULT_GRADE,
      messages: [],
      isResponding: false,
    });

    // Restore this browser's prior transcript, if any: jump straight into the
    // chat with the saved language so a returning visitor sees their old thread.
    try {
      const sessionId = getDemoSessionId();
      const res = await fetch(`/api/demo/messages?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json().catch(() => ({}));
      const rows = (data.messages ?? []) as DemoRow[];
      if (!get().isOpen) return; // closed while fetching

      // Keep the prior transcript visible. The phase and the language are NOT re-derived
      // from these rows: they are a transcript, not a preference. The old code re-asked for
      // the language on every open precisely because guessing it from old rows hard-
      // defaulted returning visitors to Tagalog; the onboarding record read above is that
      // missing preference, stated by the visitor, so it is the only thing consulted here.
      if (rows.length > 0) {
        set({
          restoring: false,
          messages: rows.map((r) => ({
            id: `db-${r.id}`,
            role: r.role,
            content: r.content,
            kind: r.kind === 'factoid' ? 'factoid' : undefined,
            streaming: false,
          })),
        });
        return;
      }
    } catch {
      /* best-effort restore — fall through to a fresh setup flow */
    }
    set({ restoring: false });
  },

  closeDemo: () =>
    set({
      isOpen: false,
      restoring: false,
      // Reset to the unonboarded shape; the next openDemo re-reads the saved record and
      // decides again, so a visitor who finished onboarding never sees it twice.
      phase: 'onboarding',
      language: null,
      messages: [],
      isResponding: false,
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
    // The loader hands off to the question-cards feed (the gamified home screen),
    // replacing the old canned-chat phase.
    set({ phase: 'cards' });
  },

  showColdStartFactoid: () => {
    const language = get().language ?? 'tagalog';
    const picked = pickFactoidText(language, get().shownFactoidIds);
    if (!picked) return;

    const id = nextId();
    set((state) => ({
      messages: [
        ...state.messages,
        { id, role: 'assistant', content: '', kind: 'factoid', streaming: true },
      ],
      shownFactoidIds: [...state.shownFactoidIds, picked.id].slice(-15),
    }));
    streamInto(set, get, id, picked.text, () =>
      persist('assistant', picked.text, language, 'factoid')
    );
  },

  sendMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isResponding) return;

    const userId = nextId();
    const assistantId = nextId();
    const language = get().language ?? 'tagalog';

    // Short context window of prior real turns (skip the opening factoid + any streaming row).
    const history = get()
      .messages.filter((m) => !m.streaming && m.kind !== 'factoid' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    set((state) => ({
      isResponding: true,
      messages: [
        ...state.messages,
        { id: userId, role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ],
    }));
    persist('user', trimmed, language);

    const finishCanned = () => {
      const reply = CANNED_REPLY[language];
      streamInto(set, get, assistantId, reply, () => {
        set({ isResponding: false });
        persist('assistant', reply, language);
      });
    };

    // Stream the REAL on-device model via the server-side proxy. Falls back to the canned
    // preview if the model backend is unreachable, so the demo never looks broken.
    void (async () => {
      let raw = '';
      try {
        const res = await fetch('/api/demo/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, language, history }),
        });
        if (!res.ok || !res.body) throw new Error('model unavailable');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!get().isOpen) {
            void reader.cancel();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const data = t.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                raw += delta;
                const visible = stripThink(raw);
                set((state) => ({
                  messages: state.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: visible } : m
                  ),
                }));
              }
            } catch {
              /* ignore partial/non-JSON SSE lines */
            }
          }
        }

        const finalText = stripThink(raw).trim();
        if (!finalText) throw new Error('empty reply');
        set((state) => ({
          isResponding: false,
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, content: finalText, streaming: false } : m
          ),
        }));
        persist('assistant', finalText, language);
      } catch {
        finishCanned();
      }
    })();
  },
}));
