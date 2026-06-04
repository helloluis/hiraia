/**
 * Pluggable LLM client for the factoid pipeline.
 *
 * Talks to ANY OpenAI-compatible /v1/chat/completions endpoint, so you can point
 * it at whatever model gives the best Filipino/Cebuano output as your fine-tunes
 * improve — the local QVAC sidecar (with a Tagalog/Cebuano LoRA loaded), a hosted
 * endpoint, etc. Configure entirely via env:
 *
 *   HIRAIA_LLM_BASE_URL   default http://127.0.0.1:8080   (the @hiraia/server sidecar)
 *   HIRAIA_LLM_MODEL      default "local"                  (sidecar ignores it; hosted APIs need it)
 *   HIRAIA_LLM_API_KEY    optional bearer token
 *   HIRAIA_LLM_ADAPTER    optional lora_adapter hint (sidecar logs it; pick the language adapter)
 *
 * For the Cebuano pass you'd start the sidecar with HIRAIA_LORA_ADAPTER=<ceb>.gguf
 * and run the translate mode against it. Use --mock to exercise the plumbing
 * with no server (returns canned JSON).
 */

export const LLM_CONFIG = {
  baseUrl: process.env.HIRAIA_LLM_BASE_URL || 'http://127.0.0.1:8080',
  model: process.env.HIRAIA_LLM_MODEL || 'local',
  apiKey: process.env.HIRAIA_LLM_API_KEY || null,
  adapter: process.env.HIRAIA_LLM_ADAPTER || null,
};

/**
 * Call the chat endpoint and return the full assistant text. Handles both SSE
 * (the sidecar always streams) and plain JSON (non-streaming OpenAI) responses.
 * @param {{role:string,content:string}[]} messages
 * @param {{temperature?:number,maxTokens?:number,baseUrl?:string,model?:string,apiKey?:string,adapter?:string,signal?:AbortSignal}} [opts]
 * @returns {Promise<string>}
 */
export async function chatComplete(messages, opts = {}) {
  const cfg = { ...LLM_CONFIG, ...opts };
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature ?? 0.6,
    max_tokens: cfg.maxTokens ?? 700,
    stream: true,
  };
  if (cfg.adapter) body.lora_adapter = cfg.adapter;

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  } catch (err) {
    throw new Error(`LLM request to ${url} failed: ${err.message}. Is the model server running? (cd packages/server && npm run dev) — or use --mock.`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM endpoint ${url} returned ${res.status}: ${t.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (ct.includes('text/event-stream') || raw.startsWith('data:')) {
    let out = '';
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') break;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') out += delta;
        if (j.error) throw new Error(j.error);
      } catch {
        /* ignore keep-alive / non-JSON lines */
      }
    }
    return out.trim();
  }

  // Plain JSON (non-streaming OpenAI-style)
  try {
    const j = JSON.parse(raw);
    return (j.choices?.[0]?.message?.content || '').trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Tolerant JSON extraction: pull the first balanced {...} object out of model
 * output (small models love to wrap JSON in prose / code fences).
 * @param {string} text
 * @returns {any|null}
 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * A deterministic mock "model" for offline plumbing tests (--mock). It does NOT
 * produce real facts — it echoes a clearly-marked placeholder so you can verify
 * the pipeline reads/writes/promotes correctly without a server.
 * @param {{role:string,content:string}[]} messages
 * @returns {Promise<string>}
 */
export async function mockComplete(messages) {
  // Key off the LAST user message only — each task uses a distinctive opener
  // ("Source language:", "Claim:") so detection doesn't trip on system text.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  if (/^\s*Source language:/m.test(lastUser)) {
    return JSON.stringify({ hook: '[CEB MOCK hook]', body: '[CEB MOCK body].' });
  }
  if (/^\s*Claim:/m.test(lastUser)) {
    return JSON.stringify({ correct: true, confident: true, issue: '', correction: '' });
  }
  // draft
  return JSON.stringify({
    fact: '[MOCK fact — placeholder, not real]',
    hook: { tl: '[MOCK tl hook]', en: '[MOCK en hook]' },
    body: { tl: '[MOCK tl body].', en: '[MOCK en body].' },
  });
}
