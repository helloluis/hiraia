/**
 * reshape.mts — STAGE 1: the card-core bucket.
 *
 * Converts the v1 chat mix (tagalog/train-v5 + bisaya/train-v5 + grounded/train-grounded)
 * into CARD rows shaped for the surface that actually exists at runtime:
 *
 *   user      = buildCardPrompt(...)  — IMPORTED from @hiraia/shared, byte-identical to the
 *               prompt the phone and hiraia.org send (never a copied string)
 *   assistant = ONE line, <= 28 words, no greeting/question/hedge/emoji/markdown/[image:]
 *
 * DROPS (logged, never silent): multi-turn rows; greeting/chitchat rows; refusal/redirect
 * rows; rows whose query finds no grounded outcome on the REAL retriever; (topic, fact-set)
 * near-duplicates; rows whose query would answer an eval-gate or arbitration case verbatim.
 *
 * FACTS: a row's own VERIFIED FACTS block where present; otherwise 3-4 facts retrieved by
 * the actual runtime retriever, so the training fact-distribution matches inference.
 *
 * Answers are distilled near-extractively via Fireworks (qwen3p7-plus — AUP: TL/BIS
 * child-body content never enters a Claude context), deterministically linted, then 100%
 * judged by the decorrelated gpt-oss-120b in judge.mts.
 *
 *   set -a; source /Users/luis/Code/hiraia/.env.local; set +a
 *   EMBED_ENDPOINT=http://localhost:8090 node_modules/.bin/tsx finetuning/sft-v2/reshape.mts
 *
 * Resumable: generation results cache to out/cache/core.gen.jsonl by deterministic row id.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Cache,
  OUT,
  CACHE,
  ROOT,
  type BuiltRow,
  type CardLanguage,
  appendJsonl,
  assertEmbedder,
  assertFireworksKey,
  classifyLanguage,
  contamination,
  fwGenerate,
  fwUsage,
  FW_CONC,
  isChitchatQuery,
  lintCard,
  parseJson,
  pooled,
  readJsonl,
  route,
  rowId,
  sampleGrade,
  underCardTextCap,
  wordCount,
} from './lib.mts';
import { REFUSAL_MARKERS } from '../eval/cardshape.mts';

const SOURCES: Array<{ file: string; source: string; defaultLang: CardLanguage }> = [
  { file: 'finetuning/datasets/tagalog/train-v5.jsonl', source: 'tagalog-v5', defaultLang: 'tagalog' },
  { file: 'finetuning/datasets/bisaya/train-v5.jsonl', source: 'bisaya-v5', defaultLang: 'cebuano' },
  { file: 'finetuning/datasets/grounded/train-grounded.jsonl', source: 'grounded', defaultLang: 'tagalog' },
];

// Greeting/persona/chitchat filtering moved to lib's isChitchatQuery: the local $-anchored
// GREETING_RE required the greeting to be the ENTIRE query, so vocative greetings ("hi
// hiraia", "good morning po Hiraia") and persona questions ("sino ka po?", "may bayad po ba
// to?") survived into card-core and trained first-person persona prose.

interface Candidate {
  id: string;
  source: string;
  lang: CardLanguage;
  grade: number;
  query: string;
  facts: string[];
  factIds: string[];
  reference: string;
}

const rejects: Array<Record<string, unknown>> = [];
const dropCounts = new Map<string, number>();
function drop(reason: string, extra: Record<string, unknown>): void {
  dropCounts.set(reason.split(':')[0]!, (dropCounts.get(reason.split(':')[0]!) ?? 0) + 1);
  rejects.push({ stage: 'reshape-drop', reason, ...extra });
}

/** Parse a VERIFIED FACTS user turn into { facts, question }. */
function parseVerifiedFacts(user: string): { facts: string[]; question: string } | null {
  if (!user.includes('VERIFIED FACTS FROM THE CURRICULUM')) return null;
  const facts: string[] = [];
  for (const line of user.split('\n')) {
    const m = line.match(/^-\s+\(([^)]*)\)\s+(.*)$/);
    if (m) facts.push(m[2]!.trim());
  }
  // The child's question is the final paragraph after the instruction block.
  const paras = user.trim().split(/\n\n+/);
  const question = paras[paras.length - 1]!.trim();
  if (!facts.length || !question || question.includes('VERIFIED FACTS')) return null;
  return { facts, question };
}

async function main(): Promise<void> {
  assertFireworksKey();
  await assertEmbedder();

  // ---- pass 1: select + shape candidates (no model calls) --------------------------------
  const candidates: Candidate[] = [];
  const seenQuery = new Set<string>();
  const factSetCount = new Map<string, number>();

  for (const src of SOURCES) {
    const rows = readJsonl<{ messages: Array<{ role: string; content: string }> }>(join(ROOT, src.file));
    for (let i = 0; i < rows.length; i++) {
      const msgs = rows[i]!.messages;
      const users = msgs.filter((m) => m.role === 'user');
      const asst = msgs.filter((m) => m.role === 'assistant');
      const sys = msgs.find((m) => m.role === 'system')?.content ?? '';
      const tag = { source: src.source, index: i };
      if (users.length !== 1 || asst.length !== 1) {
        drop('multi-turn', tag);
        continue;
      }
      const userText = users[0]!.content.trim();
      const answer = asst[0]!.content.trim();
      const vf = parseVerifiedFacts(userText);
      const query = (vf ? vf.question : userText).trim();
      if (!query || isChitchatQuery(query) || wordCount(query) < 1) {
        drop('chitchat-greeting', tag);
        continue;
      }
      // A VF row whose block did not parse (single-line variants) leaves the whole
      // instruction block in the "query" — a forbidden surface. Drop, never reshape.
      if (query.includes('VERIFIED FACTS')) {
        drop('vf-parse-failure', tag);
        continue;
      }
      // The runtime surface is a TYPED FEED QUERY. A 400-char multi-question paragraph
      // trains a surface that no longer exists.
      if (query.length > 260) {
        drop('query-too-long', tag);
        continue;
      }
      if (REFUSAL_MARKERS.some((re) => re.test(answer))) {
        drop('refusal-redirect', tag);
        continue;
      }
      const contaminated = contamination(query);
      if (contaminated) {
        drop(`eval-contamination:${contaminated}`, { ...tag, evalCase: contaminated });
        continue;
      }
      const lang: CardLanguage =
        src.defaultLang === 'cebuano' ? 'cebuano' : classifyLanguage(`${query} ${answer}`);
      const gm = sys.match(/[Gg]rade\s*(\d+)/);
      const id = rowId('core', src.source, String(i), query);
      const grade = gm ? Number(gm[1]) : sampleGrade(id);
      const qKey = `${lang}|${query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()}`;
      if (seenQuery.has(qKey)) {
        drop('dup-query', tag);
        continue;
      }
      seenQuery.add(qKey);
      candidates.push({
        id,
        source: src.source,
        lang,
        grade,
        query,
        facts: vf?.facts.slice(0, 4) ?? [],
        factIds: [],
        reference: answer.slice(0, 700),
      });
    }
  }
  console.log(`>> ${candidates.length} candidates after shape/dup/contamination drops`);
  const LIMIT = Number(process.env.LIMIT ?? '0');
  const work = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;

  // ---- pass 2: ground every block-less row on the REAL retriever -------------------------
  const grounded: Candidate[] = [];
  await pooled(work, 8, async (c) => {
    if (!c.facts.length) {
      const r = await route(c.query, c.lang);
      if (r.outcome !== 'grounded') {
        drop(`no-grounding:${r.outcome}`, { id: c.id, source: c.source, outcome: r.outcome });
        return;
      }
      c.facts = r.facts;
      c.factIds = r.ids;
    }
    grounded.push(c);
  });

  // (topic, fact-set) dedup: at most 3 rows per identical retrieved fact-set per language.
  // Sorted by candidate order (pooled() completes out of order) so re-runs keep the same rows.
  const order = new Map(work.map((c, i) => [c.id, i]));
  grounded.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const kept: Candidate[] = [];
  for (const c of grounded) {
    const key = `${c.lang}|${(c.factIds.length ? c.factIds : c.facts.map((f) => f.slice(0, 40))).slice().sort().join('~')}`;
    const n = factSetCount.get(key) ?? 0;
    if (n >= 3) {
      drop('dup-factset', { id: c.id, source: c.source });
      continue;
    }
    factSetCount.set(key, n + 1);
    kept.push(c);
  }
  const byLang = new Map<string, number>();
  for (const c of kept) byLang.set(c.lang, (byLang.get(c.lang) ?? 0) + 1);
  console.log(`>> ${kept.length} grounded candidates to distill`, Object.fromEntries(byLang));

  // ---- pass 3: distill the card answers (Fireworks, resumable) ---------------------------
  const gen = new Cache(join(CACHE, 'core.gen.jsonl'));
  await pooled(kept, FW_CONC, async (c) => {
    if (gen.has(c.id)) return;
    const langName = c.lang === 'tagalog' ? 'Tagalog' : c.lang === 'cebuano' ? 'Cebuano (Bisaya)' : 'English';
    const base =
      `You are writing the TARGET answer for ONE training example of a children's science fact-card model.\n` +
      `Card language: ${langName}. Reader: Grade ${c.grade} Filipino child.\n\n` +
      `FACTS:\n${c.facts.map((f) => `- ${f}`).join('\n')}\n\n` +
      `QUESTION: ${c.query}\n\n` +
      `REFERENCE (an old verbose chat answer to the same question — use it ONLY to understand the intended content; never copy its style, greetings or questions):\n${c.reference}\n\n` +
      `Write the fact card:\n` +
      `- 1-2 plain sentences, ONE line, AT MOST 28 words. Both 1-sentence and 2-sentence cards are good.\n` +
      `- Natural ${langName}, vocabulary for Grade ${c.grade} (Grades 3-4: common words, drop technical terms unless the term itself is the answer; Grades 8-10: keep the facts' technical vocabulary).\n` +
      `- NEAR-EXTRACTIVE: use ONLY information from the FACTS, preferring their own wording simplified for the grade. Never add facts from memory.\n` +
      `- If no FACT answers the QUESTION, restate the closest FACT (whole, faithfully); do NOT force a connection and do NOT define unknown terms from memory.\n` +
      `- FORBIDDEN: greetings, praise, preamble, any question mark, hedging ("hindi ko alam"), emoji, markdown (** or backticks), [image:] tags, meta-talk like "ayon sa fact".\n\n` +
      `Reply with ONLY JSON: {"card":"..."}`;
    let card = '';
    let violations: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0 ? base : `${base}\n\nYour previous card was rejected for: ${violations.join('; ')}. Fix those and reply with ONLY JSON.`;
      const raw = await fwGenerate(prompt, attempt === 0 ? 0.3 : 0.6);
      card = String(parseJson(raw)?.card ?? '').replace(/\s+/g, ' ').trim();
      violations = card ? lintCard({ card, lang: c.lang, facts: c.facts }) : ['empty'];
      if (!violations.length) break;
    }
    gen.put(c.id, { card, violations, ok: violations.length === 0 });
  });

  // ---- pass 4: collect lint-clean rows ---------------------------------------------------
  // Cards are RE-LINTED here with the current linter (not the cached verdict): a lint rule
  // added after a cache entry was written (meta-facts, persona-card) must still apply to it.
  // Identical (lang, card) targets cap at CARD_TEXT_CAP (the Mercury-×10 lesson).
  const outRows: BuiltRow[] = [];
  const cardCounts = new Map<string, number>();
  for (const c of kept) {
    const g = gen.get(c.id);
    if (!g) continue;
    const violations: string[] = g.card ? lintCard({ card: g.card, lang: c.lang, facts: c.facts }) : ['empty'];
    if (violations.length) {
      drop('lint-reject', { id: c.id, source: c.source, violations });
      rejects[rejects.length - 1]!.card = g.card;
      continue;
    }
    if (!underCardTextCap(cardCounts, c.lang, g.card)) {
      drop('dup-card', { id: c.id, source: c.source });
      continue;
    }
    outRows.push({
      id: c.id,
      bucket: 'card-core',
      lang: c.lang,
      grade: c.grade,
      query: c.query,
      factIds: c.factIds,
      facts: c.facts,
      card: g.card,
      source: c.source,
    });
  }

  writeFileSync(join(OUT, 'bucket-core.jsonl'), outRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(OUT, 'rejects-core.jsonl'), rejects.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const langCounts = new Map<string, number>();
  for (const r of outRows) langCounts.set(r.lang, (langCounts.get(r.lang) ?? 0) + 1);
  console.log('>> card-core rows (pre-judge):', outRows.length, Object.fromEntries(langCounts));
  console.log('>> drops:', Object.fromEntries([...dropCounts.entries()].sort((a, b) => b[1] - a[1])));
  console.log('>> fireworks usage:', fwUsage());
}

await main();
