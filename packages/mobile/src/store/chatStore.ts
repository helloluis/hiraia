import { create } from 'zustand';

import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '@hiraia/shared';
import type { Message, RagResult } from '@hiraia/shared';

import { uiStrings } from '../config/strings';
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
  // Cosmetic per-turn narration shown BEFORE the first token (retrieval → prefill).
  // UI-only: never added to messages/history, so it costs zero tokens.
  thinkingStatus: string;
  hasHydrated: boolean;
  lastFactoidIds: string[];
  lastFactoidAt: number;
  hydrate: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  showColdStartFactoid: () => Promise<void>;
  clearMessages: () => Promise<void>;
  /** Load a past conversation (from the sidebar history) and make it active. */
  switchConversation: (id: string) => Promise<void>;
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

// Illustrations already shown this conversation. The system prompt's "don't
// re-show a recent image" line is a soft nudge only — the hard guarantee lives
// here (TAGGED-DATASET.md): a tag resolving to an already-shown slug is
// suppressed (token is stripped anyway, the student just sees clean text).
let shownImageSlugs = new Set<string>();

// First `[image: <desc>]` control token the tutor emitted in an answer.
const IMAGE_TAG_RE = /\[image:\s*([^\]]+?)\s*\]/i;

// Confidence floor for the RETRIEVAL-DRIVEN illustration (top grounded FACT's text →
// an image), separate from LocalEngine's stricter model-tag floor (0.70). The fact text
// is often Tagalog vs the English image descriptions (cross-lingual LaBSE → lower
// cosines), so this bar is lower. Tuned on-device from the logged resolveImageTag
// cosines — conservative to start (better no picture than a wrong one).
const RETRIEVAL_IMAGE_FLOOR = 0.55;

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

// A factoid is session context the kid is reading/being influenced by — not a
// throwaway splash. Don't re-roll one that's already on screen / was shown less
// than this ago (e.g. on a background→resume that re-mounts the screen).
const FACTOID_TTL_MS = 60 * 60 * 1000; // 1 hour

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  currentStreamingContent: '',
  thinkingStatus: '',
  hasHydrated: false,
  lastFactoidIds: [],
  lastFactoidAt: 0,

  // Load the latest conversation (or start one) from SQLite.
  hydrate: async () => {
    // Idempotent: a background→resume can re-mount the tree and re-fire this; if we
    // already hydrated, DON'T reload — that would clobber live (e.g. mid-stream) state
    // and momentarily blank the just-sent question. The store is a singleton, so the
    // first hydrate's result is still here.
    if (get().hasHydrated) return;
    try {
      let convId = await getLatestConversationId();
      if (!convId) {
        convId = genId();
        await createConversation(convId);
      }
      const messages = await getMessages(convId);
      const lastFactoidIds = JSON.parse((await getSetting('lastFactoidIds')) ?? '[]');
      const lastFactoidAt = Number((await getSetting('lastFactoidShownAt')) ?? 0);
      shownFactIds = new Set();
      shownImageSlugs = new Set();
      set({ conversationId: convId, messages, lastFactoidIds, lastFactoidAt, hasHydrated: true });
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
            content: uiStrings(lang).waitPreparing,
            timestamp: new Date(),
          },
        ],
      }));
      return;
    }

    // Stage 1 (cosmetic): "looking for the answer" while retrieval runs.
    set({ isStreaming: true, currentStreamingContent: '', thinkingStatus: uiStrings(lang).thinkingSearching });

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
      // Stage 2 (cosmetic): "reading about <topic>" using the retrieved top fact's topic.
      // Only show the topic if it's clean human text (letters/spaces) — a raw id-slug
      // ("solar-system-...-g4") falls back to a generic phrase. Pure UI; no tokens.
      const topTopic = (grounding[0]?.metadata as { topic?: string } | undefined)?.topic?.trim();
      const cleanTopic = topTopic && /^[\p{L} ]{2,28}$/u.test(topTopic) ? topTopic : '';
      set({
        thinkingStatus: cleanTopic
          ? `${uiStrings(lang).thinkingReadingAbout} ${cleanTopic}`
          : grounding.length
            ? uiStrings(lang).thinkingReading
            : uiStrings(lang).thinkingWorking,
      });
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
          const m = conversationMessages[i];
          if (m?.role === 'user') {
            conversationMessages[i] = {
              ...m,
              content: composeGroundedUserTurn(groundingBlock, m.content),
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

      // Illustration, in priority order:
      // 1. The tutor's own [image: <desc>] control token (the trained, principled
      //    intent signal) → embedding-resolved to a bundled slug. Trust it even if
      //    the abstain regex fires — the model explicitly asked to show a picture.
      // 2. Otherwise the TOP grounded fact's curated image, suppressed when the
      //    tutor abstained/redirected (the grounding wasn't actually relevant).
      let tagSlug: string | undefined;
      const tagDesc = IMAGE_TAG_RE.exec(fullResponse)?.[1];
      if (tagDesc && engine.resolveImageTag) {
        const hit = await engine.resolveImageTag(tagDesc);
        // Already shown this conversation → suppress, don't substitute (the model
        // asked for THIS picture; a different one would mislabel the answer).
        if (hit && !shownImageSlugs.has(hit.slug)) tagSlug = hit.slug;
      }
      const abstained = ABSTAIN_RE.test(fullResponse);

      // 2b. RETRIEVAL-DRIVEN illustration — the RELIABLE path on the Q4 GGUF, where the
      // model almost never emits a tag. Embed the TOP grounded fact and semantic-match a
      // bundled image (reuses resolveImageTag's embed+cosine). Gated on: no model tag, not
      // abstained (grounding was actually used). Post-generation → ZERO TTFT cost.
      let retrievalSlug: string | undefined;
      if (!tagSlug && !abstained && engine.resolveImageTag && grounding[0]?.content) {
        const hit = await engine.resolveImageTag(grounding[0].content, RETRIEVAL_IMAGE_FLOOR);
        if (hit && !shownImageSlugs.has(hit.slug)) retrievalSlug = hit.slug;
      }

      // Priority: model's explicit tag → semantic fact-match → precomputed FACT_IMAGE → none.
      // DEDUP applies to EVERY path (incl. the FACT_IMAGE fallback, which previously bypassed
      // it) so the same illustration isn't re-spammed — e.g. repeated "t-rex" questions get
      // the tyrannosaurus image once, then text-only.
      let finalImageSlug = tagSlug ?? retrievalSlug ?? (abstained ? undefined : imageSlug);
      if (finalImageSlug && shownImageSlugs.has(finalImageSlug)) finalImageSlug = undefined;
      if (finalImageSlug) shownImageSlugs.add(finalImageSlug);

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
        thinkingStatus: '',
      }));
      await addMessage(convId, assistantMessage);
      // Auto-compact this answer in the background (best-effort; serialized).
      void compactInBackground(assistantMessage);
    } catch (error) {
      console.error('Error during chat:', error);
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'assistant', content: uiStrings(lang).errorGeneric, timestamp: new Date() },
        ],
        isStreaming: false,
        currentStreamingContent: '',
        thinkingStatus: '',
      }));
    }
  },

  // "Alam mo ba na…?" card shown while the model warms up. PERSISTED (it's context
  // the kid is reading) but kept out of the model context by isRealTurn (factoids
  // carry an id now, but isFactoid still excludes them). Skips re-rolling when one is
  // already on screen / was shown < FACTOID_TTL_MS ago — so a background→resume keeps
  // the SAME factoid instead of swapping in a new random one.
  showColdStartFactoid: async () => {
    const now = Date.now();
    const onScreen = [...get().messages].reverse().find(isFactoid);
    const onScreenFresh = !!onScreen && now - new Date(onScreen.timestamp ?? 0).getTime() < FACTOID_TTL_MS;
    const shownRecently = get().lastFactoidAt > 0 && now - get().lastFactoidAt < FACTOID_TTL_MS;
    if (onScreenFresh || shownRecently) return; // keep the existing one; don't re-roll

    const lastIds = get().lastFactoidIds;
    // Follow the active tutor language (was hardcoded Tagalog → English mode still got a TL factoid).
    const lang = useEngineStore.getState().language ?? 'tagalog';
    const picked = pickFactoidText(lang, lastIds);
    if (!picked) return;

    // Attach to (and persist with) the active thread.
    let convId = get().conversationId;
    if (!convId) {
      convId = genId();
      await createConversation(convId);
      set({ conversationId: convId });
    }

    const factoid: Message = {
      id: genId(),
      role: 'assistant',
      content: picked.text,
      timestamp: new Date(now),
      metadata: { kind: 'factoid' },
    };
    // Persist the FULL text up front; the typewriter below is cosmetic for this view
    // (a reload — e.g. after resume — shows the complete card immediately).
    await addMessage(convId, factoid);
    const nextHistory = [...lastIds, picked.id].slice(-15);
    set((state) => ({
      messages: [...state.messages, { ...factoid, content: '' }],
      lastFactoidIds: nextHistory,
      lastFactoidAt: now,
    }));
    void setSetting('lastFactoidIds', JSON.stringify(nextHistory));
    void setSetting('lastFactoidShownAt', String(now));

    // Deliberate single-char typewriter so it's clearly animated. ~1 char / 26ms ≈
    // 38 chars/sec → a typical factoid types on over ~4-7s while the model warms up.
    // Animate BY ID (not last-element) so a reply arriving mid-type can't be clobbered.
    const CHARS_PER_TICK = 1;
    const TICK_MS = 26;
    let index = 0;
    const fullText = picked.text;
    const tick = () => {
      index += CHARS_PER_TICK;
      const slice = fullText.slice(0, index);
      set((state) => ({
        messages: state.messages.map((m) => (m.id === factoid.id ? { ...m, content: slice } : m)),
      }));
      if (index < fullText.length) setTimeout(tick, TICK_MS);
    };
    setTimeout(tick, TICK_MS);
  },

  // Start a fresh thread.
  clearMessages: async () => {
    const convId = genId();
    await createConversation(convId);
    shownFactIds = new Set();
    shownImageSlugs = new Set();
    set({ conversationId: convId, messages: [], isStreaming: false, currentStreamingContent: '' });
  },

  switchConversation: async (id: string) => {
    if (get().conversationId === id) return; // already here
    try {
      const messages = await getMessages(id);
      set({ conversationId: id, messages, isStreaming: false, currentStreamingContent: '' });
    } catch (e) {
      console.error('[chatStore] switchConversation failed:', e);
    }
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
