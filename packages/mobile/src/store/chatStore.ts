import { create } from 'zustand';

import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '@hiraia/shared';
import type { Message, RagResult } from '@hiraia/shared';

import { pickFactoidText } from '../data/factoids';
import { genId } from '../db';
import { FACT_IMAGE } from '../generated/factImage';
import {
  addMessage,
  createConversation,
  getCompactions,
  getMessages,
  getLatestConversationId,
  getSetting,
  saveCompaction,
  setConversationTitle,
  setSetting,
} from '../db/repo';
import { useEngineStore } from './engineStore';

interface ChatState {
  conversationId: string | null;
  messages: Message[];
  isStreaming: boolean;
  currentStreamingContent: string;
  hasHydrated: boolean;
  lastFactoidIds: string[];
  hydrate: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  showColdStartFactoid: () => void;
  clearMessages: () => Promise<void>;
}

const isFactoid = (m: Message) => m.metadata?.kind === 'factoid';
/** Real conversation turns carry a stable id; transient UI messages (cold-start
 *  factoid, wait/error notices) do not — so this both gates persistence and keeps
 *  them out of the model's context. */
const isRealTurn = (m: Message) => !!m.id && !isFactoid(m);

// Facts already shown this conversation — RagStore demotes them so a kid asking
// "ano pa?" keeps getting FRESH facts instead of the same top-3. Reset on a new
// thread (clearMessages) and on hydrate (no per-fact history is persisted).
let shownFactIds = new Set<string>();

// The tutor's abstain/redirect phrasings (TL/BIS/EN). When the answer matches, the
// grounding wasn't really relevant, so we DON'T attach its illustration.
const ABSTAIN_RE =
  /hindi.{0,20}(alam|sigurado|tiyak|maintind|naintind|kahibal|sayod)|ayaw kong manghula|pasensya|paumanhin|wala.{0,12}(sapat|impormasyon|akong)|dili.{0,12}(sigurado|kahibalo)|i'?m not sure|i (do|don'?t) (not )?know/i;

// The QVAC model is single-instance (one generation at a time). Serialize chat()
// and summarize() so the compacter never overlaps a response.
let modelLock: Promise<unknown> = Promise.resolve();
function withModelLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = modelLock.then(fn, fn);
  modelLock = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// Auto-compaction is OFF (2026-06-07). It runs a SECOND background LLM completion
// (summarize) after every reply, which on a ~4 tok/s phone competes for the GPU and
// can block the next turn (shared model lock) — net-negative for on-device latency,
// and our replies are short enough that summarizing older turns buys little. Disabled
// to ISOLATE the prefill perf work; the windowed history (KEEP_FULL) still bounds the
// prompt. The adapter still ships summarize capability (26 SFT rows) so we can re-enable
// it later (e.g. gated on device tok/s). Probe: finetuning/eval/harness/probe-compaction.mts.
const COMPACTION_ENABLED = false;

const KEEP_FULL = 6; // last 3 exchanges sent verbatim
const MAX_LOOKBACK = 30; // cap turns considered (older ones use compactions when present)

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  currentStreamingContent: '',
  hasHydrated: false,
  lastFactoidIds: [],

  // Load the latest conversation (or start one) from SQLite.
  hydrate: async () => {
    try {
      let convId = await getLatestConversationId();
      if (!convId) {
        convId = genId();
        await createConversation(convId);
      }
      const messages = await getMessages(convId);
      const lastFactoidIds = JSON.parse((await getSetting('lastFactoidIds')) ?? '[]');
      shownFactIds = new Set();
      set({ conversationId: convId, messages, lastFactoidIds, hasHydrated: true });
    } catch (e) {
      console.error('[chatStore] hydrate failed:', e);
      set({ hasHydrated: true });
    }
  },

  sendMessage: async (content: string) => {
    const { engine, language } = useEngineStore.getState();
    const lang = language ?? 'tagalog';
    let convId = get().conversationId;
    if (!convId) {
      convId = genId();
      await createConversation(convId);
      set({ conversationId: convId });
    }

    // Always show the user's message immediately — never drop it silently.
    const userMessage: Message = { id: genId(), role: 'user', content, timestamp: new Date() };
    set((state) => ({ messages: [...state.messages, userMessage] }));
    await addMessage(convId, userMessage);
    // Name the thread from the first question.
    if (get().messages.filter(isRealTurn).length === 1) {
      await setConversationTitle(convId, content.slice(0, 60));
    }

    // The model takes ~20-30s to load on first launch. If it isn't ready, ask the
    // user to wait (transient message — no id, not persisted, not in context).
    if (!engine || !engine.isReady()) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: 'Sandali lang—inihahanda ko pa ang AI. Pakisubukang muli sa ilang segundo. 🐱',
            timestamp: new Date(),
          },
        ],
      }));
      return;
    }

    set({ isStreaming: true, currentStreamingContent: '' });

    try {
      // Ground the model on the curated facts (it confabulates without grounding).
      // Pass the previous 1-2 real turns as low-weight context so a short follow-up
      // ("Dahil sa asteroid?") retrieves on the conversation's topic, not the bare
      // keyword (which would pull e.g. the asteroid BELT instead of the impact).
      const priorTurns = get().messages.filter(isRealTurn).slice(-3, -1);
      const ragContext = priorTurns.map((m) => m.content).join(' ');
      let grounding: RagResult[] = [];
      try {
        grounding = await engine.ragSearch(content, 3, ragContext, shownFactIds);
        // remember what we showed so the next turn prefers fresh facts
        for (const g of grounding) {
          const id = (g.metadata as { id?: string } | undefined)?.id;
          if (id) shownFactIds.add(id);
        }
      } catch (ragError) {
        console.warn('RAG search failed; answering ungrounded:', ragError);
      }
      // Retrieval-driven illustration: ONLY the TOP grounded fact's image — the fact the
      // answer is actually built on. Previously we scanned the whole top-3 for ANY fact
      // with an image, which let an unrelated lower-ranked fact's picture attach to a
      // different answer (e.g. a seismic-waves diagram on a "pinakamalaking buto" reply,
      // a biomolecules chart on a DNA-vs-RNA reply). Better to show no picture than a
      // mismatched one. Suppressed below when the model abstained.
      const topFid = (grounding[0]?.metadata as { id?: string } | undefined)?.id;
      const imageSlug: string | undefined = topFid ? FACT_IMAGE[topFid] : undefined;
      // Active language + grade 5 + imageTags=true — parity with how the grounded
      // adapter was trained. RAG retrieval is scoped to the same language.
      // The system prompt is STATIC (no grounding) so QVAC's system-prompt KV cache
      // (keyed by a hash of the system message) stays warm across turns — the grounding
      // moves into the current user turn instead (see composeGroundedUserTurn). This is
      // the TTFT fix: only the new turn re-prefills, not the whole ~1500-token prompt.
      const systemPrompt = generateSystemPrompt(lang, 5, true);
      const groundingBlock = formatGroundingBlock(grounding);

      const conversationMessages = await buildContext(get().messages, systemPrompt);
      // Inject the grounding into the CURRENT (last) user turn, matching training.
      if (groundingBlock) {
        for (let i = conversationMessages.length - 1; i >= 0; i--) {
          if (conversationMessages[i].role === 'user') {
            conversationMessages[i] = {
              ...conversationMessages[i],
              content: composeGroundedUserTurn(groundingBlock, conversationMessages[i].content),
            };
            break;
          }
        }
      }

      let fullResponse = '';
      await withModelLock(async () => {
        // Pass the conversation id as the KV-cache key so QVAC caches the static system
        // prompt (+ prior turns) and only the new turn re-prefills — the TTFT fix.
        for await (const token of engine.chat(conversationMessages, convId)) {
          fullResponse += token;
          set({ currentStreamingContent: fullResponse });
        }
      });

      // Suppress the illustration when the tutor abstained/redirected — the grounding
      // wasn't actually relevant (e.g. a song question that coincidentally retrieved a
      // body-diagram fact), so showing its picture is the "weird unrelated image" bug.
      const abstained = ABSTAIN_RE.test(fullResponse);
      const finalImageSlug = abstained ? undefined : imageSlug;

      const assistantMessage: Message = {
        id: genId(),
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
        ...(finalImageSlug ? { imageSlug: finalImageSlug } : {}),
      };
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isStreaming: false,
        currentStreamingContent: '',
      }));
      await addMessage(convId, assistantMessage);
      // Auto-compact this answer in the background (best-effort; serialized).
      void compactInBackground(assistantMessage);
    } catch (error) {
      console.error('Error during chat:', error);
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'assistant', content: 'Paumanhin, may naganap na error. Pakisubukang muli. 🐱', timestamp: new Date() },
        ],
        isStreaming: false,
        currentStreamingContent: '',
      }));
    }
  },

  // Pre-written "Alam mo ba na…?" card shown while the model warms up. Transient
  // (no id) — not persisted, not sent to the model.
  showColdStartFactoid: () => {
    const lastIds = get().lastFactoidIds;
    const picked = pickFactoidText('tagalog', lastIds);
    if (!picked) return;

    set((state) => ({
      messages: [...state.messages, { role: 'assistant', content: '', timestamp: new Date(), metadata: { kind: 'factoid' } }],
    }));

    // Deliberate single-char typewriter so it's clearly animated. The factoid plays
    // while the model warms up (~20-30s), so a slow type-on is well within budget.
    // ~1 char / 26ms ≈ 38 chars/sec → a typical factoid types on over ~4-7s.
    const CHARS_PER_TICK = 1;
    const TICK_MS = 26;
    let currentText = '';
    let index = 0;
    const fullText = picked.text;
    const tick = () => {
      if (index >= fullText.length) {
        const nextHistory = [...lastIds, picked.id].slice(-15);
        set({ lastFactoidIds: nextHistory });
        void setSetting('lastFactoidIds', JSON.stringify(nextHistory));
        return;
      }
      currentText += fullText.slice(index, index + CHARS_PER_TICK);
      index += CHARS_PER_TICK;
      set((state) => {
        const updated = [...state.messages];
        const last = updated[updated.length - 1];
        if (last) updated[updated.length - 1] = { ...last, content: currentText };
        return { messages: updated };
      });
      setTimeout(tick, TICK_MS);
    };
    setTimeout(tick, TICK_MS);
  },

  // Start a fresh thread.
  clearMessages: async () => {
    const convId = genId();
    await createConversation(convId);
    shownFactIds = new Set();
    set({ conversationId: convId, messages: [], isStreaming: false, currentStreamingContent: '' });
  },
}));

/**
 * Build the model context: real turns only, the last KEEP_FULL verbatim. Older
 * turns are included ONLY as their compaction (summary) when one exists; an older
 * turn with no compaction is DROPPED rather than sent in full. This keeps the
 * prompt bounded — sending many full older turns is exactly what overflowed the
 * 4096 ctx before. With compaction disabled (no summaries exist) this degrades to
 * a safe sliding window of the last KEEP_FULL turns. As summaries accumulate
 * (future adapter), effective lookback extends without growing the token cost.
 */
async function buildContext(allMessages: Message[], systemPrompt: string): Promise<Message[]> {
  const real = allMessages.filter(isRealTurn);
  const window = real.slice(-MAX_LOOKBACK);
  const splitAt = Math.max(0, window.length - KEEP_FULL);
  const older = window.slice(0, splitAt);
  const recent = window.slice(splitAt);

  const olderAsstIds = older.filter((m) => m.role === 'assistant').map((m) => m.id!);
  const comp = await getCompactions(olderAsstIds);
  // Keep an older assistant turn only as its compaction (summary); keep the user
  // turn that precedes a compacted answer so role-alternation stays intact. Drop
  // everything else older than the verbatim window to bound the prompt. (With
  // compaction disabled there are no summaries, so older turns are all dropped.)
  const olderMapped = older.flatMap((m, i) => {
    if (m.role === 'assistant' && comp.has(m.id!)) return [{ ...m, content: comp.get(m.id!)! }];
    const next = older[i + 1];
    if (m.role === 'user' && next?.role === 'assistant' && comp.has(next.id!)) return [m];
    return [];
  });

  return [{ role: 'system', content: systemPrompt }, ...olderMapped, ...recent];
}

/** Summarize an assistant answer and store it, so future turns cost fewer tokens. */
async function compactInBackground(msg: Message): Promise<void> {
  if (!COMPACTION_ENABLED) return; // disabled until a summarization-capable adapter ships
  if (!msg.id || isFactoid(msg) || msg.content.length < 240) return; // short answers aren't worth it
  const { engine } = useEngineStore.getState();
  if (!engine?.summarize) return;
  try {
    const summary = await withModelLock(() => engine.summarize!(msg.content));
    if (summary && summary.length < msg.content.length * 0.9) {
      await saveCompaction(msg.id, summary);
    }
  } catch (e) {
    // best-effort: leave uncompacted (sent full until a later attempt compacts it)
  }
}
