// Temperature sweep: how does sampling temp trade off confabulation vs deflection
// vs (for controls) staying correct? Assembles the REAL device prompt (hybrid
// retrieval + the Tier-2 system prompt) and samples each probe N times at each temp.
// Needs chat-serve.sh up (chat :8088, embed :8090).
//   node_modules/.bin/tsx temp-sweep.mts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RagStore, SemanticIndex, normalizeQuery, buildContextualQuery } from '../../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../../packages/shared/src/rag/bankFile.ts';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../../packages/shared/src/prompts/system.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAT = 'http://localhost:8088';
const EMBED = 'http://localhost:8090';
const TEMPS = [0.8, 0.5, 0.3, 0];
const N = 4; // samples per temp (temp 0 is deterministic → 1)

const META = JSON.parse(readFileSync(join(HERE, '../../../packages/mobile/assets/rag/vectors-labse.meta.json'), 'utf8'));
const bytes = readFileSync(join(HERE, '../../../packages/mobile/assets/rag/vectors-labse.i8.bin'));
// loadFactSource stamps the store with md5(science-facts.jsonl)[:12] so attachSemantic can
// reject a blob built for a different bank of the SAME size (facts edited in place).
const store = new RagStore(loadFactSource());
store.attachSemantic(new SemanticIndex({ dims: META.dims, scale: META.scale, count: META.count, langs: META.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }), META.bankHash);

async function embed(t: string): Promise<Float32Array> {
  const r = await fetch(`${EMBED}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: t }) });
  const v = Float32Array.from((await r.json()).data[0].embedding);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v;
}
async function complete(messages: any[], temp: number): Promise<string> {
  const r = await fetch(`${CHAT}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, temperature: temp, max_tokens: 320, stream: false, ...(temp > 0 ? { seed: -1 } : {}), lora: [{ id: 0, scale: 1.0 }] }) });
  return ((await r.json()).choices?.[0]?.message?.content ?? '').replace(/\s*\[image:[^\]]*\]/gi, '').trim();
}
async function retrieve(query: string, context: string) {
  let qv = await embed(normalizeQuery(query));
  let hits = store.retrieveForGroundingHybrid(query as any, qv, 'tagalog', 3, 0.5, context);
  if (hits.length === 0 && context.trim()) hits = store.retrieveForGroundingHybrid(query as any, await embed(buildContextualQuery(query, context)), 'tagalog', 3, 0.5, context);
  return hits;
}

// ---- scorers (advisory; outputs also printed for eyeballing) ----
const REFUSAL = [/hindi\s+(?:po\s+)?ako(?:\s+po)?\s+(?:gaano\s+)?(?:sigurado|tiyak)/i, /hindi\s+ko\s+(?:po\s+)?(?:alam|matiyak|masabi)/i, /(?:tanungin|magtanong).{0,24}\b(?:guro|titser|magulang)\b/i, /tingnan.{0,18}\b(?:libro|aklat)\b/i];
const isDeflect = (t: string) => REFUSAL.some((r) => r.test(t));
// Jupiter confabulation patterns seen in the wild (mass>Jupiter, distance-gravity,
// storm-gravity, sun-gravity-causes-weight).
const JUP_CONFAB = [/(?:mas\s+malaki|malaki)\s+ang\s+masa\s+mo/i, /masa\s+mo.{0,20}(?:kaysa|jupiter)/i, /malayo.{0,20}planeta.{0,20}(?:malakas|grabidad)/i, /\blabas\b.{0,12}araw/i, /bagyo.{0,20}(?:grabidad|gravity)|grabidad.{0,20}bagyo/i, /grabidad\s+ng\s+araw.{0,40}(?:planeta|bigat|jupiter|mabigat)/i];
const isJupConfab = (t: string) => JUP_CONFAB.some((r) => r.test(t));
const venusOk = (t: string) => /(carbon dioxide|greenhouse|makapal.{0,15}(hangin|atmospera|ulap)|humuhuli.{0,10}init|nakukulong.{0,10}init)/i.test(t) && !isDeflect(t);

const JUP_CTX = 'paturo po tungkol sa planet jupiter Ang Jupiter ang pinakamalaking planeta sa Solar System — isang higanteng bola ng gas. Gusto mo bang malaman kung bakit mas mabigat ang timbang mo sa Jupiter?';
const PROBES = [
  { id: 'jupiter-grav (confab)', q: 'kasi mas matindi po ang gravity dun?', ctx: JUP_CTX, prior: [{ role: 'user', content: 'paturo po tungkol sa planet jupiter' }, { role: 'assistant', content: JUP_CTX.split('Ang Jupiter')[1] ? 'Ang Jupiter' + JUP_CTX.split('Ang Jupiter')[1] : JUP_CTX }], bad: isJupConfab, good: (t: string) => !isJupConfab(t) && !isDeflect(t), label: 'confab' },
  { id: 'venus-homework (deflect)', q: 'may homework po ako tungkol sa planet Venus', ctx: '', prior: [], bad: isDeflect, good: (t: string) => !isDeflect(t), label: 'deflect' },
  { id: 'venus-hot (control)', q: 'bakit po pinakamainit ang planetang Venus?', ctx: '', prior: [], bad: (t: string) => !venusOk(t), good: venusOk, label: 'wrong/deflect' },
];

(async () => {
  for (const p of PROBES) {
    const hits = await retrieve(p.q, p.ctx);
    const system = generateSystemPrompt('tagalog', 5, true);
    const block = formatGroundingBlock(hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } })));
    // grounding rides the current user turn — static system (cache-friendly), matches chatStore
    const base = [{ role: 'system', content: system }, ...p.prior, { role: 'user', content: composeGroundedUserTurn(block, p.q) }];
    console.log(`\n══════ ${p.id}  ·  retrieved: ${hits.map((h: any) => h.fact.id).slice(0, 3).join(', ') || 'none'}`);
    for (const temp of TEMPS) {
      const n = temp === 0 ? 1 : N;
      let bad = 0; const samples: string[] = [];
      for (let i = 0; i < n; i++) { const out = await complete(base, temp); samples.push(out); if (p.bad(out)) bad++; }
      const pct = Math.round((100 * bad) / n);
      console.log(`  temp ${temp.toFixed(1)}: ${p.label} ${bad}/${n} (${pct}%)   e.g. «${samples.find(p.bad) ?? samples[0]!}».slice → ${(samples.find(p.bad) ?? samples[0]!).replace(/\n+/g, ' ').slice(0, 150)}`);
    }
  }
})();
