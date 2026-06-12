import { create } from 'zustand';
import type { LanguageKey } from '@/config/model';
import { pickFactoidText } from '@/data/factoids';

/**
 * Ephemeral store for the in-browser "Try the web demo" lightbox.
 *
 * Deliberately self-contained and *memory-only*: unlike the authenticated
 * `useChatStore`, NOTHING here is persisted or sent to our servers — the
 * messages a visitor types and the (canned) replies we show never touch the
 * central DB. Closing the lightbox wipes the conversation. The demo mirrors the
 * mobile app's first-launch flow (pick language → cold-start loader → chat with
 * an opening trivia card) but does not run a real model: replies are a friendly
 * canned placeholder until the on-device LLM is wired into the web path.
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

export const useDemoStore = create<DemoState>((set, get) => ({
  isOpen: false,
  phase: 'language',
  language: null,
  messages: [],
  isResponding: false,
  shownFactoidIds: [],

  openDemo: () =>
    set({ isOpen: true, phase: 'language', language: null, messages: [], isResponding: false }),

  closeDemo: () =>
    set({ isOpen: false, phase: 'language', language: null, messages: [], isResponding: false }),

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
    streamInto(set, get, id, picked.text);
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

    // Small "thinking" beat before the reply starts streaming, like the app's
    // cold prompt-eval — then stream the canned response and release the input.
    setTimeout(() => {
      streamInto(set, get, assistantId, CANNED_REPLY[language], () => set({ isResponding: false }));
    }, 600);
  },
}));
