// ============================================================================
// run-eval.mts — the FORMAL behavioral gate for the on-device CARD WRITER.
//
// The model is no longer a conversational tutor. It is a single-turn card writer: given a
// child's typed topic plus retrieved grounding it prints ONE card-shaped fact in their
// language at their grade, and stops. So this gate no longer builds a system prompt, a
// grounding block or a conversation — it runs the CARD PATH, end to end, exactly as the two
// engines that ship it do:
//
//   1. ROUTE (model-free). The same context-free hybrid retrieval + `isOffDomain` split that
//      LocalEngine.answerQuery and server/rag.ts `retrieveForCard` make, at topK 4, deciding
//      one of three card shapes: grounded / in-domain gap / off-domain. Two of the three never
//      touch the model, and nothing before now tested that "roblox" yields no card at all.
//   2. PRINT (grounded only). `buildCardPrompt` from @hiraia/shared — the SAME prompt string
//      the phone and hiraia.org send — at CARD_TEMP, with the stop sequence and the
//      thinking-disable kwarg the card routes use, then `sanitizeCardAnswer`.
//   3. ASSERT. Universal card-shape invariants (../cardshape.mts) on every sample, plus the
//      per-case content assertions in cases.json.
//
// ZERO TOLERANCE: there is no `pending` mechanism. A case is blocking or it is deleted.
//
// TEMPERATURE: the gate runs at the temperature the PRODUCT runs at (CARD_TEMP = 0.3), not at
// 0. A temp-0 gate is blind to exactly the stochastic branch a child hits, so every case is
// drawn SAMPLES times and must pass on every draw; the report also prints how much the card
// varied, which is the number to watch release over release.
//
//   run via run-harness.sh (which boots the model + the embedder). Standalone:
//   ENDPOINT=http://localhost:8088 EMBED_ENDPOINT=http://localhost:8090 \
//     node_modules/.bin/tsx run-eval.mts
//
// Env: SAMPLES (default 3), TEMP (default CARD_TEMP), CASES (substring id filter),
//      MAX_TOKENS (default CARD_MAX_TOKENS, the web route's), LORA_SCALE (send a `lora` array),
//      JSON_OUT (dump the full run for a diff against the next one).
// ============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  isOffDomain,
} from '../../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../../packages/shared/src/rag/bankFile.ts';
import {
  buildCardPrompt,
  sanitizeCardAnswer,
  CARD_TEMP,
  CARD_STOP,
  CARD_MAX_TOKENS,
  CARD_REASONING_BUDGET,
} from '../../../packages/shared/src/prompts/cards.ts';
import {
  cardShapeViolations,
  groundednessMiss,
  meanWordLength,
  rawGenerationDefects,
  wordCount,
  type CardLanguage,
} from '../cardshape.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const TEMP = Number(process.env.TEMP ?? String(CARD_TEMP));
const SAMPLES = Math.max(1, Number(process.env.SAMPLES ?? '3'));
/** The product's runaway backstop (@hiraia/shared CARD_MAX_TOKENS — the web route sends the
 * same constant). It only bounds a runaway — the prompt caps the card at 30 words. */
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? String(CARD_MAX_TOKENS));
/** Retrieval width for a card. LocalEngine.answerQuery and retrieveForCard both use 4. */
const CARD_TOPK = 4;
const CASE_FILTER = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

type Outcome = 'grounded' | 'gap' | 'offdomain';

interface Case {
  id: string;
  tier: string;
  lang: CardLanguage;
  grade: number;
  query: string;
  expectOutcome?: Outcome;
  expectRetrieves?: string;
  mustRetrieveIdIncludes?: string[];
  mustContain?: string[];
  mustNotContain?: string[];
  maxWords?: number;
  gradePairWith?: number;
  samples?: number;
  skipGeneration?: boolean;
  /**
   * Exempt this case from the universal groundedness check. NOT a tolerance flag — it is a
   * statement that for this case groundedness is not the contract. The only legitimate use is
   * a MYTH CORRECTION whose facts the bank cannot supply: "totoo po bang patag ang mundo?"
   * retrieves Fe del Mundo and a moon fact ('patag' is semantically opposite to every
   * round-earth fact), and the case's own mustContain REQUIRES the model to answer "bilog"
   * from parametric memory anyway, because telling a child the earth might be flat is worse
   * than an ungrounded card. Every use must carry a `_why_allowUngrounded` note.
   */
  allowUngrounded?: boolean;
}

const cfg = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as { cases: Case[] };
const cases = cfg.cases.filter((c) => !CASE_FILTER.length || CASE_FILTER.some((s) => c.id.includes(s)));

// ---------------------------------------------------------------------------------------
// Retrieval — the device path. The store is built over the JSONL source of truth (stamped
// with md5(bank)[:12], which is what lets attachSemantic reject a blob built for a DIFFERENT
// bank of the same size) and the bundled int8 LaBSE blob.
// ---------------------------------------------------------------------------------------
const store = new RagStore(loadFactSource());

function attachSemantic(): void {
  const META = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json');
  const BIN = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin');
  if (!existsSync(META) || !existsSync(BIN)) {
    fatal(`vectors blob missing (${BIN}) — the card gate cannot run without semantic retrieval.`);
  }
  const meta = JSON.parse(readFileSync(META, 'utf8'));
  const bytes = readFileSync(BIN);
  store.attachSemantic(
    new SemanticIndex({
      dims: meta.dims,
      scale: meta.scale,
      count: meta.count,
      langs: meta.langs,
      data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    }),
    meta.bankHash
  );
  console.log(`>> bank: ${meta.count} facts × ${meta.langs.join('/')} (hash ${meta.bankHash})`);
}

function fatal(msg: string): never {
  console.error(`ERR: ${msg}`);
  process.exit(2);
}

async function embedQuery(text: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'labse' }),
    });
    if (!res.ok) return undefined;
    const v: number[] = (await res.json()).data[0].embedding;
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  } catch {
    return undefined;
  }
}

/**
 * The three-way card routing, byte-for-byte the decision `retrieveForCard` (web) and
 * `LocalEngine.answerQuery` (mobile) make — same topK, same context-free retrieval, same gate
 * ORDER, same `isOffDomain`, same spelling probe behind `lexEmpty`.
 *
 * Duplicated here rather than imported because the two production copies live in
 * packages/web (Next server code) and packages/mobile (QVAC bindings) and neither is
 * importable from Node — but the two floors and the gate itself DO come from @hiraia/shared,
 * so the thing most likely to drift (the numbers) cannot.
 */
async function route(query: string, lang: CardLanguage) {
  const qvec = await embedQuery(normalizeQuery(query));
  const semantic = !!qvec;
  const r = store.retrieveForGroundingHybridDiag(query, qvec, lang as any, CARD_TOPK, 0.5, '');
  const unreachable = semantic && r.lexEmpty && store.lexicallyUnreachable(query, lang as any);
  let outcome: Outcome = 'grounded';
  if (semantic && isOffDomain(r.topCos, unreachable)) outcome = 'offdomain';
  else if (semantic && r.lexEmpty) outcome = 'gap';
  else if (!r.hits.length) outcome = 'gap';
  return {
    outcome,
    hits: r.hits,
    ids: r.hits.map((h: any) => h.fact.id as string),
    facts: r.hits.map((h: any) => h.text as string),
    topCos: r.topCos,
    lexEmpty: r.lexEmpty,
    unreachable,
    semantic,
  };
}

// ---------------------------------------------------------------------------------------
// Generation — the card request, identical to the web route's.
// ---------------------------------------------------------------------------------------
interface Draw {
  /** The model's `content`, raw. */
  content: string;
  /** Non-empty only when thinking was NOT disabled (the trap this gate exists to catch). */
  reasoning: string;
  finishReason: string;
  /** The card the app would print, or null when `sanitizeCardAnswer` rejects it. */
  card: string | null;
  /** Health problems found before any content assertion ran. */
  health: string[];
}

async function printCard(instruction: string): Promise<Draw> {
  const health: string[] = [];
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: instruction }],
    stream: false,
    temperature: TEMP,
    max_tokens: MAX_TOKENS,
    // A card is ONE paragraph. Both knobs come from @hiraia/shared (prompts/cards.ts), the
    // same constants the web route sends and the same ones LocalEngine feeds to QVAC — so a
    // green verdict cannot be certifying request options only one of the three paths uses.
    stop: [...CARD_STOP],
    // Qwen3.5 is a THINKING model: unless thinking is disabled it puts the answer in
    // `reasoning_content` and returns an EMPTY `content`, so every card reads as a failure.
    // llama-server ignores unknown kwargs, so this is safe against a non-thinking server too.
    chat_template_kwargs: { enable_thinking: CARD_REASONING_BUDGET !== 0 },
    // Vary the draws at sampling temperature; pin them when someone runs the gate at 0.
    seed: TEMP > 0 ? -1 : 0,
  };
  if (process.env.LORA_SCALE) body.lora = [{ id: 0, scale: Number(process.env.LORA_SCALE) }];

  let data: any;
  try {
    const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      health.push(`request: HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`);
      return { content: '', reasoning: '', finishReason: '', card: null, health };
    }
    data = await res.json();
  } catch (e: any) {
    health.push(`request: ${e.message}`);
    return { content: '', reasoning: '', finishReason: '', card: null, health };
  }
  if (data.error) {
    health.push(`server error: ${JSON.stringify(data.error).slice(0, 160)}`);
    return { content: '', reasoning: '', finishReason: '', card: null, health };
  }

  const choice = data.choices?.[0] ?? {};
  const content: string = choice.message?.content ?? '';
  const reasoning: string = choice.message?.reasoning_content ?? '';
  const finishReason: string = choice.finish_reason ?? '';

  // GENERATION HEALTH — the two live bugs nothing in the old gate could see.
  if (!content.trim()) {
    health.push(
      reasoning.trim()
        ? 'generation: EMPTY `content` with a non-empty `reasoning_content` — thinking was not ' +
          'disabled, every card would come back blank and fall through to the gap card'
        : 'generation: empty `content`'
    );
  }
  if (finishReason && finishReason !== 'stop') {
    health.push(
      `generation: finish_reason '${finishReason}' (expected 'stop') — the card ran to the token ` +
        'cap instead of ending, which is the repetition signature'
    );
  }
  // Defects the PRODUCT sanitizer now removes. Asserted on the raw `content` so that
  // defending the child (sanitizeCardAnswer strips `</think>` and `[image: …]`) does not also
  // hide the model regressing into emitting them.
  health.push(...rawGenerationDefects(content));

  return { content, reasoning, finishReason, card: sanitizeCardAnswer(content), health };
}

// ---------------------------------------------------------------------------------------
const rx = (p: string) => new RegExp(p, 'i');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Everything asserted about ONE printed card. */
function assertCard(c: Case, draw: Draw, grade: number, facts: readonly string[]): string[] {
  const fails = [...draw.health];
  if (!draw.card) {
    if (draw.content.trim()) fails.push('sanitizeCardAnswer rejected the generation — nothing printable');
    return fails;
  }
  const card = draw.card;
  fails.push(...cardShapeViolations(card, { lang: c.lang, maxWords: c.maxWords }));
  // Universal, so it cannot be forgotten on a new case: a grounded card that shares no
  // vocabulary at all with what was retrieved was written from parametric memory. Per-case
  // `mustNotContain` lists only catch the wordings someone thought to forbid.
  if (!c.allowUngrounded) {
    const miss = groundednessMiss(card, facts);
    if (miss) fails.push(miss);
  }
  for (const p of c.mustContain ?? []) if (!rx(p).test(card)) fails.push(`mustContain /${p}/ missing`);
  for (const p of c.mustNotContain ?? []) if (rx(p).test(card)) fails.push(`mustNotContain /${p}/ present`);
  return fails.map((f) => (grade === c.grade ? f : `[grade ${grade}] ${f}`));
}

interface Report {
  id: string;
  tier: string;
  lang: string;
  outcome: Outcome;
  expectOutcome: Outcome;
  topCos: number;
  lexEmpty: boolean;
  unreachable: boolean;
  retrieved: string[];
  cards: (string | null)[];
  distinct: number;
  words: number[];
  /**
   * Word count of each RAW `content`, before `sanitizeCardAnswer`'s trim. The printed ceiling
   * is enforced by the product trim now, so `words` alone can no longer see the model
   * over-writing — a model that drifts from ~40-word to ~60-word raw draws prints identical
   * cards while burning the difference in tokens on a ~7 t/s phone. Reported, not asserted:
   * CARD_MAX_TOKENS is the runaway bound, this is the drift dial to watch.
   */
  rawWords: number[];
  fails: string[];
}

console.log(`>> endpoint: ${ENDPOINT}   embedder: ${EMBED_ENDPOINT}`);
console.log(`>> temp: ${TEMP} (product CARD_TEMP=${CARD_TEMP})   samples: ${SAMPLES}   max_tokens: ${MAX_TOKENS}`);
// Say WHICH request shape this run exercised. The knobs are shared constants, but the
// transport is not: this gate speaks the llama-server HTTP shape (`stop` + chat_template_kwargs)
// that hiraia.org uses. The phone reaches the same two decisions through QVAC's load-time
// `reverse_prompt` and per-request `reasoning_budget` (LocalEngine), which no HTTP gate can
// exercise — an on-device smoke test is still the only proof for that path.
console.log(
  `>> request shape: SERVER (stop ${JSON.stringify(CARD_STOP)}, enable_thinking ` +
    `${CARD_REASONING_BUDGET !== 0}) — device equivalents are reverse_prompt + reasoning_budget=` +
    `${CARD_REASONING_BUDGET}, not exercised here`
);
attachSemantic();
if (!(await embedQuery('test'))) {
  fatal(
    `no embedder at ${EMBED_ENDPOINT}. The card gate routes on LaBSE cosines (isOffDomain), so ` +
      'without one every query looks off-domain and the verdict would be meaningless. Boot it ' +
      '(run-harness.sh does) and re-run.'
  );
}
console.log('>> retrieval: HYBRID (device-faithful)\n');

const reports: Report[] = [];
let passed = 0;

for (const c of cases) {
  const expectOutcome: Outcome = c.expectOutcome ?? 'grounded';
  const r = await route(c.query, c.lang);
  const fails: string[] = [];

  // 1) ROUTING — which of the three cards the child gets. Model-free.
  if (r.outcome !== expectOutcome) {
    fails.push(
      `outcome: got '${r.outcome}', expected '${expectOutcome}' ` +
        `(topCos ${r.topCos.toFixed(3)}, lexEmpty ${r.lexEmpty}, unreachable ${r.unreachable})`
    );
  }

  // 2) RETRIEVAL — only meaningful when we expected facts.
  if (expectOutcome === 'grounded') {
    if (c.expectRetrieves && !r.ids.includes(c.expectRetrieves))
      fails.push(`retrieval: expected '${c.expectRetrieves}', got [${r.ids.join(',') || 'none'}]`);
    if (
      c.mustRetrieveIdIncludes &&
      !c.mustRetrieveIdIncludes.some((s) => r.ids.some((id) => id.toLowerCase().includes(s.toLowerCase())))
    )
      fails.push(
        `mustRetrieveIdIncludes: none of [${c.mustRetrieveIdIncludes.join(',')}] in [${r.ids.join(',') || 'none'}]`
      );
  }

  // 3) GENERATION — grounded cases only; the other two card shapes are model-free by design,
  //    which is the whole reason they cannot hallucinate.
  const cards: (string | null)[] = [];
  const words: number[] = [];
  const rawWords: number[] = [];
  const nSamples = c.samples ?? SAMPLES;
  if (expectOutcome === 'grounded' && r.outcome === 'grounded' && !c.skipGeneration) {
    const instruction = buildCardPrompt({ query: c.query, facts: r.facts, grade: c.grade, language: c.lang });
    for (let i = 0; i < nSamples; i++) {
      const draw = await printCard(instruction);
      cards.push(draw.card);
      if (draw.card) words.push(wordCount(draw.card));
      if (draw.content.trim()) rawWords.push(wordCount(draw.content));
      const f = assertCard(c, draw, c.grade, r.facts);
      // Report a failing draw once, tagged with which sample it was — a case that fails 1 of 3
      // is a case a child hits one time in three.
      for (const x of f) fails.push(nSamples > 1 ? `sample ${i + 1}/${nSamples}: ${x}` : x);
    }

    // 4) GRADE REGISTER — grade is a user-visible setting spliced straight into the prompt.
    if (c.gradePairWith != null) {
      const other = c.gradePairWith;
      const pairDraw = await printCard(
        buildCardPrompt({ query: c.query, facts: r.facts, grade: other, language: c.lang })
      );
      cards.push(pairDraw.card);
      if (pairDraw.card) words.push(wordCount(pairDraw.card));
      if (pairDraw.content.trim()) rawWords.push(wordCount(pairDraw.content));
      fails.push(...assertCard(c, pairDraw, other, r.facts));
      const base = cards[0];
      if (base && pairDraw.card) {
        const lowGrade = Math.min(c.grade, other);
        const low = c.grade === lowGrade ? base : pairDraw.card;
        const high = c.grade === lowGrade ? pairDraw.card : base;
        if (norm(low) === norm(high))
          fails.push(`grade-register: identical card at grade ${c.grade} and grade ${other} — the setting is inert`);
        const dLow = meanWordLength(low);
        const dHigh = meanWordLength(high);
        if (dLow > dHigh + 0.5)
          fails.push(
            `grade-register: the lower-grade card is the harder one ` +
              `(mean word length ${dLow.toFixed(2)} at grade ${lowGrade} vs ${dHigh.toFixed(2)} at the higher grade)`
          );
      }
    }
  }

  const distinct = new Set(cards.filter(Boolean).map((s) => norm(s!))).size;
  const ok = fails.length === 0;
  if (ok) passed++;
  reports.push({
    id: c.id, tier: c.tier, lang: c.lang, outcome: r.outcome, expectOutcome,
    topCos: r.topCos, lexEmpty: r.lexEmpty, unreachable: r.unreachable,
    retrieved: r.ids, cards, distinct, words, rawWords, fails,
  });

  const shape = expectOutcome === 'grounded' ? '' : `  → ${r.outcome} card (model-free)`;
  console.log(
    `${ok ? '✅ PASS' : '❌ FAIL'}  ${c.id}  [${c.tier}/${c.lang}]  cos ${r.topCos.toFixed(3)}` +
      `  retrieved: ${r.ids.slice(0, 3).join(', ') || 'none'}${shape}`
  );
  const shown = cards.find(Boolean);
  if (shown) {
    const spread = words.length ? ` (${Math.min(...words)}-${Math.max(...words)} words, ${distinct}/${cards.length} distinct)` : '';
    console.log(`   C: ${shown}${spread}`);
  }
  fails.forEach((f) => console.log(`   ↳ ${f}`));
}

// ---------------------------------------------------------------------------------------
const grounded = reports.filter((r) => r.expectOutcome === 'grounded' && r.cards.some(Boolean));
const allWords = grounded.flatMap((r) => r.words);
console.log(`\n===== ${passed}/${cases.length} passed =====`);
if (allWords.length) {
  const sorted = [...allWords].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const over = allWords.filter((w) => w > 30).length;
  console.log(
    `cards: ${allWords.length} drawn, median ${median} words, max ${sorted[sorted.length - 1]}, ` +
      `${over} over the 30-word ceiling`
  );
  // The RAW draw lengths, before the product trim. The printed ceiling above is enforced by
  // `sanitizeCardAnswer`, so it can no longer reveal the MODEL over-writing — this line is
  // the release-over-release drift dial for that (every raw word is ~2.3 tokens ≈ 150 ms of
  // veil on the phone). Reported, not asserted: verbose-but-well-formed draws are cards the
  // trim saves by design (see CARD_MAX_TOKENS's note rejecting the tighter 96 cap).
  const allRaw = grounded.flatMap((r) => r.rawWords);
  if (allRaw.length) {
    const rSorted = [...allRaw].sort((a, b) => a - b);
    const rMedian = rSorted[Math.floor(rSorted.length / 2)];
    const rOver = allRaw.filter((w) => w > 30).length;
    console.log(
      `raw draws (pre-trim): median ${rMedian} words, max ${rSorted[rSorted.length - 1]}, ` +
        `${rOver}/${allRaw.length} over 30 — the trim, not the model, holds the printed ceiling`
    );
  }
  const varied = grounded.filter((r) => r.distinct > 1).length;
  console.log(
    `variance @ temp ${TEMP}: ${varied}/${grounded.length} cases printed a different card across draws ` +
      '(the gate is not assuming determinism — every draw had to pass)'
  );
}
if (process.env.JSON_OUT) {
  writeFileSync(process.env.JSON_OUT, JSON.stringify({ endpoint: ENDPOINT, temp: TEMP, samples: SAMPLES, reports }, null, 1));
  console.log(`wrote ${process.env.JSON_OUT}`);
}
const failed = reports.filter((r) => r.fails.length);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
console.log('ALL PASS — the card writer is safe to put in front of a child.');
