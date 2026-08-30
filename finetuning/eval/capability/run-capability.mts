// ============================================================================
// run-capability.mts — the Hiraia CAPABILITY benchmark runner.
//
// Unlike run-eval.mts (a green/red regression gate), this SCORES a model 0–5 on
// 5 dimensions across hard, seeded probes — measuring how *good* the tutor is,
// not whether it regressed. See README.md / rubric.md.
//
// Two phases, decoupled so judging can use the subscription (not the API):
//
//   PHASE 1 (answers): runs every probe through a llama-server (base GGUF +
//     adapter — the device-equivalent engine), using the EXACT runtime prompt
//     the app builds (RagStore retrieval + static system + grounding on the user
//     turn). Writes capability-answers.<tag>.json.
//
//   PHASE 2 (judge): scores each answer against rubric.md.
//       - DEFAULT: emits the answers bundle and prints the instruction to score
//         it with the judging workflow (Claude subscription, no API key).
//       - JUDGE_ENDPOINT set: scores inline via an OpenAI-compatible chat endpoint
//         (a bigger local model, or an API judge if you choose to use one).
//     Either way, final scores land in capability-scores.<tag>.json and a report
//     prints: Capability Score + per-tier + per-dimension + (optional) a diff vs
//     a baseline scores file (BASELINE=...).
//
// Usage:
//   # device temp (the real experience) — abstention is stochastic, so sample:
//   ENDPOINT=http://localhost:8088 TEMP=0.7 SAMPLES=3 \
//     node_modules/.bin/tsx finetuning/eval/capability/run-capability.mts
//
//   # inline judge via a local OpenAI-compatible endpoint:
//   JUDGE_ENDPOINT=http://localhost:9099 JUDGE_MODEL=qwen2.5-14b ... run-capability.mts
//
//   # score a pre-judged bundle and diff against a saved baseline:
//   PHASE=report BASELINE=capability-scores.current.json ... run-capability.mts
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RagStore, SemanticIndex, normalizeQuery, buildContextualQuery } from '../../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../../packages/shared/src/rag/bankFile.ts';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../../packages/shared/src/prompts/system.ts';
import { presentation, repeatedImagesAcrossTurns } from '../presentation.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const TAG = process.env.ADAPTER_TAG ?? 'tagalog'; // which adapter is loaded on ENDPOINT
const TEMP = Number(process.env.TEMP ?? '0.7'); // device runs hot; capability is about typical behavior
const SAMPLES = Math.max(1, Number(process.env.SAMPLES ?? '1')); // >1 → keep the WORST per probe (device honesty)
const PHASE = process.env.PHASE ?? 'all'; // all | answers | judge | report
const JUDGE_ENDPOINT = process.env.JUDGE_ENDPOINT ?? '';
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? '';
const BASELINE = process.env.BASELINE ?? '';
// DEVICE-FAITHFUL retrieval: the phone uses retrieveForGroundingHybrid (lexical + LaBSE
// semantic), so the benchmark must too (FINDINGS F7). Embed each probe query via the
// LaBSE service (labse-embed-service.py, the device-equivalent raw-CLS) + attach the
// bundled vector blob. If the embedder is down, fall back to lexical-only with a loud warn.
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const ROOT = join(HERE, '../../..');
const VEC_META = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json');
const VEC_BIN = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin');

const LANG_OK = { tl: 'tagalog', bis: 'cebuano', en: 'english' } as const;
const DIMS = ['accuracy', 'helpfulness', 'faithfulness', 'naturalness', 'pedagogy'] as const;
type Dim = (typeof DIMS)[number];

interface Probe {
  id: string; tier: string; lang: keyof typeof LANG_OK; grade: number;
  prompt: string; intent: string; must_answer: boolean;
  must_cover: string[]; dimensions_emphasis: Dim[];
  // MULTI-TURN probes (tier 'multi-turn'): scripted student turns, played sequentially.
  // prompt === turns[0] (kept for filters/display). The judge scores the whole transcript.
  turns?: string[];
}
const isMultiTurn = (p: Probe) => !!p.turns && p.turns.length > 1;
interface Scored { accuracy: number; helpfulness: number; faithfulness: number; naturalness: number; pedagogy: number; notes: string }
// `answer` is the DISPLAYED text (image tags stripped) — what the judge scores. `raw`/`rawTurns`
// keep the model's literal output (tags intact) so the objective presentation metrics
// (illustration restraint, emoji, bold — see ../presentation.mts) can be measured. rawTurns is
// the per-turn raw reply list for multi-turn probes (enables the cross-turn image-repeat check).
interface AnswerRow { probe: Probe; answer: string; retrievedIds: string[]; samples: string[]; raw?: string; rawTurns?: string[] }
interface ScoreRow extends AnswerRow { score: Scored }

const cfg = JSON.parse(readFileSync(join(HERE, 'probes.json'), 'utf8')) as {
  _meta: { tier_weights: Record<string, number> };
  probes: Probe[];
};
const TIER_W = cfg._meta.tier_weights;
// The device loads a PER-LANGUAGE adapter, so each pass scores only the probes whose
// language matches the adapter currently on ENDPOINT. ADAPTER_TAG drives both the
// language filter and the output filename. (all = single-adapter quick run, no filter.)
const TAG_LANGS: Record<string, (keyof typeof LANG_OK)[]> = {
  tagalog: ['tl'], bisaya: ['bis'], english: ['en'], all: ['tl', 'bis', 'en'],
};
const PASS_LANGS = TAG_LANGS[TAG] ?? ['tl', 'en', 'bis'];
// Optional focused run: CASES="photosynthesis,ice-float" runs only probes whose id
// contains one of the comma-separated substrings (smoke tests, single-failure probing).
const CASE_FILTER = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PASS_PROBES = cfg.probes
  .filter((p) => PASS_LANGS.includes(p.lang))
  .filter((p) => !CASE_FILTER.length || CASE_FILTER.some((s) => p.id.includes(s)));
const ANSWERS_FILE = join(HERE, `capability-answers.${TAG}.json`);
const SCORES_FILE = join(HERE, `capability-scores.${TAG}.json`);
const stripTags = (s: string) => s.replace(/\s*\[image:[^\]]*\]/gi, '').trim();

// USE_LORA=0 for the ENGLISH pass — English uses the BASE model on-device (no adapter,
// per model.ts), so the server is booted WITHOUT --lora and we must not send the lora param.
const USE_LORA = process.env.USE_LORA !== '0';

// ---- model call (mirrors run-eval.mts: static system + grounding on user turn) ----
async function ask(messages: { role: string; content: string }[], temp: number): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages, temperature: temp, max_tokens: 360, stream: false,
      ...(temp > 0 ? { seed: -1 } : {}),
      ...(USE_LORA ? { lora: [{ id: 0, scale: 1.0 }] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`server error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content ?? '';
}

// ---- device-faithful HYBRID retrieval helpers (FINDINGS F7) ----
// Attach the bundled int8 LaBSE vector blob so retrieveForGroundingHybrid can semantic-rerank,
// exactly as LocalEngine does on the phone. Returns false if the blob is missing OR STALE (the
// size guard throws when blob.count != bank — e.g. mid-deepening before build-vectors.py reruns).
// The device catches the same stale-blob case and falls back to lexical; we mirror that here
// instead of crashing the run.
function attachSemantic(store: RagStore): boolean {
  if (!existsSync(VEC_META) || !existsSync(VEC_BIN)) return false;
  try {
    const meta = JSON.parse(readFileSync(VEC_META, 'utf8'));
    const bytes = readFileSync(VEC_BIN);
    store.attachSemantic(new SemanticIndex({
      dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs,
      data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    }), meta.bankHash);
    return true;
  } catch (e) {
    console.warn(`>> ⚠️  semantic blob unusable (${(e as Error).message}) — lexical fallback. Regen build-vectors.py.`);
    return false;
  }
}
// Embed normalize(query) via the LaBSE service + L2-normalize (device embdNormalize:2),
// matching gen-hybrid-fixtures.mts. Returns undefined if the embedder is unreachable.
// raw=true skips normalizeQuery — used for the R2 contextual re-embed, where the device
// embeds buildContextualQuery() output as-is (LocalEngine.ragSearch).
async function embedQuery(text: string, raw = false): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: raw ? text : normalizeQuery(text) }),
    });
    if (!res.ok) return undefined;
    const v: number[] = (await res.json()).data[0].embedding;
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  } catch { return undefined; }
}

// Concurrency for model calls. DEFAULT 1 (sequential) — measured: continuous batching
// gives NO local speedup on a single Metal GPU (it's compute-bound; np>1 was ~10% SLOWER,
// see FINDINGS F3). CONC>1 only helps on a LATENCY-bound backend (cloud GPU with spare
// compute), paired with llama-server `-np <CONC> --cont-batching`. For fast LOCAL iteration,
// drop SAMPLES instead. Retrieval stays sequential (fast CPU); only generations are pooled.
const CONC = Math.max(1, Number(process.env.CONC ?? '1'));

// Run `tasks` with at most `limit` in flight; preserves no order (results carry their index).
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

async function collectAnswers(): Promise<AnswerRow[]> {
  // loadFactSource stamps the store with md5(science-facts.jsonl)[:12] so attachSemantic can
  // reject a blob built for a different bank of the SAME size (facts edited in place).
  const store = new RagStore(loadFactSource());
  // DEVICE-FAITHFUL retrieval: attach the LaBSE blob + embed each query so we use the
  // SAME hybrid path as the phone (FINDINGS F7). Fall back to lexical-only with a loud
  // warning if the blob or embedder is unavailable — the run is then NOT device-faithful.
  const hasSemantic = attachSemantic(store);
  const probe0 = await embedQuery(PASS_PROBES[0]?.prompt ?? 'test');
  const hybrid = hasSemantic && !!probe0;
  if (hybrid) console.log(`>> retrieval: HYBRID (lexical + LaBSE semantic, embedder ${EMBED_ENDPOINT}) — device-faithful`);
  else console.log(`>> ⚠️  retrieval: LEXICAL-ONLY — NOT device-faithful (semantic=${hasSemantic}, embedder=${!!probe0}). Boot the embedder (run-capability.sh does) for a faithful run.`);

  const singleProbes = PASS_PROBES.filter((p) => !isMultiTurn(p));
  const multiProbes = PASS_PROBES.filter(isMultiTurn);

  // ---- MULTI-TURN dialogue runner (tier 'multi-turn') ----
  // Plays the scripted student turns sequentially, mirroring chatStore.sendMessage exactly:
  //   - rag context = previous 2 RAW turns (chatStore's priorTurns slice(-3,-1))
  //   - seenIds dedup across turns (shownFactIds — "prefer fresh facts")
  //   - R2 contextual re-embed when a bare follow-up retrieves nothing (LocalEngine.ragSearch)
  //   - grounding injected ONLY into the current user turn; history keeps the raw turns
  // Turn N's retrieval context contains the model's turn N-1 answer, so a dialogue cannot
  // be prebuilt — it runs sequentially; dialogues themselves go through the pool.
  async function runDialogue(p: Probe, hybrid: boolean): Promise<{ text: string; ids: string[]; rawTurns: string[] }> {
    const lang = LANG_OK[p.lang];
    const system = generateSystemPrompt(lang as any, p.grade as any, true);
    const history: { role: string; content: string }[] = [];
    const seen = new Set<string>();
    const ids: string[] = [];
    const lines: string[] = [];
    const rawTurns: string[] = []; // per-turn RAW tutor reply (tags intact) for the image-repeat check
    for (const turn of p.turns!) {
      const ctx = history.slice(-2).map((m) => m.content).join(' ');
      const qvec = hybrid ? await embedQuery(turn) : undefined;
      let hits = store.retrieveForGroundingHybrid(turn as any, qvec, lang as any, 3, 0.5, ctx, seen);
      if (!hits.length && qvec && ctx.trim()) {
        const folded = await embedQuery(buildContextualQuery(turn, ctx), true);
        if (folded) hits = store.retrieveForGroundingHybrid(turn as any, folded, lang as any, 3, 0.5, ctx, seen);
      }
      for (const h of hits as any[]) { seen.add(h.fact.id); ids.push(h.fact.id); }
      const block = formatGroundingBlock(
        hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } }))
      );
      const rawReply = await ask(
        [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: composeGroundedUserTurn(block, turn) },
        ],
        TEMP
      );
      rawTurns.push(rawReply);
      const answer = stripTags(rawReply);
      history.push({ role: 'user', content: turn }, { role: 'assistant', content: answer });
      lines.push(`STUDENT: ${turn}`, `TUTOR: ${answer}`);
    }
    return { text: lines.join('\n\n'), ids, rawTurns };
  }

  // 1. Build every prompt up front. Retrieval needs the query embedding (async), so embed first.
  const built = await Promise.all(singleProbes.map(async (p) => {
    const lang = LANG_OK[p.lang]; // RagStore/generateSystemPrompt take the full Language, not the short code
    const qvec = hybrid ? await embedQuery(p.prompt) : undefined;
    const hits = store.retrieveForGroundingHybrid(p.prompt as any, qvec, lang as any, 3, 0.5);
    const system = generateSystemPrompt(lang as any, p.grade as any, true);
    const block = formatGroundingBlock(
      hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } }))
    );
    const messages = [{ role: 'system', content: system }, { role: 'user', content: composeGroundedUserTurn(block, p.prompt) }];
    return { p, retrievedIds: hits.map((h: any) => h.fact.id), messages };
  }));
  // 2. Flatten to (probe, sample) generation tasks and run them through the pool so
  //    continuous batching can overlap them. SAMPLES draws per probe.
  const jobs: { bi: number }[] = [];
  for (let bi = 0; bi < built.length; bi++) for (let s = 0; s < SAMPLES; s++) jobs.push({ bi });
  let done = 0;
  const results = await pool(
    jobs.map((j) => async () => {
      const raw = await ask(built[j.bi].messages, TEMP); // keep RAW (tags intact) for presentation metrics
      process.stdout.write(`  [${++done}/${jobs.length}] ${built[j.bi].p.id}\n`);
      return { bi: j.bi, raw };
    }),
    CONC
  );
  // 3. Regroup samples per probe (original order), pick the WORST sample so a model that
  //    *sometimes* deflects on-device is scored on that failure, not its best face. Selection
  //    is on the DISPLAYED text; carry the matching RAW so presentation metrics see the tags.
  const byProbeRaw: string[][] = built.map(() => []);
  for (const r of results) byProbeRaw[r.bi].push(r.raw);
  const rows: AnswerRow[] = built.map((b, bi) => {
    const rawSamples = byProbeRaw[bi];
    const samples = rawSamples.map(stripTags);
    let pick = samples.findIndex((s) => /tanungin|guro|hindi ko (?:po )?(?:alam|masabi)|ask your (?:teacher|parent)/i.test(s));
    if (pick < 0) {
      pick = samples.length ? samples.reduce((best, s, i) => (s.length < samples[best].length ? i : best), 0) : -1;
    }
    return { probe: b.p, answer: samples[pick] ?? '', raw: rawSamples[pick] ?? '', retrievedIds: b.retrievedIds, samples };
  });

  // 4. Multi-turn dialogues: each SAMPLE is one full dialogue run. Pooled at the
  //    dialogue level (turns within a dialogue are inherently sequential).
  if (multiProbes.length) {
    const mJobs = multiProbes.flatMap((p) => Array.from({ length: SAMPLES }, () => p));
    let mDone = 0;
    const mResults = await pool(
      mJobs.map((p) => async () => {
        const r = await runDialogue(p, hybrid);
        process.stdout.write(`  [mt ${++mDone}/${mJobs.length}] ${p.id}\n`);
        return { p, ...r };
      }),
      CONC
    );
    for (const p of multiProbes) {
      const runs = mResults.filter((r) => r.p.id === p.id);
      const texts = runs.map((r) => r.text);
      // worst-of-N: a transcript containing a refusal beats length as the honest pick
      const refusalish = texts.find((s) => /tanungin|guro|hindi ko (?:po )?(?:alam|masabi)|ask your (?:teacher|parent)/i.test(s));
      const answer = refusalish ?? texts.slice().sort((a, b2) => a.length - b2.length)[0] ?? '';
      const sel = runs.find((r) => r.text === answer) ?? runs[0]; // carry the selected run's per-turn raw
      rows.push({ probe: p, answer, retrievedIds: [...new Set(runs.flatMap((r) => r.ids))], samples: texts, rawTurns: sel?.rawTurns ?? [] });
    }
  }

  writeFileSync(ANSWERS_FILE, JSON.stringify(rows, null, 2));
  console.log(`\n>> wrote ${rows.length} answers (${jobs.length} single-turn generations + ${multiProbes.length * SAMPLES} dialogues, conc ${CONC}) → ${ANSWERS_FILE}`);
  return rows;
}

// ---- inline judge (only when JUDGE_ENDPOINT set) ----
const RUBRIC = readFileSync(join(HERE, 'rubric.md'), 'utf8');
function judgePrompt(r: AnswerRow): string {
  const p = r.probe;
  const mt = isMultiTurn(p);
  const body = mt
    ? `=== DIALOGUE (multi-turn; STUDENT turns were scripted, every TUTOR turn is the model under test) ===\n${r.answer || '(empty)'}\n\n` +
      `This is a MULTI-TURN probe: score the TUTOR's conduct across the WHOLE dialogue, per the ` +
      `rubric's "Multi-turn dialogue probes" section. Hard caps: re-delivering an earlier answer ` +
      `near-verbatim caps pedagogy at 1; asking the student a question they already answered (or ` +
      `re-asking the tutor's own earlier question) caps helpfulness at 1.`
    : `QUESTION: ${p.prompt}\n\n=== MODEL ANSWER ===\n${r.answer || '(empty)'}`;
  return (
    `You are the impartial judge for the Hiraia tutor capability benchmark. Score the MODEL ANSWER ` +
    `0–5 on each of: accuracy, helpfulness, faithfulness, naturalness, pedagogy. Use the rubric exactly. ` +
    `Output ONLY strict JSON: {"accuracy":n,"helpfulness":n,"faithfulness":n,"naturalness":n,"pedagogy":n,"notes":"..."}.\n\n` +
    `=== RUBRIC ===\n${RUBRIC}\n\n` +
    `=== PROBE ===\nlang: ${LANG_OK[p.lang]} | grade: ${p.grade} | tier: ${p.tier}\n` +
    `must_answer: ${p.must_answer}\nintent: ${p.intent}\nmust_cover: ${p.must_cover.join('; ')}\n` +
    `${body}\n\n` +
    `Score now. JSON only.`
  );
}
async function judgeInline(r: AnswerRow): Promise<Scored> {
  const res = await fetch(`${JUDGE_ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(JUDGE_MODEL ? { model: JUDGE_MODEL } : {}),
      messages: [{ role: 'user', content: judgePrompt(r) }],
      temperature: 0, max_tokens: 250, stream: false,
    }),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data: any = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const m = raw.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : '{}');
  return {
    accuracy: +j.accuracy || 0, helpfulness: +j.helpfulness || 0, faithfulness: +j.faithfulness || 0,
    naturalness: +j.naturalness || 0, pedagogy: +j.pedagogy || 0, notes: String(j.notes ?? ''),
  };
}

// ---- aggregation + report ----
function probeScore(s: Scored, emphasis: Dim[]): number {
  // dimension mean with the probe's emphasis dimensions double-weighted
  let num = 0, den = 0;
  for (const d of DIMS) {
    const w = emphasis.includes(d) ? 2 : 1;
    num += s[d] * w; den += w;
  }
  return num / den;
}
function report(rows: ScoreRow[], baseline?: ScoreRow[]) {
  const byTier: Record<string, number[]> = {};
  const byDim: Record<Dim, number[]> = { accuracy: [], helpfulness: [], faithfulness: [], naturalness: [], pedagogy: [] };
  let wNum = 0, wDen = 0;
  const helpAnswerable: number[] = [];
  for (const r of rows) {
    const ps = probeScore(r.score, r.probe.dimensions_emphasis);
    const tw = TIER_W[r.probe.tier] ?? 1;
    wNum += ps * tw; wDen += tw;
    (byTier[r.probe.tier] ??= []).push(ps);
    for (const d of DIMS) byDim[d].push(r.score[d]);
    if (r.probe.must_answer) helpAnswerable.push(r.score.helpfulness);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const cap = wNum / wDen;
  console.log(`\n================  HIRAIA CAPABILITY SCORE (${TAG})  ================`);
  console.log(`  CAPABILITY SCORE: ${cap.toFixed(2)} / 5   (tier-weighted, ${rows.length} probes)`);
  console.log(`  helpfulness on answerable probes: ${mean(helpAnswerable).toFixed(2)} / 5   <-- over-abstention metric`);
  console.log(`\n  per dimension:`);
  for (const d of DIMS) console.log(`    ${d.padEnd(13)} ${mean(byDim[d]).toFixed(2)}`);
  console.log(`\n  per tier (weight):`);
  for (const t of Object.keys(TIER_W)) {
    if (!byTier[t]) continue;
    console.log(`    ${t.padEnd(18)} ${mean(byTier[t]).toFixed(2)}   (w ${TIER_W[t]}, n ${byTier[t].length})`);
  }
  if (baseline) {
    const bMap = new Map(baseline.map((r) => [r.probe.id, r]));
    let bNum = 0, bDen = 0;
    for (const r of baseline) { const tw = TIER_W[r.probe.tier] ?? 1; bNum += probeScore(r.score, r.probe.dimensions_emphasis) * tw; bDen += tw; }
    const bCap = bNum / bDen;
    console.log(`\n  vs baseline: ${bCap.toFixed(2)} → ${cap.toFixed(2)}  (${cap >= bCap ? '+' : ''}${(cap - bCap).toFixed(2)})`);
    // biggest movers
    const movers = rows
      .map((r) => ({ id: r.probe.id, tier: r.probe.tier, d: probeScore(r.score, r.probe.dimensions_emphasis) - (bMap.has(r.probe.id) ? probeScore(bMap.get(r.probe.id)!.score, r.probe.dimensions_emphasis) : 0) }))
      .filter((m) => bMap.has(m.id))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 6);
    console.log(`  biggest movers:`);
    for (const m of movers) console.log(`    ${m.d >= 0 ? '+' : ''}${m.d.toFixed(2)}  ${m.id} (${m.tier})`);
  }

  // ---- v3 PRESENTATION METRICS (objective, deterministic — no judge; ../presentation.mts) ----
  // Measures v3's targets directly so every run reports them: illustration restraint (image-tag
  // emission + well-formedness + no cross-turn repeat) and engagement (emoji presence/spam, bold).
  // Computed from the RAW reply (tags intact); falls back to the displayed text for score files
  // written before raw was captured (emoji/bold still valid there; image rates read as 0).
  const presStats = (rs: ScoreRow[]) => {
    const single = rs.filter((r) => !isMultiTurn(r.probe));
    let withTag = 0, wellFormed = 0, emojiPresent = 0, emojiSpam = 0, bold = 0;
    for (const r of single) {
      const p = presentation(r.raw ?? r.answer);
      if (p.imageTags > 0) { withTag++; if (p.imageWellFormed) wellFormed++; }
      if (p.emojiPresent) emojiPresent++;
      if (p.emojiSpam) emojiSpam++;
      if (p.bold) bold++;
    }
    const multi = rs.filter((r) => isMultiTurn(r.probe) && (r.rawTurns?.length ?? 0) > 0);
    const repeated = multi.filter((r) => repeatedImagesAcrossTurns(r.rawTurns!).length > 0).length;
    return { n: single.length, withTag, wellFormed, emojiPresent, emojiSpam, bold, dlg: multi.length, repeated };
  };
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
  const ps = presStats(rows);
  const bs = baseline ? presStats(baseline) : undefined;
  const cmp = (n: number, d: number, bn?: number, bd?: number) =>
    `${pct(n, d)}${bs ? `  (was ${pct(bn!, bd!)})` : ''}`;
  console.log(`\n  presentation (objective — v3 targets; ${ps.n} single-turn, ${ps.dlg} dialogues):`);
  console.log(`    image-tag emission   ${cmp(ps.withTag, ps.n, bs?.withTag, bs?.n)}`);
  console.log(`    image well-formed    ${cmp(ps.wellFormed, ps.withTag, bs?.wellFormed, bs?.withTag)}  (of tag-bearing replies; ≤1 + non-empty)`);
  console.log(`    image repeat (multi) ${cmp(ps.repeated, ps.dlg, bs?.repeated, bs?.dlg)}  (lower is better)`);
  console.log(`    emoji present        ${cmp(ps.emojiPresent, ps.n, bs?.emojiPresent, bs?.n)}`);
  console.log(`    emoji spam (>${4})       ${cmp(ps.emojiSpam, ps.n, bs?.emojiSpam, bs?.n)}  (lower is better)`);
  console.log(`    bold formatting      ${cmp(ps.bold, ps.n, bs?.bold, bs?.n)}`);
  console.log(`==================================================================\n`);
}

// ---- orchestration ----
const baseline = BASELINE && existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as ScoreRow[]) : undefined;

if (PHASE === 'report') {
  // Merge EVERY per-adapter score file (capability-scores.tagalog.json + .bisaya.json + …)
  // into one 102-probe Capability Score. Dedup by probe id (last file wins).
  const files = readdirSync(HERE).filter((f) => /^capability-scores\..+\.json$/.test(f));
  if (!files.length) { console.error(`no capability-scores.*.json in ${HERE} — run judge first`); process.exit(2); }
  const merged = new Map<string, ScoreRow>();
  for (const f of files) for (const r of JSON.parse(readFileSync(join(HERE, f), 'utf8')) as ScoreRow[]) merged.set(r.probe.id, r);
  console.log(`>> merged ${files.length} score file(s): ${files.join(', ')}`);
  report([...merged.values()], baseline);
} else {
  const answers = PHASE === 'judge'
    ? (JSON.parse(readFileSync(ANSWERS_FILE, 'utf8')) as AnswerRow[])
    : await collectAnswers();

  if (PHASE === 'answers') {
    console.log(`\n>> answers only. Judge them with the subscription via the judging workflow,`);
    console.log(`   or re-run with JUDGE_ENDPOINT=... PHASE=judge for an inline judge.\n`);
  } else if (JUDGE_ENDPOINT) {
    const scored: ScoreRow[] = [];
    for (const a of answers) { scored.push({ ...a, score: await judgeInline(a) }); process.stdout.write(`  judged ${a.probe.id}\n`); }
    writeFileSync(SCORES_FILE, JSON.stringify(scored, null, 2));
    console.log(`>> wrote scores → ${SCORES_FILE}`);
    report(scored, baseline);
  } else {
    console.log(`\n>> No JUDGE_ENDPOINT set. Answers are in ${ANSWERS_FILE}.`);
    console.log(`>> To score with the Claude subscription (no API key), run the judging workflow:`);
    console.log(`     one judge agent per answer, prompt = rubric.md + probe + answer → strict-JSON Scored,`);
    console.log(`     then write capability-scores.${TAG}.json (array of {probe, answer, score}) and re-run`);
    console.log(`     this script with PHASE=report to print the Capability Score + tier/dim breakdown.\n`);
  }
}
