import { type NextRequest } from 'next/server';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '@hiraia/shared';
import { loraScalesFor, MODEL_INFO, type LanguageKey } from '@/config/model';
import { retrieveGrounding, warmRag } from '@/server/rag';
import { callerKey, TokenBucket } from '@/server/throttle';

/**
 * Real-model backend for the public "Try the web demo" lightbox.
 *
 * This is a FAITHFUL replica of the shipped APK's grounded path, not a weaker
 * ungrounded chat. The llama-server runs on the SAME box (localhost:8080, not
 * publicly exposed) with the SHIPPED adapter loaded; a second llama-server runs
 * the LaBSE embedder (localhost:8090). For each turn we:
 *
 *   1. Retrieve curriculum facts via server-side RAG (same bank + int8 vectors as
 *      the phone; see server/rag.ts) — abstains on off-topic queries.
 *   2. Build the SAME prompt the phone sends: a STATIC production system prompt
 *      (generateSystemPrompt — KV-cache friendly) + the grounding block injected
 *      into the USER turn (composeGroundedUserTurn). The adapter was fine-tuned on
 *      exactly this shape, so it stays in-distribution.
 *   3. Stream the OpenAI-style SSE straight back to the client.
 *
 * Graceful degradation at every layer: RAG abstains/falls back to lexical if the
 * embedder is down; the whole route returns 502 (→ client canned fallback) only if
 * the generation server itself is unreachable. The demo never looks broken.
 *
 * SHIP PROCESS: when a new official APK ships, upload its adapter GGUF to the VPS,
 * restart the generation llama-server, and (if the bank changed) redeploy so the
 * web's @hiraia/shared bank + the vectors blob stay matched (see deploy/README).
 */

export const runtime = 'nodejs';

const MODEL_URL = process.env.HIRAIA_MODEL_URL || 'http://localhost:8080';

/**
 * Same throttles the card route carries (server/throttle.ts), for the same reason: this is
 * UNAUTHENTICATED generation on the single box that also serves hiraia.org and the APK
 * download. A chat turn is longer than a card, so the bucket is tighter — a visitor asking
 * questions types slower than one card-search miss per page turn.
 *
 * Unlike the card route there is no honest gap card to fall back to, so a throttled caller
 * gets 429 with Retry-After rather than a silent non-answer; the client shows it as a "try
 * again in a moment" rather than a broken reply.
 */
const CHAT_BUCKET = new TokenBucket({ burst: 4, perMinute: 8 });

// NO concurrency semaphore here, deliberately, unlike the card route. This response is
// STREAMED (`stream: true`, we hand back `upstream.body`), so a slot could only be released
// when the stream ends — and a client that disconnects mid-stream would hold it forever
// unless that is handled precisely. A leaked slot is a worse failure than an unbounded one:
// it degrades permanently and silently. The per-caller bucket above plus llama-server's own
// slot limit bound this path; if it ever needs a semaphore, release it from the stream's
// cancel/close handlers, not from the fetch.
const LANGS = new Set<LanguageKey>(['tagalog', 'english', 'cebuano']);

// Warm the RAG store (load the int8 blob into RAM) at module init so the first
// visitor's query isn't slowed by the one-time blob read.
warmRag();

export async function POST(req: NextRequest) {
  if (!CHAT_BUCKET.take(callerKey(req))) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '8' },
    });
  }
  const { message, language, history } = await req.json().catch(() => ({}));
  if (typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'empty message' }), { status: 400 });
  }
  const lang: LanguageKey =
    typeof language === 'string' && LANGS.has(language as LanguageKey) ? (language as LanguageKey) : 'tagalog';

  // Keep a short window of prior turns for context (system prompt is static → server KV-cache hit).
  const prior = Array.isArray(history)
    ? history
        .filter(
          (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
            !!m &&
            typeof (m as { content?: unknown }).content === 'string' &&
            ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant')
        )
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  const userMessage = message.slice(0, 4000);

  // RAG: retrieve grounding facts (same bank + vectors as the phone). `context` is
  // the most recent assistant reply, which feeds the R2 contextual re-embed so a
  // bare follow-up ("anong pinakamalaki sa kanila?") still finds its topic. Never
  // throws — abstains to [] on off-topic, falls back to lexical if the embedder is down.
  const lastAssistant = [...prior].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  let groundingBlock = '';
  try {
    const grounding = await retrieveGrounding(userMessage, lang, lastAssistant);
    groundingBlock = formatGroundingBlock(grounding);
  } catch (e) {
    console.warn('[demo/chat] grounding failed — answering ungrounded:', e);
  }

  // STATIC system prompt (persona/grade/language/image-tag) + grounding in the USER
  // turn — identical to the on-device chatStore path so the adapter is in-distribution.
  const systemPrompt = generateSystemPrompt(lang, 5, true);
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...prior,
    { role: 'user' as const, content: composeGroundedUserTurn(groundingBlock, userMessage) },
  ];

  let upstream: Response | null = null;
  try {
    upstream = await fetch(`${MODEL_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_INFO.serverModelId,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 640,
        lora: loraScalesFor(lang),
      }),
    });
  } catch {
    upstream = null;
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    // Signal the client to fall back to the canned preview reply.
    return new Response(JSON.stringify({ error: 'model unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Stream the model's SSE straight through; the client parses `data:` deltas.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
