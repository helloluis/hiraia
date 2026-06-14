import { type NextRequest } from 'next/server';
import { LANGUAGES, loraScalesFor, MODEL_INFO, type LanguageKey } from '@/config/model';

/**
 * Real-model backend for the public "Try the web demo" lightbox.
 *
 * The llama-server runs on the SAME box as this Next.js app (localhost:8080) and is
 * NOT publicly exposed, so the browser can't reach it directly — this server-side
 * route proxies the chat and streams the OpenAI-style SSE straight back to the client.
 * Mirrors the authed chat path (RemoteEngine): per-language system prompt + LoRA scales.
 *
 * The adapter the server has loaded should match the SHIPPED APK — when a new official
 * APK goes out, upload its adapter GGUF to the VPS and restart the llama-server (see
 * deploy/README). No RAG on the web path (same as the authed demo); the APK is the
 * grounded product.
 */

const MODEL_URL = process.env.HIRAIA_MODEL_URL || 'http://localhost:8080';
const LANGS = new Set<LanguageKey>(['tagalog', 'english', 'cebuano']);

export async function POST(req: NextRequest) {
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

  const messages = [
    { role: 'system' as const, content: LANGUAGES[lang].system },
    ...prior,
    { role: 'user' as const, content: message.slice(0, 4000) },
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
