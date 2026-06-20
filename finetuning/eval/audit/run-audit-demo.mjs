#!/usr/bin/env node
// ============================================================================
// run-audit-demo.mjs — structured audit log for ONE on-device demo run.
//
// Boots the DEVICE-EQUIVALENT engine (the same base GGUF + bundled LoRA the
// regression gate uses: `llama-server -m BASE --lora ADAPTER`), runs a handful
// of representative tutor prompts, and writes a structured JSON audit log
// capturing:
//   • model LOAD / UNLOAD events (with load time + backend device), and
//   • per inference call: prompt, prompt/completion TOKENS, TTFT (time to first
//     token, client-measured like the device), and TOKENS/SEC.
//
// These mirror the metrics the real app logs on-device via the QVAC SDK
// (LocalEngine.ts: timeToFirstToken / promptTokens / tokensPerSecond /
// backendDevice) — here they are persisted to a file instead of the console.
//
// Usage:
//   node finetuning/eval/audit/run-audit-demo.mjs
//   BASE=/path/to/Sailor2-3B-Chat.Q4_K_M.gguf node .../run-audit-demo.mjs
//   ADAPTER=/path/to/adapter.gguf OUT=/path/to/log.json node .../run-audit-demo.mjs
// ============================================================================
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..'); // repo root (finetuning/eval/audit → root)

// --- config (env-overridable; defaults mirror run-harness.sh) ---------------
const BIN = process.env.BIN || '/opt/homebrew/bin/llama-server';
const BASE = process.env.BASE || resolve(ROOT, 'deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf');
const ADAPTER =
  process.env.ADAPTER || resolve(ROOT, 'packages/mobile/assets/models/adapter-tagalog.gguf');
const PORT = Number(process.env.PORT || 8088);
const NGL = Number(process.env.NGL ?? 99); // GPU offload (cat tier); set 0 for CPU (kitten)
const CTX = Number(process.env.CTX || 4096); // must match ACTIVE_MODEL.ctxSize
// Default output lives at the REPO ROOT so it's discoverable next to AUDIT_LOG.md
// and REMOTE_APIS.md (override with OUT=).
const OUT = process.env.OUT || resolve(ROOT, 'AUDIT_LOG.demo-run.json');
// Human-readable summary, regenerated from the SAME data as the JSON so it can never drift
// (it did: the hand-maintained MD lagged the JSON by an adapter version, 2026-06-20).
const MD_OUT = process.env.MD_OUT || OUT.replace(/\.demo-run\.json$/, '.md');
const TEMP = Number(process.env.TEMP ?? 0.5); // CHAT_TEMP in LocalEngine
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 256);
const BASE_URL = `http://localhost:${PORT}`;

// A concise, representative grade-5 Tagalog science-tutor system prompt. The
// shipped app assembles a richer RAG-grounded prompt at runtime; this demo
// isolates raw engine performance, so a compact persona prompt is sufficient
// and is recorded verbatim in the audit log for reproducibility.
const SYSTEM_PROMPT =
  'Ikaw si Hiraia, isang mabait na guro ng Agham para sa mga batang Pilipino sa Grade 5. ' +
  'Sumagot nang maikli, tama, at madaling maintindihan sa Tagalog.';

// Representative demo turns: Tagalog science (the core use), an English turn
// (rides the Tagalog adapter on-device), and a chit-chat turn (must not lecture).
const PROBES = [
  { id: 'tl-photosynthesis', lang: 'tagalog', user: 'Ano ang photosynthesis?' },
  { id: 'tl-water-cycle', lang: 'tagalog', user: 'Paano gumagana ang water cycle?' },
  { id: 'tl-why-sky-blue', lang: 'tagalog', user: 'Bakit asul ang langit?' },
  { id: 'en-states-of-matter', lang: 'english', user: 'What are the three states of matter?' },
  { id: 'chitchat-greeting', lang: 'tagalog', user: 'Kumusta ka?' },
];

// --- tiny helpers -----------------------------------------------------------
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeBytes = (p) => (existsSync(p) ? statSync(p).size : null);

function fail(msg, code = 2) {
  console.error(`ERR: ${msg}`);
  process.exit(code);
}

// Detect the backend device the server actually used, from its boot log.
function detectBackend(log) {
  if (/using device Metal|ggml_metal|Metal :|offloaded \d+\/\d+ layers to GPU/i.test(log)) {
    return NGL > 0 ? 'gpu (metal)' : 'cpu';
  }
  if (/CUDA|ROCm|Vulkan/i.test(log)) return 'gpu';
  return NGL > 0 ? 'gpu' : 'cpu';
}

// Stream a chat completion, measuring client-side TTFT + decode like the device.
async function runInference(probe, index) {
  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: probe.user },
    ],
    stream: true,
    stream_options: { include_usage: true },
    temperature: TEMP,
    max_tokens: MAX_TOKENS,
    cache_prompt: true, // reuse the static-system-prompt KV cache (the device's TTFT win)
  };

  const t0 = Date.now();
  let firstAt = 0;
  let chunks = 0;
  let text = '';
  let usage = null;
  let timings = null; // llama.cpp server extension (server-side prefill ms / tok/s)

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) fail(`inference HTTP ${res.status} for ${probe.id}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = obj.choices?.[0]?.delta?.content;
      if (delta) {
        if (!firstAt) firstAt = Date.now(); // TTFT: first generated token
        chunks++;
        text += delta;
      }
      if (obj.usage) usage = obj.usage;
      if (obj.timings) timings = obj.timings;
    }
  }

  const totalMs = Date.now() - t0;
  const ttftMs = firstAt ? firstAt - t0 : totalMs;
  const decodeMs = Math.max(1, totalMs - ttftMs);
  const completionTokens = usage?.completion_tokens ?? chunks;
  const promptTokens = usage?.prompt_tokens ?? null;
  // tokens/sec (decode), client-measured — exactly how LocalEngine.chat computes it
  const tokensPerSec = completionTokens > 1 ? ((completionTokens - 1) * 1000) / decodeMs : null;

  return {
    ts: nowIso(),
    type: 'inference',
    index,
    probeId: probe.id,
    lang: probe.lang,
    prompt: { system: SYSTEM_PROMPT, user: probe.user },
    response: { text: text.trim(), preview: text.trim().slice(0, 160) },
    metrics: {
      promptTokens,
      completionTokens,
      ttftMs,
      decodeMs,
      totalMs,
      tokensPerSec: tokensPerSec != null ? Number(tokensPerSec.toFixed(2)) : null,
      // server-side ground truth from llama.cpp, when available:
      server: timings
        ? {
            promptTokens: timings.prompt_n ?? null,
            promptMs: timings.prompt_ms ?? null,
            promptPerSec: timings.prompt_per_second ?? null,
            predictedTokens: timings.predicted_n ?? null,
            predictedMs: timings.predicted_ms ?? null,
            predictedPerSec: timings.predicted_per_second ?? null,
          }
        : null,
    },
  };
}

// Render the human-readable AUDIT_LOG.md from the SAME audit object written to JSON, so the
// summary can never drift from the source of truth. Hand-edits will be overwritten on rerun.
function renderMd(a) {
  const { run, summary, events, generatedAt } = a;
  const inf = events.filter((e) => e.type === 'inference');
  const date = generatedAt.slice(0, 10);
  const comma = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));
  const cold = inf[0]?.metrics.ttftMs ?? summary.avgTtftMs;
  const warmTtfts = inf.slice(1).map((e) => e.metrics.ttftMs).filter((x) => x != null);
  const warm = warmTtfts.length
    ? Math.round(warmTtfts.reduce((x, y) => x + y, 0) / warmTtfts.length)
    : cold;
  const rows = inf
    .map((e, i) => {
      const m = e.metrics;
      const label = i === 0 ? `${e.probeId} (cold)` : e.probeId;
      return `| ${i + 1} | ${label} | ${m.promptTokens ?? '?'} | ${m.completionTokens} | ${m.ttftMs} | ${m.tokensPerSec ?? '?'} | ${m.totalMs} |`;
    })
    .join('\n');
  return `# Audit Log — one on-device demo run

<!-- GENERATED by finetuning/eval/audit/run-audit-demo.mjs from AUDIT_LOG.demo-run.json — do NOT hand-edit; rerun the script. -->

Hiraia runs **all inference on-device** (QVAC / llama.cpp). This is a structured audit log of one
demo run on the **device-equivalent engine** — the exact base GGUF + bundled Filipino LoRA the
regression gate uses (\`llama-server -m BASE --lora ADAPTER\`), the **${run.tier}** tier.

- **Machine-readable artifact (source of truth):** [\`AUDIT_LOG.demo-run.json\`](./AUDIT_LOG.demo-run.json)
- **Generator (reproducible):** [\`finetuning/eval/audit/run-audit-demo.mjs\`](./finetuning/eval/audit/run-audit-demo.mjs) — see [\`finetuning/eval/audit/README.md\`](./finetuning/eval/audit/README.md)
- **Remote APIs used by the app:** [\`REMOTE_APIS.md\`](./REMOTE_APIS.md)

The JSON records time-ordered events — \`model_load_start → model_load_complete → inference ×N →
model_unload\` — and, for each inference call, the prompt, prompt/completion **token** counts,
**TTFT** (time to first token), and **tokens/sec**. These mirror the metrics the shipped app
measures on-device via the QVAC SDK (\`packages/mobile/src/engine/LocalEngine.ts\`).

## Run summary

_Generated ${date} · device-equivalent engine · ${run.tier}._

| | |
|---|---|
| Engine | \`${run.engine.binary}\` · backend **${run.engine.backendDevice}** · gpuLayers ${run.engine.gpuLayers} · ctx ${run.engine.ctxSize} · temp ${run.engine.chatTemp} |
| Model | \`${run.model.base}\` (base) + \`${run.model.adapter}\` (bundled LoRA) |
| Tier | ${run.tier} |
| **Model load** | **${comma(summary.modelLoadMs)} ms** |
| Inference calls | ${summary.inferenceCalls} |
| Avg TTFT | ${Math.round(summary.avgTtftMs)} ms (${cold} ms cold → ~${warm} ms warm) |
| Avg decode | ${summary.avgTokensPerSec == null ? '?' : summary.avgTokensPerSec.toFixed(1)} tok/s |
| Tokens | ${comma(summary.totalPromptTokens)} prompt / ${comma(summary.totalCompletionTokens)} completion |

## Per-call metrics

| # | Probe | Prompt tok | Out tok | TTFT (ms) | tok/s | Total (ms) |
|---|-------|-----------:|--------:|----------:|------:|-----------:|
${rows}

**Reading the TTFT drop:** the first call pays the cold system-prompt prefill (~${cold} ms); every
call after reuses that prefix's KV cache (\`cache_prompt\`) and lands at ~${warm} ms — the device's
real per-turn TTFT win. (In the JSON, warm calls show \`server.promptTokens\` ≈ 10–14 — only the
*new* tokens processed — while \`metrics.promptTokens\` reports the full prompt; the gap is the cache.)

## Regenerate

\`\`\`bash
BASE=/path/to/Sailor2-3B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs
# kitten (CPU/1B) tier:
NGL=0 BASE=/path/to/Sailor2-1B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs
\`\`\`
`;
}

// --- main -------------------------------------------------------------------
async function main() {
  if (!existsSync(BIN)) fail(`llama-server not at ${BIN} (set BIN=)`);
  if (!existsSync(BASE)) fail(`base GGUF not at ${BASE} (set BASE=)`);
  if (!existsSync(ADAPTER)) fail(`adapter GGUF not at ${ADAPTER} (set ADAPTER=)`);
  mkdirSync(dirname(OUT), { recursive: true });

  const events = [];
  const runStartedAt = nowIso();

  // ---- model load ----
  console.log(`[audit] booting ${BIN}\n        base=${BASE}\n        lora=${ADAPTER}`);
  const loadStart = Date.now();
  events.push({
    ts: nowIso(),
    type: 'model_load_start',
    base: BASE,
    adapter: ADAPTER,
    ngl: NGL,
    ctxSize: CTX,
  });

  let serverLog = '';
  const server = spawn(BIN, [
    '-m', BASE,
    '--lora', ADAPTER,
    '-ngl', String(NGL),
    '--port', String(PORT),
    '--ctx-size', String(CTX),
  ]);
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));
  let serverExited = false;
  server.on('exit', () => (serverExited = true));

  // wait for /health
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (serverExited) {
      console.error(serverLog.split('\n').slice(-15).join('\n'));
      fail('server exited before becoming ready');
    }
    try {
      const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  if (!ready) {
    try {
      server.kill();
    } catch {}
    fail('server not ready within timeout');
  }

  const loadMs = Date.now() - loadStart;
  const backendDevice = detectBackend(serverLog);
  console.log(`[audit] model loaded in ${loadMs}ms · backend ${backendDevice}`);
  events.push({
    ts: nowIso(),
    type: 'model_load_complete',
    loadMs,
    backendDevice,
    base: BASE,
    adapter: ADAPTER,
  });

  // ---- inference calls ----
  const inferences = [];
  for (let i = 0; i < PROBES.length; i++) {
    const p = PROBES[i];
    console.log(`[audit] inference ${i + 1}/${PROBES.length}: ${p.id}`);
    const ev = await runInference(p, i);
    const m = ev.metrics;
    console.log(
      `         TTFT ${m.ttftMs}ms · prompt ${m.promptTokens ?? '?'} tok · ` +
        `out ${m.completionTokens} tok · ${m.tokensPerSec ?? '?'} tok/s · total ${m.totalMs}ms`
    );
    events.push(ev);
    inferences.push(m);
  }

  // ---- model unload ----
  console.log('[audit] unloading model (stopping server)');
  events.push({ ts: nowIso(), type: 'model_unload', reason: 'demo complete' });
  try {
    server.kill('SIGTERM');
  } catch {}

  // ---- summary ----
  const n = inferences.length;
  const avg = (sel) => {
    const xs = inferences.map(sel).filter((x) => x != null);
    return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null;
  };
  const sum = (sel) => inferences.map(sel).reduce((a, b) => a + (b ?? 0), 0);

  const auditLog = {
    schemaVersion: '1.0',
    generatedAt: runStartedAt,
    run: {
      description:
        'One demo run on the device-equivalent engine (llama-server: bundled base GGUF + bundled Tagalog LoRA), capturing model load/unload and per-inference performance.',
      deviceEquivalent: true,
      tier: NGL > 0 ? 'cat (3B / GPU offload)' : 'kitten (1B / CPU)',
      engine: {
        binary: BIN.split('/').pop(),
        backendDevice,
        gpuLayers: NGL,
        ctxSize: CTX,
        chatTemp: TEMP,
        maxTokens: MAX_TOKENS,
      },
      model: {
        base: BASE.split('/').pop(),
        baseBytes: sizeBytes(BASE),
        adapter: ADAPTER.split('/').pop(),
        adapterBytes: sizeBytes(ADAPTER),
      },
      host: { platform: process.platform, arch: process.arch, node: process.version },
    },
    events,
    summary: {
      inferenceCalls: n,
      modelLoadMs: loadMs,
      avgTtftMs: avg((m) => m.ttftMs),
      avgTokensPerSec: avg((m) => m.tokensPerSec),
      totalPromptTokens: sum((m) => m.promptTokens),
      totalCompletionTokens: sum((m) => m.completionTokens),
    },
  };

  writeFileSync(OUT, JSON.stringify(auditLog, null, 2) + '\n');
  console.log(`\n[audit] wrote ${OUT}`);
  writeFileSync(MD_OUT, renderMd(auditLog));
  console.log(`[audit] wrote ${MD_OUT}`);
  console.log(
    `[audit] summary: load ${loadMs}ms · ${n} calls · avg TTFT ${auditLog.summary.avgTtftMs}ms · ` +
      `avg ${auditLog.summary.avgTokensPerSec} tok/s`
  );

  // make sure the server is gone
  await sleep(300);
  try {
    if (!serverExited) server.kill('SIGKILL');
  } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error('audit run failed:', e);
  process.exit(1);
});
