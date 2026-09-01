/**
 * lib.mts — shared machinery for the SFT v2 CARD data build.
 *
 * Everything the stage scripts (reshape/generate/merge/validate) have in common:
 *   - the REAL runtime retriever (RagStore + LaBSE blob + the embed endpoint) so training
 *     fact-distributions match inference, not a fake surface;
 *   - buildCardPrompt IMPORTED from @hiraia/shared — the training user text is byte-identical
 *     to what the phone and hiraia.org send (a copied string would silently drift);
 *   - the Fireworks client (writer qwen3p7-plus, judge gpt-oss-120b — decorrelated families;
 *     AUP: TL/BIS child-body content is generated AND judged here, never in a Claude context);
 *   - the deterministic linter (cardshape.mts invariants + the v2-specific rules: ≤28-word
 *     target, hedge-openers, forbidden v1 instruction strings);
 *   - resumable caches (append-only JSONL keyed by deterministic row id).
 *
 * NOTHING in this pipeline prints row content to stdout for TL/BIS rows — ids, buckets and
 * reasons only. Content lives in files.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  isOffDomain,
} from '../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../packages/shared/src/rag/bankFile.ts';
import { buildCardPrompt } from '../../packages/shared/src/prompts/cards.ts';
import {
  cardShapeViolations,
  groundednessMiss,
  rawGenerationDefects,
  wordCount,
  type CardLanguage,
} from '../eval/cardshape.mts';

export { buildCardPrompt, normalizeQuery, wordCount, groundednessMiss, cardShapeViolations };
export type { CardLanguage };

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '../..');
export const OUT = join(HERE, 'out');
export const CACHE = join(OUT, 'cache');
mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------------------------------
// Deterministic row identity + seeded sampling
// ---------------------------------------------------------------------------------------
export function rowId(...parts: string[]): string {
  return createHash('sha1').update(parts.join('')).digest('hex').slice(0, 16);
}

/** mulberry32 — deterministic per-row RNG so re-runs make identical choices. */
export function seededRng(seed: string): () => number {
  let a = parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grade sampler — mass at the G5 product default (hiraia-grade5-default). */
const GRADE_WEIGHTS: Array<[number, number]> = [
  [3, 0.1], [4, 0.15], [5, 0.2], [6, 0.2], [7, 0.15], [8, 0.1], [9, 0.05], [10, 0.05],
];
export function sampleGrade(seed: string): number {
  const r = seededRng(seed)();
  let acc = 0;
  for (const [g, w] of GRADE_WEIGHTS) {
    acc += w;
    if (r <= acc) return g;
  }
  return 5;
}

// ---------------------------------------------------------------------------------------
// JSONL io + resumable caches
// ---------------------------------------------------------------------------------------
export function readJsonl<T = any>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export function appendJsonl(path: string, obj: unknown): void {
  appendFileSync(path, JSON.stringify(obj) + '\n');
}

/** Append-only cache keyed by `id` — a re-run skips everything already done. */
export class Cache {
  private map = new Map<string, any>();
  constructor(private path: string) {
    for (const row of readJsonl(path)) this.map.set(row.id, row);
  }
  has(id: string): boolean {
    return this.map.has(id);
  }
  get(id: string): any {
    return this.map.get(id);
  }
  put(id: string, obj: Record<string, unknown>): void {
    const row = { id, ...obj };
    this.map.set(id, row);
    appendJsonl(this.path, row);
  }
  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------------------
// The REAL retriever — the same routing run-eval.mts / LocalEngine / retrieveForCard make.
// ---------------------------------------------------------------------------------------
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
export const CARD_TOPK = 4;

let store: RagStore | undefined;
export function ragStore(): RagStore {
  if (store) return store;
  store = new RagStore(loadFactSource());
  const META = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json');
  const BIN = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin');
  if (!existsSync(META) || !existsSync(BIN)) {
    throw new Error(`vectors blob missing (${BIN}) — the build cannot route without semantic retrieval`);
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
  console.log(`>> bank: ${meta.count} facts (hash ${meta.bankHash})`);
  return store;
}

const embedCache = new Map<string, Float32Array | undefined>();
export async function embedQuery(text: string): Promise<Float32Array | undefined> {
  if (embedCache.has(text)) return embedCache.get(text);
  let out: Float32Array | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, model: 'labse' }),
      });
      if (!res.ok) continue;
      const v: number[] = (await res.json()).data[0].embedding;
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      out = Float32Array.from(v, (x) => x / n);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  embedCache.set(text, out);
  return out;
}

export async function assertEmbedder(): Promise<void> {
  if (!(await embedQuery('embedder health probe'))) {
    throw new Error(
      `no embedder at ${EMBED_ENDPOINT} — boot it first: finetuning/eval/harness/embed-serve.sh`
    );
  }
}

export type Outcome = 'grounded' | 'gap' | 'offdomain';
export interface Route {
  outcome: Outcome;
  ids: string[];
  facts: string[];
  topCos: number;
}

/** The three-way card routing, identical to run-eval.mts (itself the two engines' copy). */
export async function route(query: string, lang: CardLanguage): Promise<Route> {
  const s = ragStore();
  const qvec = await embedQuery(normalizeQuery(query));
  const semantic = !!qvec;
  const r = s.retrieveForGroundingHybridDiag(query, qvec, lang as any, CARD_TOPK, 0.5, '');
  const unreachable = semantic && r.lexEmpty && s.lexicallyUnreachable(query, lang as any);
  let outcome: Outcome = 'grounded';
  if (semantic && isOffDomain(r.topCos, unreachable)) outcome = 'offdomain';
  else if (semantic && r.lexEmpty) outcome = 'gap';
  else if (!r.hits.length) outcome = 'gap';
  return {
    outcome,
    ids: r.hits.map((h: any) => h.fact.id as string),
    facts: r.hits.map((h: any) => h.text as string),
    topCos: r.topCos,
  };
}

// ---------------------------------------------------------------------------------------
// Fireworks — writer + decorrelated judge. Retry/backoff, bounded concurrency.
// ---------------------------------------------------------------------------------------
const FW_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const FW_KEY = process.env.FIREWORKS_API_KEY ?? '';
export const GEN_MODEL = process.env.FW_GEN_MODEL ?? 'accounts/fireworks/models/qwen3p7-plus';
export const JUDGE_MODEL = process.env.FW_JUDGE_MODEL ?? 'accounts/fireworks/models/gpt-oss-120b';
export const FW_CONC = Number(process.env.FW_CONC ?? '16');

export function assertFireworksKey(): void {
  if (!FW_KEY) {
    throw new Error('FIREWORKS_API_KEY missing — `set -a; source /Users/luis/Code/hiraia/.env.local; set +a`');
  }
}

let fwIn = 0;
let fwOut = 0;
export function fwUsage(): { promptTokens: number; completionTokens: number } {
  return { promptTokens: fwIn, completionTokens: fwOut };
}

async function fwCall(model: string, prompt: string, opts: { temp?: number; maxTokens?: number; reasoningEffort?: string } = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    temperature: opts.temp ?? 0.3,
    max_tokens: opts.maxTokens ?? 3000,
    messages: [{ role: 'user', content: prompt }],
  };
  // qwen3p7-plus reasons unless told not to; gpt-oss takes reasoning_effort instead.
  if (model.includes('gpt-oss')) body.reasoning_effort = opts.reasoningEffort ?? 'low';
  else body.chat_template_kwargs = { thinking: false };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(FW_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${FW_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 6) {
          const ra = Number(res.headers.get('retry-after') ?? '0');
          await new Promise((r) => setTimeout(r, (ra ? ra * 1000 : Math.min(90000, 2000 * 2 ** attempt))));
          continue;
        }
        throw new Error(`fireworks HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      const u = data.usage ?? {};
      fwIn += u.prompt_tokens ?? 0;
      fwOut += u.completion_tokens ?? 0;
      const m = data.choices?.[0]?.message ?? {};
      return (m.content || m.reasoning_content || '') as string;
    } catch (e: any) {
      if (attempt < 6 && !/fireworks HTTP 4/.test(String(e?.message))) {
        await new Promise((r) => setTimeout(r, Math.min(90000, 2000 * 2 ** attempt)));
        continue;
      }
      throw e;
    }
  }
}

export function fwGenerate(prompt: string, temp = 0.3): Promise<string> {
  return fwCall(GEN_MODEL, prompt, { temp, maxTokens: 2500 });
}

/**
 * `reasoningEffort` defaults low (cheap, fine for register/shape checks) but callers judging
 * factual-stance buckets should pass 'medium': a decorrelated medium-effort re-judge caught a
 * smoking card claiming an outright legal ban where the FACTS state only a sale-to-minors ban
 * — the low-effort pass had accepted it.
 */
export function fwJudge(prompt: string, reasoningEffort = 'low'): Promise<string> {
  return fwCall(JUDGE_MODEL, prompt, { temp: 0.1, maxTokens: 2500, reasoningEffort });
}

/** Extract the first JSON object/array from a model reply. */
export function parseJson(text: string): any {
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        /* try the other bracket pair */
      }
    }
  }
  return undefined;
}

/** Bounded-concurrency map with progress logging (ids only — never content). */
export async function pooled<T>(items: T[], conc: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i]!, i);
      } catch (e: any) {
        console.error(`   item ${i} FAILED: ${String(e?.message).slice(0, 200)}`);
      }
      done++;
      if (done % 100 === 0 || done === items.length) {
        const dt = (Date.now() - t0) / 1000;
        console.log(`   ${done}/${items.length}  (${(done / dt).toFixed(1)}/s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
}

// ---------------------------------------------------------------------------------------
// The v2 deterministic linter — cardshape invariants + the build's own rules.
// ---------------------------------------------------------------------------------------
/** Training targets sit at ≤28 words — headroom under the product's 30-word ceiling. */
export const TARGET_MAX_WORDS = 28;
/** Escape-shaped rows (nearest-fact restated whole) may use the full product ceiling. */
export const ESCAPE_MAX_WORDS = 30;

/**
 * The single most damaging sentences in v1's data (and the scaffolding around them).
 * A row containing ANY of these hard-fails the merge.
 */
export const FORBIDDEN_STRINGS: string[] = [
  'answer carefully from general knowledge',
  'say so if you are unsure',
  'VERIFIED FACTS FROM THE CURRICULUM',
  'Socratic',
  '[image:',
];

/** Hedge OPENERS a card must never be trained to start with (the 64%-hedge lesson). */
export const HEDGE_OPENER_RE =
  /^\s*(hindi\s+ko\s+(po\s+)?alam|hindi\s+(po\s+)?ako\s+sigurado|wala\s+akong\s+(sapat\s+na\s+)?(alam|impormasyon)|walang\s+nakakaalam|wala\s+ko(y)?\s+(kahibalo|kasiguro)|wala\s+pa\s+ko(y)?\s+nahibaw|ambot|i\s+don'?t\s+know|i'?m\s+not\s+sure|nobody\s+knows|no\s+one\s+knows)/i;

/**
 * Meta-talk ABOUT the FACT block. 82 accepted cards in the first v2 build ANNOUNCED their
 * grounding gap ("Walang impormasyon sa mga FACTS…", "The facts do not name…", "Walay fact
 * nga nagtubag.") — a printed card telling a child about a FACTS block that does not exist on
 * screen, and exactly the abstention register this build exists to remove. cardshape's
 * PREAMBLE_RES only matches "ayon/base sa fact" and "facts sa ibaba/below", so the class
 * walked through. NOT a bare /facts?/i: 19 bank facts legitimately carry the token ("In
 * fact, …", the "Nutrition Facts" label) and thin-escape restates bank facts verbatim — these
 * patterns catch the META constructions only.
 */
export const META_FACT_RES: RegExp[] = [
  /\bFACTS?\b/, // the block's own name, all-caps as the prompt prints it
  /\b(?:the|these)\s+(?:provided\s+|given\s+)?facts?\s+(?:do(?:es)?(?:\s+not|n'?t)?\s|don'?t\s|state|say|mention|name|list|focus|cover|only|contain)/i,
  /\b(?:walang?|walay|wala\s+pay?)\s+(?:sapat\s+na\s+)?(?:fact|impormasyon|sagot|tubag)/i,
  /\bmga\s+facts?\b/i, // "sa mga facts", "ang mga facts ay…"
  /\bsa\s+facts?\b/i, // "Walang sagot sa facts."
  /\bfacts?\s+(?:nga|na)\s+(?:nag|tumu|naglal)/i, // "walay fact nga nagtubag", "fact na tumutukoy"
];

/**
 * Persona / invitation / hedge-teaching cards. The bank's about-Hiraia facts route persona
 * queries GROUNDED, so v1-derived rows trained first-person persona prose ("Ako si Hiraia…"),
 * an explicit invitation to keep chatting ("Maaari mo akong tanungin…") and the literal hedge
 * sentence ("moingon kini og 'dili ko sigurado'") — register defects the gate forbids and the
 * 64%-hedge fix paid to remove. A card is impersonal: it never speaks as (or about) Hiraia,
 * never invites questions, never quotes a hedge. If about-Hiraia cards become a wanted
 * product surface, author them deliberately — third person, card register — not via v1 residue.
 */
export const PERSONA_CARD_RES: RegExp[] = [
  /\bhiraia\b/i,
  /\b(?:maaari|pwede|puwede|mahimo)\s+(?:mo|nimo)\s+ako(?:ng)?\b/i,
  /\b(?:tanungin|pangutan-?a)\s+(?:mo\s+)?ako\b/i,
  /\byou\s+can\s+ask\s+me\b/i,
  /\b(?:hindi|dili)\s+(?:ko|ako)\s+sigurado\b/i,
  /\bhindi\s+ko\s+(?:po\s+)?alam\b/i,
  /\bwala\s+ko(?:y)?\s+kahibalo\b/i,
];

export interface LintInput {
  card: string;
  lang: CardLanguage;
  facts: string[];
  /** Escape rows (thin-grounding / nearest-fact) get the 30-word product ceiling. */
  escape?: boolean;
  /** Settled-science correction rows are the ONLY licensed ungrounded answers. */
  allowUngrounded?: boolean;
  /** Bucket-specific entity deny-list (e.g. the gate's abstain mustNotContain entities). */
  deny?: RegExp[];
}

/** Deterministic violations (empty = pass). Reasons are safe to print (no row content). */
export function lintCard(input: LintInput): string[] {
  const { card, lang, facts } = input;
  const v: string[] = [];
  const maxWords = input.escape ? ESCAPE_MAX_WORDS : TARGET_MAX_WORDS;
  if (/\n/.test(card)) v.push('multiline: a card is ONE line (CARD_STOP is \\n)');
  v.push(...rawGenerationDefects(card).map((s) => s.split(' — ')[0]!));
  v.push(...cardShapeViolations(card, { lang, maxWords }));
  if (HEDGE_OPENER_RE.test(card)) v.push('hedge-opener');
  if (META_FACT_RES.some((re) => re.test(card))) v.push('meta-facts: the card talks about the FACT block');
  if (PERSONA_CARD_RES.some((re) => re.test(card))) v.push('persona-card: persona/invitation/hedge-teaching register');
  for (const re of input.deny ?? []) if (re.test(card)) v.push(`deny-entity: matched ${re}`);
  for (const s of FORBIDDEN_STRINGS) if (card.includes(s)) v.push(`forbidden-string: ${s}`);
  if (!input.allowUngrounded && facts.length) {
    const miss = groundednessMiss(card, facts);
    if (miss) v.push('groundedness: too little overlap with the FACT block');
  }
  return v;
}

// ---------------------------------------------------------------------------------------
// Chitchat / persona QUERIES — routed model-free at runtime (isOffDomain), but the bank's
// about-Hiraia facts can route them GROUNDED, so the build must refuse to train them: a
// child typing "hi hiraia" must never earn a card trained to invite conversation. The old
// reshape GREETING_RE required the greeting to be the ENTIRE query, so "hi hiraia" and
// "good morning po teacher" (trailing vocative) survived; persona questions did too.
// ---------------------------------------------------------------------------------------
const GREETING_WORD =
  "(?:hi|hello|hey|kumusta|kamusta|musta|magandang\\s+(?:araw|umaga|hapon|gabi)|maayong\\s+(?:buntag|hapon|adlaw|gabii)|good\\s+(?:morning|afternoon|day|evening)|salamat|thank\\s*you|thanks|ok(?:ay)?|sige|opo|oo\\s*po|yes|no|wow|nice|galing|uy|oy)";
const VOCATIVE =
  "(?:po|naman|ulit|again|diha|dinha|hiraia|tutor|teacher|titser|ma'?am|sir|bot|ai|friend|classmate|hello|hi)";
export const CHITCHAT_QUERY_RES: RegExp[] = [
  new RegExp(`^\\s*${GREETING_WORD}\\b[\\s!.,?~]*(?:${VOCATIVE}\\b[\\s!.,?~]*)*$`, 'i'),
  /\b(?:sino|kinsa)\s+(?:po\s+)?(?:ka|kayo|ikaw|man\s+ka)\b/i, // who are you
  /\b(?:k[au]musta|musta)\s+(?:po\s+)?(?:ka|na)\b/i, // how are you
  /\b(?:ano|unsa)(?:'?y|ng)?\s+pangalan\s+(?:mo|nimo)\b/i, // what's your name
  /\bmay\s+bayad\b/i, // is this app paid
  /\buyab\b/i, // relationship teasing (measured: "Tutor, naa ba kay uyab?")
  /\b(?:girlfriend|boyfriend|crush)\s+(?:mo|nimo|ba)\b/i,
  /\b(?:ilang\s+taon|pila\s+ka\s+tuig)\s+(?:ka|na\s+ka)\b/i, // how old are you
];
export function isChitchatQuery(q: string): boolean {
  return CHITCHAT_QUERY_RES.some((re) => re.test(q));
}

// ---------------------------------------------------------------------------------------
// Identical-target cap. Dedup used to be (lang, query) only, so 700 rows (11.7%) shared
// byte-identical assistant cards across different queries ("Ang Mercury …" ×10) — ~30
// effective epochs on a handful of bank sentences, a mild mode-collapse pressure. Collection
// loops cap at CARD_TEXT_CAP and refill their quotas from the judge-accepted surplus
// (mirroring reshape's fact-set cap); merge re-enforces it cross-bucket.
// ---------------------------------------------------------------------------------------
export const CARD_TEXT_CAP = 3;
export function cardTextKey(lang: string, card: string): string {
  return `${lang}|${card.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()}`;
}
/** True (and counts it) when this (lang, card) is still under the cap. */
export function underCardTextCap(counts: Map<string, number>, lang: string, card: string): boolean {
  const k = cardTextKey(lang, card);
  const n = counts.get(k) ?? 0;
  if (n >= CARD_TEXT_CAP) return false;
  counts.set(k, n + 1);
  return true;
}

// ---------------------------------------------------------------------------------------
// Contamination — the gate cases + arbitration suites the training set must not answer.
// ---------------------------------------------------------------------------------------
function normKey(q: string): string {
  return normalizeQuery(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !['po', 'ba', 'ang', 'ng', 'sa', 'mga', 'ka', 'man', 'yung', 'ay'].includes(w))
    .sort()
    .join(' ');
}

/**
 * Stopwords for the FUZZY contamination pass — language-agnostic function words, so what is
 * left in a query is its content. Deliberately includes the question words (ano/unsa/what/
 * bakit/ngano/why…): two queries about the same content are twins whichever way they ask.
 */
const FUZZY_STOP = new Set(
  (
    'po ba ang ng sa mga ka man yung ay na nga ni si o at ug og y ra lang lamang din rin daw raw pala kaya naman kasi talaga ' +
    'unsa unsay ano anong bakit paano ngano nganong kining kini dili hindi mag nag pag ba gyud gyod jud ' +
    'the a an is are was were do does did what why how when who which whom of to in on for and or but with from it its this that i you your my me we us our ' +
    'really po2 sir maam'
  ).split(/\s+/)
);
const FUZZY_JACCARD = 0.6;

function contentTokens(q: string): Set<string> {
  const out = new Set<string>();
  for (const w of q.toLowerCase().replace(/[^\p{L}\p{N}\s'ñ-]/gu, ' ').split(/\s+/)) {
    if (w.length > 1 && !FUZZY_STOP.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

let evalKeys: Map<string, string> | undefined;
let evalTokens: Array<{ id: string; toks: Set<string> }> | undefined;
export function evalQueryKeys(): Map<string, string> {
  if (evalKeys) return evalKeys;
  evalKeys = new Map();
  evalTokens = [];
  const add = (q: string, id: string) => {
    evalKeys!.set(normKey(q), id);
    evalTokens!.push({ id, toks: contentTokens(q) });
  };
  const gate = JSON.parse(readFileSync(join(ROOT, 'finetuning/eval/harness/cases.json'), 'utf8'));
  for (const c of gate.cases) add(c.query, `gate:${c.id}`);
  for (const f of ['cases.json', 'cases-holdout.json']) {
    const p = join(ROOT, 'finetuning/eval/routing/arbitration', f);
    if (!existsSync(p)) continue;
    const arb = JSON.parse(readFileSync(p, 'utf8'));
    for (const c of arb.cases) add(c.query, `arb:${c.id}`);
  }
  return evalKeys;
}

/**
 * Non-null = the eval case this training query would answer (contamination). Exact
 * normalised-key match first (fast path), then a fuzzy content-token Jaccard ≥ 0.6 —
 * exact-only let ~21 near-verbatim twins of gate/arbitration queries into the train set
 * ("ano po ginagawa ng puso?" vs gate:homonym-puso; "Ano po ang water cycle?" vs
 * gate:en-water-cycle across languages via the English loanwords), which turns the post-
 * training A/B into a memorization measurement exactly where the v1→v2 delta is claimed.
 */
export function contamination(query: string): string | null {
  const exact = evalQueryKeys().get(normKey(query));
  if (exact) return exact;
  const toks = contentTokens(query);
  if (!toks.size) return null;
  for (const e of evalTokens!) {
    if (jaccard(toks, e.toks) >= FUZZY_JACCARD) return `fuzzy:${e.id}`;
  }
  return null;
}

/**
 * The gate's abstain-case mustNotContain entities: an abstain-kind card must never be
 * TRAINED to name them (measured: 3 rows taught star-superlative queries to answer
 * "Sirius" — the exact string abstain-biggest-star forbids, red BY TRAINING).
 */
let abstainDeny: RegExp[] | undefined;
export function abstainDenyRes(): RegExp[] {
  if (abstainDeny) return abstainDeny;
  abstainDeny = [];
  const gate = JSON.parse(readFileSync(join(ROOT, 'finetuning/eval/harness/cases.json'), 'utf8'));
  for (const c of gate.cases) {
    if (!String(c.id).startsWith('abstain')) continue;
    for (const s of c.mustNotContain ?? []) {
      const isRegex = /[\\()[\]|?*+{]/.test(s);
      abstainDeny.push(new RegExp(isRegex ? s : `\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
    }
  }
  return abstainDeny;
}

// ---------------------------------------------------------------------------------------
// Language classification for v1 source rows (marker sets from cardshape.mts's philosophy).
// ---------------------------------------------------------------------------------------
const TL_MARKERS = new Set(['ano', 'bakit', 'paano', 'ito', 'hindi', 'dahil', 'kapag', 'tayo', 'natin', 'ay', 'naman', 'kasi', 'po', 'ngayon', 'upang', 'may', 'mga', 'talaga', 'iyon', 'niya']);
const CEB_MARKERS = new Set(['unsa', 'ngano', 'kini', 'dili', 'og', 'ug', 'mao', 'kaayo', 'nga', 'gyud', 'naa', 'kanang', 'busa', 'tungod', 'usa', 'adunay', 'karon', 'nimo', 'nako', 'sulod']);
const EN_MARKERS = new Set(['the', 'is', 'are', 'of', 'to', 'and', 'that', 'this', 'because', 'when', 'what', 'why', 'how', 'they', 'their', 'it', 'in', 'with', 'from', 'you']);

export function classifyLanguage(text: string): CardLanguage {
  const words = text.toLowerCase().match(/[a-zñ'-]+/g) ?? [];
  let tl = 0, ceb = 0, en = 0;
  for (const w of words) {
    if (TL_MARKERS.has(w)) tl++;
    if (CEB_MARKERS.has(w)) ceb++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (ceb > tl && ceb >= en / 2) return 'cebuano';
  if (tl >= ceb && tl >= en / 2) return 'tagalog';
  return 'english';
}

// ---------------------------------------------------------------------------------------
// Judge prompt — shared shape; bucket-specific policy line injected by the caller.
// ---------------------------------------------------------------------------------------
export interface JudgeInput {
  card: string;
  query: string;
  facts: string[];
  lang: CardLanguage;
  grade: number;
  /** Extra bucket-specific assertion, e.g. polarity / entity retention. */
  policy?: string;
  allowUngrounded?: boolean;
}

export function judgePrompt(j: JudgeInput): string {
  const langName = j.lang === 'tagalog' ? 'Tagalog' : j.lang === 'cebuano' ? 'Cebuano (Bisaya)' : 'English';
  return `You are auditing ONE training example for a children's science fact-card model (Filipino grade school).
The model's job: given retrieved FACTS and a child's QUESTION, print ONE card — 1-2 plain sentences, <= 30 words, in ${langName}, pitched at Grade ${j.grade}, stating only what the FACTS support${j.allowUngrounded ? ' (EXCEPTION for this row: it is a settled-science myth correction, allowed to state basic settled science even if the FACTS do not cover it)' : ''}. No greeting, no preamble, no closing question, no hedging, no "ask your teacher".

FACTS:
${j.facts.map((f) => `- ${f}`).join('\n') || '(none)'}

QUESTION: ${j.query}

CARD: ${j.card}

Judge these, strictly:
1. factual_ok — the card is scientifically correct (factual accuracy OUTRANKS fluency; any factual error = false).
2. grounded_ok — ${j.allowUngrounded ? 'the card states settled science correctly (grounding waived for this row).' : 'every claim in the card is supported by the FACTS (simplification fine, invention not; if no FACT answers the question, the card must restate the closest FACT rather than invent).'}
3. language_ok — the card is natural ${langName}${j.lang === 'cebuano' ? ' (natural conversational Cebuano, not stilted word-by-word translation, no Tagalog function words)' : ''}; established science terms in English are fine.
4. register_ok — card shape: <= 30 words, 1-2 sentences, no greeting/preamble/question/hedge/invitation, plain prose.
5. grade_ok — vocabulary fits Grade ${j.grade} (G3-4: common words; G8-10: technical terms kept).${j.policy ? `\n6. policy_ok — ${j.policy}` : ''}

Reply with ONLY a JSON object:
{"factual_ok":bool,"grounded_ok":bool,"language_ok":bool,"register_ok":bool,"grade_ok":bool${j.policy ? ',"policy_ok":bool' : ''},"verdict":"accept"|"reject","reason":"<short reason if reject>"}
verdict is "accept" only when every field is true.`;
}

export interface Verdict {
  accept: boolean;
  reason: string;
}

export async function runJudge(j: JudgeInput, reasoningEffort = 'low'): Promise<Verdict> {
  const raw = await fwJudge(judgePrompt(j), reasoningEffort);
  const obj = parseJson(raw);
  if (!obj || typeof obj !== 'object') return { accept: false, reason: 'judge-unparseable' };
  const keys = ['factual_ok', 'grounded_ok', 'language_ok', 'register_ok', 'grade_ok', ...(j.policy ? ['policy_ok'] : [])];
  const allTrue = keys.every((k) => obj[k] === true);
  const accept = obj.verdict === 'accept' && allTrue;
  const failed = keys.filter((k) => obj[k] !== true).join(',');
  return { accept, reason: accept ? '' : `${failed || 'verdict-reject'}${obj.reason ? `: ${String(obj.reason).slice(0, 160)}` : ''}` };
}

// ---------------------------------------------------------------------------------------
// The accepted-row shape every bucket file shares. train-v2.jsonl carries ONLY messages
// (normalised to exactly {role,content} — the Arrow struct lesson); meta rides in a sidecar.
// ---------------------------------------------------------------------------------------
export interface BuiltRow {
  id: string;
  bucket: string;
  lang: CardLanguage;
  grade: number;
  query: string;
  factIds: string[];
  facts: string[];
  card: string;
  source: string;
  escape?: boolean;
  allowUngrounded?: boolean;
  polarity?: string;
}

export function toTrainingMessages(row: BuiltRow): Array<{ role: string; content: string }> {
  return [
    {
      role: 'user',
      content: buildCardPrompt({ query: row.query, facts: row.facts, grade: row.grade, language: row.lang }),
    },
    { role: 'assistant', content: row.card },
  ];
}
