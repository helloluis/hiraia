import { type NextRequest } from 'next/server';

import { buildCardPrompt, sanitizeCardAnswer, CARD_TEMP } from '@hiraia/shared';

import { loraScalesFor, MODEL_INFO, type LanguageKey } from '@/config/model';
import { retrieveForCard, warmRag } from '@/server/rag';
import { callerKey, Semaphore, TokenBucket } from '@/server/throttle';

/**
 * DYNAMIC CARD for the web demo's feed — the server half of the ask box.
 *
 * The feed is retrieval-FIRST: the browser searches the bundled demo subset itself and, on a
 * confident match, navigates straight to that card without ever calling this route (see
 * useCardDemoStore.ask). This route is the MISS path, and it is the same one the phone runs in
 * LocalEngine.answerQuery — the whole point being that the demo answers a typed question for
 * real instead of always showing "I don't know that yet".
 *
 * THREE outcomes, one per card shape (DemoResponseCard renders each):
 *   generated — grounded facts exist → the model prints ONE short fact card from them;
 *   abstain   — an in-domain GAP: it is science, we just have no page for it yet. The client
 *               adds the nearest demo-subset topic as a soft landing;
 *   offdomain — not science at all ("roblox") → "I'm only a science tutor", with NO nearest
 *               topic. Answering a video-game question with a science card is exactly what
 *               this shape exists to stop.
 * The two miss shapes are model-FREE: nothing is generated, so nothing can be hallucinated.
 *
 * WHERE THE THREE-WAY SPLIT IS MADE: server/rag.ts `retrieveForCard`, on the shared
 * `isOffDomain` gate and the floors calibrated on the phone's own Q4_K_M LaBSE. Both
 * diagnostics it needs — `topCos` and the lexical arm — are available in the web path:
 * `retrieveForGroundingHybridDiag` returns topCos/lexEmpty, and the spelling probe
 * (`lexicallyUnreachable`) is a method on the same RagStore singleton. The one thing the web
 * path can lack that the phone cannot is the embedder itself: if hiraia-embed is down, topCos
 * is 0, the store reports `semantic: false`, and NEITHER diagnostic is allowed to classify —
 * the query falls through to the honest gap card rather than being called off-topic.
 *
 * NOT streamed, deliberately: a printed card is ~30 words and the feed shows a thinking veil
 * for the whole beat, so there is nothing to reveal progressively — and buffering lets the
 * shared `sanitizeCardAnswer` run server-side, so a truncated or cue-echoing generation never
 * reaches the page at all.
 *
 * THROTTLED on the generation branch only — see ASK_BUCKET / GEN_SLOTS below.
 */

export const runtime = 'nodejs';

const MODEL_URL = process.env.HIRAIA_MODEL_URL || 'http://localhost:8080';
const LANGS = new Set<LanguageKey>(['tagalog', 'english', 'cebuano']);

/** Grade the card is pitched at when the client sends none (mobile's DEFAULT_GRADE). */
const DEFAULT_GRADE = 5;
const MIN_GRADE = 3;
const MAX_GRADE = 10;

/** A typed feed query is a question, not an essay. */
const MAX_QUERY_CHARS = 300;

/**
 * Ceiling on the generation. A card is capped at 30 words by the prompt and at
 * CARD_MAX_CHARS by the sanitizer, so this only bounds a runaway.
 */
const MAX_TOKENS = 160;

/**
 * How long the visitor waits before we give them the honest gap card instead. The feed is
 * showing a thinking veil for this whole time, so it has to stay inside a child's patience;
 * the VPS answers a 30-word card well inside it.
 */
const GEN_TIMEOUT_MS = 25_000;

/**
 * Throttles on the generation branch (server/throttle.ts). This route is UNAUTHENTICATED — the
 * demo has no accounts by design — and the feed calls it automatically on every local search
 * miss, so it is by far the busiest way into the model on a box that also serves hiraia.org.
 *
 * The numbers are set against a CHILD's behaviour, not a load test: 6 questions back-to-back
 * and one every ~6 s after that is more than a curious visitor will type and far less than a
 * loop will. The semaphore is the one that actually matters — it caps concurrent generations
 * below llama-server's slot count so the site cannot be starved of them.
 *
 * A throttled request costs nothing and is not an error: it returns the same honest gap card
 * the route already returns when the model is unreachable.
 */
const ASK_BUCKET = new TokenBucket({ burst: 6, perMinute: 10 });
const GEN_SLOTS = new Semaphore(2);

// Warm the RAG store (load the int8 blob into RAM) at module init so the first visitor's
// query isn't slowed by the one-time blob read. Idempotent with /api/demo/chat's warm — it is
// the same module singleton.
warmRag();

export interface CardAnswer {
  kind: 'generated' | 'abstain' | 'offdomain';
  /** The printed card, on `generated` only. */
  text: string | null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const rawQuery = (body as { query?: unknown }).query;
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return json({ error: 'empty query' }, 400);
  }
  const query = rawQuery.trim().slice(0, MAX_QUERY_CHARS);

  const rawLang = (body as { language?: unknown }).language;
  const language: LanguageKey =
    typeof rawLang === 'string' && LANGS.has(rawLang as LanguageKey)
      ? (rawLang as LanguageKey)
      : 'tagalog';

  // The grade comes from onboarding and is what the card is pitched at. Clamped rather than
  // rejected: a bad value should print a slightly mis-pitched card, never a 400.
  const rawGrade = Number((body as { grade?: unknown }).grade);
  const grade = Number.isFinite(rawGrade)
    ? Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(rawGrade)))
    : DEFAULT_GRADE;

  // ---- 1. retrieve + classify (model-free) ----
  let retrieval;
  try {
    retrieval = await retrieveForCard(query, language);
  } catch (e) {
    // Retrieval itself is down (no bank, no store). The honest gap card is the only shape we
    // can still stand behind: we cannot claim a query is off-domain without having looked.
    console.warn('[demo/card] retrieval failed — gap card:', e);
    return json<CardAnswer>({ kind: 'abstain', text: null }, 200);
  }

  if (retrieval.outcome === 'offdomain') return json<CardAnswer>({ kind: 'offdomain', text: null }, 200);
  if (retrieval.outcome === 'gap') return json<CardAnswer>({ kind: 'abstain', text: null }, 200);

  // ---- 2. print the card (the ONLY outcome that touches the model) ----
  // Throttled here rather than at the top of the handler: retrieval is cheap and local, and the
  // two model-free outcomes above are answers a throttled visitor should still get.
  if (!ASK_BUCKET.take(callerKey(req))) return json<CardAnswer>({ kind: 'abstain', text: null }, 200);

  // The SAME prompt the phone sends (@hiraia/shared prompts/cards.ts), so a card printed here
  // and a card printed in the APK are the same card.
  const instruction = buildCardPrompt({
    query,
    facts: retrieval.hits.map((h) => h.content),
    grade,
    language,
  });

  let text: string | null = null;
  try {
    const upstream = await GEN_SLOTS.tryRun(() =>
      fetch(`${MODEL_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_INFO.serverModelId,
          messages: [{ role: 'user', content: instruction }],
          stream: false,
          temperature: CARD_TEMP,
          max_tokens: MAX_TOKENS,
          lora: loraScalesFor(language),
          // A card is ONE paragraph. Measured against the CPT'd Qwen3.5-2B (the model this
          // is moving to): without a stop it writes the correct card, then keeps going into
          // repeated "**Pansin:** ... **Paliwanag:** ..." meta-commentary until it hits the
          // token cap. With the stop it returns 36 tokens, finish_reason 'stop', 20 words.
          stop: ['\n\n'],
          // Qwen3.5 is a thinking model: unless thinking is disabled it puts the answer in
          // `reasoning_content` and leaves `content` EMPTY, so every card would come back
          // blank and fall through to the gap card — a total failure that looks like a
          // retrieval miss. llama-server ignores unknown kwargs, so this is safe against a
          // non-thinking server too (Sailor2 was unaffected by it).
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
      })
    );
    if (!upstream) {
      console.warn('[demo/card] all generation slots busy — gap card');
    } else if (upstream.ok) {
      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      };
      const msg = data.choices?.[0]?.message;
      // Belt and braces on the thinking-model trap above: if a server ignores
      // `enable_thinking` (or a future model defaults it back on), the answer arrives in
      // `reasoning_content` with `content` empty. Recovering it is strictly better than
      // printing the gap card, but it means the request is misconfigured — say so loudly
      // rather than silently limping.
      let raw = msg?.content ?? '';
      if (!raw.trim() && msg?.reasoning_content?.trim()) {
        console.warn(
          '[demo/card] model returned an empty `content` with a non-empty `reasoning_content` — ' +
            'thinking was not disabled upstream; using the reasoning text'
        );
        raw = msg.reasoning_content;
      }
      text = sanitizeCardAnswer(raw);
    } else {
      console.warn('[demo/card] model returned', upstream.status);
    }
  } catch (e) {
    console.warn('[demo/card] generation failed:', e);
  }

  // Generation unavailable or unprintable → the honest gap card, exactly as the phone falls
  // back when answerQuery throws. Never a 5xx: the feed has a card to show either way, and a
  // failed fetch on the client would look like a broken demo rather than an honest miss.
  if (!text) return json<CardAnswer>({ kind: 'abstain', text: null }, 200);
  return json<CardAnswer>({ kind: 'generated', text }, 200);
}

function json<T>(payload: T, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
