import { create } from 'zustand';
import type { LanguageKey } from '@/config/model';
import { pickFactoidText } from '@/data/factoids';

/**
 * Store for the in-browser "Try the web demo" lightbox.
 *
 * Mirrors the mobile app's first-launch flow (pick language → cold-start loader →
 * chat with an opening trivia card). There's no real model in the web path yet,
 * so replies are a friendly canned placeholder per language.
 *
 * Persistence: every message — visitor questions, our canned replies, and the
 * opening factoid — is logged to `demo_messages` via /api/demo/messages, keyed by
 * an anonymous session id kept in localStorage. That id survives reloads on the
 * same browser (so a returning visitor's thread is restored on reopen) but not
 * across browsers. We keep these transcripts for product insight, not as
 * per-user history — there are no accounts here.
 */

export type DemoPhase = 'language' | 'loading' | 'chat';

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
  messages: DemoMessage[];
  isResponding: boolean;
  /** ids of factoids shown this session, so the opener doesn't repeat itself. */
  shownFactoidIds: string[];

  openDemo: () => void;
  closeDemo: () => void;
  pickLanguage: (language: LanguageKey) => void;
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

/** Fire-and-forget: log a message to the demo transcript. Never blocks the UI. */
function persist(
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

/** Honest, on-brand canned reply per language (no real model in the web demo). */
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
  phase: 'language',
  language: null,
  messages: [],
  isResponding: false,
  shownFactoidIds: [],

  openDemo: async () => {
    set({
      isOpen: true,
      restoring: true,
      phase: 'language',
      language: null,
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

      if (rows.length > 0) {
        const language = [...rows].reverse().find((r) => r.language)?.language as
          | LanguageKey
          | undefined;
        set({
          restoring: false,
          phase: 'chat',
          language: language ?? 'tagalog',
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
      phase: 'language',
      language: null,
      messages: [],
      isResponding: false,
    }),

  pickLanguage: (language) => set({ language, phase: 'loading' }),

  finishLoading: () => {
    set({ phase: 'chat' });
    get().showColdStartFactoid();
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

    set((state) => ({
      isResponding: true,
      messages: [
        ...state.messages,
        { id: userId, role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ],
    }));
    persist('user', trimmed, language);

    // Small "thinking" beat before the reply starts streaming, like the app's
    // cold prompt-eval — then stream the canned response and release the input.
    const reply = CANNED_REPLY[language];
    setTimeout(() => {
      streamInto(set, get, assistantId, reply, () => {
        set({ isResponding: false });
        persist('assistant', reply, language);
      });
    }, 600);
  },
}));
