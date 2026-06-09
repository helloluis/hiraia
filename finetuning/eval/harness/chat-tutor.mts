// chat-tutor.mts — talk to the device-equivalent tutor, one turn at a time,
// through the EXACT on-device pipeline, so we can surface failure scenarios
// WITHOUT the phone. It reproduces the device faithfully:
//
//   • HYBRID retrieval (LaBSE query embed @ :8090 + the bundled int8 vectors blob
//     → RagStore.retrieveForGroundingHybrid, floor 0.5 / abstain 0.58) — the same
//     path packages/mobile LocalEngine.ragSearch runs.
//   • the real prompt: generateSystemPrompt(lang, grade, imageTags=true) +
//     formatGroundingBlock(hits).
//   • the device's multi-turn shape: ragContext = prior 1-2 real turns;
//     shownFactIds accumulates (novelty); history windowed KEEP_FULL=6 with
//     compaction (summarize) of older turns — matching chatStore.
//   • sampling at the device temp (default 0.8 — LocalEngine.chat sets none).
//
// It is STATELESS per call (session persisted to JSON) so a human/agent can hold a
// real conversation across many invocations, playing a Filipino 5th-grader, and
// read each reply + the retrieved facts + auto-flags before composing the next line.
//
//   Boot once:  finetuning/eval/harness/chat-serve.sh   (chat :8088, embed :8090)
//   Talk:       tsx chat-tutor.mts say "bakit asul ang langit?" --session sky
//               tsx chat-tutor.mts say "eh kasi sabi ng kapatid ko dahil sa tubig?" -s sky
//   Manage:     tsx chat-tutor.mts new -s sky [--grade 5 --lang tagalog --temp 0.8]
//               tsx chat-tutor.mts show -s sky
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RagStore, SemanticIndex, normalizeQuery, buildContextualQuery } from '../../../packages/shared/src/rag/index.ts';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../../packages/shared/src/prompts/system.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SESS_DIR = join(HERE, '.chat-sessions');
const CHAT = process.env.CHAT_ENDPOINT ?? 'http://localhost:8088';
const EMBED = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const BLOB = join(HERE, '../../../packages/mobile/assets/rag/vectors-labse.i8.bin');
const META = join(HERE, '../../../packages/mobile/assets/rag/vectors-labse.meta.json');

// device parity (packages/mobile/src/store/chatStore.ts)
const KEEP_FULL = 6;
const MAX_LOOKBACK = 30;
type Lang = 'tagalog' | 'cebuano' | 'english';

// Deflection markers — kept in sync with run-eval.mts REFUSAL_MARKERS; here they
// are advisory AUTO-FLAGS on each reply (not assertions), to make over-abstention
// jump out while conversing.
const REFUSAL_MARKERS: RegExp[] = [
  /hindi\s+(?:po\s+)?ako(?:\s+po)?\s+(?:gaano\s+)?(?:sigurado|tiyak|kumpiyansa)/i,
  /hindi\s+ko\s+(?:po\s+)?(?:alam|matiyak|masabi|maipaliwanag|sigurado)/i,
  /(?:tanungin|magtanong|itanong|kausapin|konsultahin).{0,24}\b(?:guro|titser|teacher|magulang)\b/i,
  /(?:tingnan|basahin|hanapin|alamin|maghanap).{0,22}\b(?:libro|aklat|teksbuk|textbook|internet)\b/i,
  /wala\s+(?:po\s+)?ako(?:ng)?\s+(?:sapat\s+na\s+)?(?:impormasyon|alam|kaalaman)/i,
  /\bI(?:'m| am)\s+not\s+(?:sure|certain)\b/i, /\bask\s+your\s+(?:teacher|parent)\b/i,
];

interface Sess { lang: Lang; grade: number; temp: number; messages: { role: 'user' | 'assistant'; content: string }[]; shown: string[]; comp: Record<number, string>; }

// ---- args ----
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string, def?: string) => {
  const i = argv.findIndex((a) => a === `--${name}` || a === `-${name[0]}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('-') && !(arr[i - 1]?.startsWith('-')));
const sessName = flag('session', 'default')!;
const sessPath = join(SESS_DIR, `${sessName}.json`);

function load(): Sess {
  if (existsSync(sessPath)) return JSON.parse(readFileSync(sessPath, 'utf8'));
  return { lang: (flag('lang', 'tagalog') as Lang), grade: Number(flag('grade', '5')), temp: Number(flag('temp', '0.8')), messages: [], shown: [], comp: {} };
}
function save(s: Sess) { mkdirSync(SESS_DIR, { recursive: true }); writeFileSync(sessPath, JSON.stringify(s, null, 1)); }

// ---- engine plumbing ----
const store = new RagStore();
let semReady = false;
function attachSemantic() {
  try {
    const meta = JSON.parse(readFileSync(META, 'utf8'));
    const bytes = readFileSync(BLOB);
    const data = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    store.attachSemantic(new SemanticIndex({ dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs, data }));
    semReady = true;
  } catch (e) { console.warn(`[warn] semantic index not attached (${(e as Error).message}) — lexical-only`); }
}

async function embed(text: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json();
    const v = Float32Array.from(j.data?.[0]?.embedding ?? []);
    let n = 0; for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!; // L2 normalize (device embdNormalize:2)
    n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i]! /= n;
    return v.length ? v : undefined;
  } catch (e) { console.warn(`[warn] embed failed (${(e as Error).message}) — lexical fallback this turn`); return undefined; }
}

async function complete(messages: { role: string; content: string }[], temp: number, maxTokens = 320): Promise<string> {
  const res = await fetch(`${CHAT}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, temperature: temp, max_tokens: maxTokens, stream: false, ...(temp > 0 ? { seed: -1 } : {}), lora: [{ id: 0, scale: 1.0 }] }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

// Summarize an older assistant turn (device auto-compacter, LocalEngine.summarize).
async function summarize(text: string): Promise<string> {
  const instruction = 'Ibuod ang sumusunod na sagot ng science tutor sa ISA o DALAWANG napakaikling pangungusap, para magamit bilang maikling alaala (memory) sa susunod na usapan. Panatilihin LANG ang mahalagang science fact at termino. Alisin ang pagbati, mga halimbawa, at ang tanong sa dulo. Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n' + text;
  try { return (await complete([{ role: 'user', content: instruction }], 0)).trim(); } catch { return ''; }
}

// device buildContext: last KEEP_FULL verbatim; older assistant turns → compaction
// (kept user turn before a compacted answer); older w/o compaction dropped.
async function buildContext(s: Sess, system: string): Promise<{ role: string; content: string }[]> {
  const real = s.messages;
  const window = real.slice(-MAX_LOOKBACK);
  const splitAt = Math.max(0, window.length - KEEP_FULL);
  const older = window.slice(0, splitAt);
  const recent = window.slice(splitAt);
  const offset = real.length - window.length; // map window idx → absolute idx for comp cache
  const olderMapped: { role: string; content: string }[] = [];
  for (let i = 0; i < older.length; i++) {
    const m = older[i]!;
    const absIdx = offset + i;
    if (m.role === 'assistant') {
      if (m.content.length < 240) continue; // short answers aren't compacted (dropped)
      if (s.comp[absIdx] == null) s.comp[absIdx] = await summarize(m.content);
      if (s.comp[absIdx]) olderMapped.push({ role: 'assistant', content: s.comp[absIdx]! });
    } else {
      const next = older[i + 1];
      if (next?.role === 'assistant' && next.content.length >= 240) olderMapped.push(m); // keep user before a compacted answer
    }
  }
  return [{ role: 'system', content: system }, ...olderMapped, ...recent];
}

// ---- commands ----
async function sayCmd(kid: string) {
  const s = load();
  attachSemantic();
  s.messages.push({ role: 'user', content: kid });

  // ragContext = the 1-2 real turns BEFORE this one (chatStore slice(-3,-1))
  const ragContext = s.messages.slice(-3, -1).map((m) => m.content).join(' ');
  const seen = new Set(s.shown);
  const qv = await embed(normalizeQuery(kid)); // R1: embed normalized query (device parity)
  let hits = store.retrieveForGroundingHybrid(kid as any, qv, s.lang as any, 3, 0.5, ragContext, seen);
  // R2: topic-blind follow-up abstained — retry with the conversation topic folded in.
  if (hits.length === 0 && qv && ragContext.trim()) {
    const foldedVec = await embed(buildContextualQuery(kid, ragContext));
    if (foldedVec) hits = store.retrieveForGroundingHybrid(kid as any, foldedVec, s.lang as any, 3, 0.5, ragContext, seen);
  }
  for (const h of hits as any[]) if (!s.shown.includes(h.fact.id)) s.shown.push(h.fact.id);

  // STATIC system (no grounding); grounding rides the current user turn — matches chatStore.
  const system = generateSystemPrompt(s.lang as any, s.grade as any, true);
  const block = formatGroundingBlock(hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic, id: h.fact.id } })));

  const ctx = await buildContext(s, system);
  if (block) {
    for (let i = ctx.length - 1; i >= 0; i--) {
      if (ctx[i].role === 'user') { ctx[i].content = composeGroundedUserTurn(block, ctx[i].content); break; }
    }
  }
  const raw = await complete(ctx, s.temp);
  const reply = raw.replace(/\s*\[image:[^\]]*\]/gi, '').trim();
  s.messages.push({ role: 'assistant', content: raw });
  save(s);

  // ---- report ----
  const flags: string[] = [];
  if (REFUSAL_MARKERS.some((r) => r.test(reply))) flags.push('⚠️ DEFLECTION (refusal marker)');
  if (!hits.length) flags.push('∅ no grounding (abstained or off-topic)');
  if (s.lang === 'tagalog' && reply && (reply.match(/[a-z]/gi)?.length ?? 0) > 0) {
    const tlWords = (reply.match(/\b(ang|ng|sa|ay|po|ito|mga|na|at|kung|dahil|kaya)\b/gi) ?? []).length;
    if (tlWords < 2 && reply.length > 40) flags.push('🇬🇧 possible English drift');
  }
  const imageTag = /\[image:([^\]]*)\]/i.exec(raw);
  console.log(`\n🧒 ${kid}`);
  console.log(`\n📚 retrieved (${semReady ? 'hybrid' : 'lexical'}): ${hits.length ? (hits as any[]).map((h) => h.fact.id).join(', ') : 'NONE'}`);
  if (imageTag) console.log(`🖼️  image tag: ${imageTag[1]!.trim()}`);
  console.log(`\n🐱 ${reply}`);
  if (flags.length) console.log(`\n${flags.join('   ')}`);
  console.log(`\n[turn ${s.messages.filter((m) => m.role === 'user').length} · temp ${s.temp} · grade ${s.grade} · ${s.lang} · session ${sessName}]`);
}

function showCmd() {
  if (!existsSync(sessPath)) return console.log(`(no session '${sessName}')`);
  const s = load();
  console.log(`session ${sessName} · ${s.lang} · grade ${s.grade} · temp ${s.temp} · ${s.messages.length} msgs\n`);
  for (const m of s.messages) console.log(`${m.role === 'user' ? '🧒' : '🐱'} ${m.content.replace(/\s*\[image:[^\]]*\]/gi, ' ').trim()}\n`);
}

function newCmd() {
  mkdirSync(SESS_DIR, { recursive: true });
  const s: Sess = { lang: (flag('lang', 'tagalog') as Lang), grade: Number(flag('grade', '5')), temp: Number(flag('temp', '0.8')), messages: [], shown: [], comp: {} };
  save(s);
  console.log(`new session '${sessName}' · ${s.lang} · grade ${s.grade} · temp ${s.temp}`);
}

const usage = `chat-tutor — converse with the device-equivalent tutor (boot chat-serve.sh first)
  tsx chat-tutor.mts say "<kid line>" [-s session] [--grade 5] [--lang tagalog] [--temp 0.8]
  tsx chat-tutor.mts new  [-s session] [--grade N] [--lang L] [--temp T]
  tsx chat-tutor.mts show [-s session]
  tsx chat-tutor.mts list`;

(async () => {
  if (cmd === 'say') { const kid = positional[0]; if (!kid) { console.log(usage); process.exit(1); } await sayCmd(kid); }
  else if (cmd === 'new') newCmd();
  else if (cmd === 'show') showCmd();
  else if (cmd === 'list') console.log(existsSync(SESS_DIR) ? readdirSync(SESS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).join('\n') : '(none)');
  else console.log(usage);
})();
