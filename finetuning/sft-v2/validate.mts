/**
 * validate.mts — STAGE 5: the validation gate over the final train-v2.jsonl.
 *
 * HARD (any hit = exit 2):
 *   - message shape: exactly 2 messages, roles user→assistant, keys exactly {role, content};
 *   - zero `[image:]` anywhere in the file;
 *   - zero hedge-openers in any assistant turn;
 *   - zero FORBIDDEN v1-instruction strings;
 *   - zero duplicate (lang-normalised) queries within the file;
 *   - zero rows whose query answers an eval-gate or arbitration case verbatim;
 *   - byte-identity: every user turn re-renders EXACTLY from buildCardPrompt(meta row) — the
 *     imported runtime prompt, so training cannot drift from the app's surface;
 *   - language purity: zero languageLeaks per assistant card;
 *   - assistant single-line, no emoji/markdown, ends clean;
 *   - zero meta-talk about the FACT block / persona ("Ako si Hiraia") / hedge-teaching cards;
 *   - zero chitchat-query rows; zero abstain cards naming a gate mustNotContain entity;
 *   - no identical (lang, card) target past CARD_TEXT_CAP.
 *
 * REPORTED (numbers, not gates):
 *   - assistant length distribution (target: bulk ≤ 30 words, center well under);
 *   - safety polarity BOTH ways (affirm-cells vs deny-cells row counts — a one-sided bucket
 *     is the documented DPO collapse signature);
 *   - per-bucket / per-lang / per-grade counts.
 *
 *   node_modules/.bin/tsx finetuning/sft-v2/validate.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CARD_TEXT_CAP,
  OUT,
  type BuiltRow,
  FORBIDDEN_STRINGS,
  HEDGE_OPENER_RE,
  META_FACT_RES,
  PERSONA_CARD_RES,
  abstainDenyRes,
  cardTextKey,
  contamination,
  isChitchatQuery,
  normalizeQuery,
  readJsonl,
  toTrainingMessages,
  wordCount,
} from './lib.mts';
import { languageLeaks, cardShapeViolations } from '../eval/cardshape.mts';

const hard: string[] = [];
const note = (s: string) => hard.push(s);

function main(): void {
  const train = readJsonl<{ messages: Array<Record<string, string>> }>(join(OUT, 'train-v2.jsonl'));
  const meta = readJsonl<any>(join(OUT, 'train-v2.meta.jsonl'));
  if (train.length !== meta.length) note(`train (${train.length}) and meta (${meta.length}) line counts differ`);

  // Accepted-row index for byte-identity re-rendering.
  const accepted = new Map<string, BuiltRow>();
  for (const f of [
    'accepted-safety-myth.jsonl', 'accepted-thin-escape.jsonl', 'accepted-abstain-name.jsonl',
    'accepted-ceb-quality.jsonl', 'accepted-compress.jsonl', 'accepted-en-topup.jsonl',
    'accepted-card-core.jsonl',
  ]) {
    for (const r of readJsonl<BuiltRow>(join(OUT, f))) accepted.set(r.id, r);
  }

  const seenQ = new Set<string>();
  const cardDupCounts = new Map<string, number>();
  const lengths: number[] = [];
  let over30 = 0;
  let over28 = 0;
  const polarity = new Map<string, number>();
  const polarityByLang: Record<string, { affirm: number; deny: number }> = {};
  const byBucket = new Map<string, number>();
  const byLang = new Map<string, number>();
  const byGrade = new Map<number, number>();
  let leakRows = 0;
  let shapeRows = 0;

  for (let i = 0; i < train.length; i++) {
    const t = train[i]!;
    const m = meta[i]!;
    const tag = `row ${i} (${m?.id ?? '?'})`;
    // --- message shape
    if (!Array.isArray(t.messages) || t.messages.length !== 2) note(`${tag}: not exactly 2 messages`);
    else {
      const [u, a] = t.messages;
      if (u!.role !== 'user' || a!.role !== 'assistant') note(`${tag}: roles are not user→assistant`);
      for (const msg of t.messages) {
        const keys = Object.keys(msg).sort().join(',');
        if (keys !== 'content,role') note(`${tag}: message keys are {${keys}}, not exactly {role,content}`);
        if (typeof msg.content !== 'string' || !msg.content.trim()) note(`${tag}: empty/non-string content`);
      }
      const card = a!.content ?? '';
      const raw = JSON.stringify(t);
      if (raw.includes('[image:')) note(`${tag}: [image:] tag present`);
      for (const s of FORBIDDEN_STRINGS) if (raw.includes(s)) note(`${tag}: forbidden string "${s}"`);
      if (HEDGE_OPENER_RE.test(card)) note(`${tag}: hedge-opener in SAGOT`);
      if (META_FACT_RES.some((re) => re.test(card))) note(`${tag}: card talks about the FACT block`);
      if (PERSONA_CARD_RES.some((re) => re.test(card))) note(`${tag}: persona/invitation/hedge-teaching card`);
      if (/\n/.test(card)) note(`${tag}: multiline assistant`);
      // --- byte-identity of the user prompt vs the IMPORTED runtime builder
      const row = accepted.get(m.id);
      if (!row) note(`${tag}: no accepted-bucket row for meta id`);
      else {
        const rebuilt = toTrainingMessages(row);
        if (rebuilt[0]!.content !== u!.content) note(`${tag}: user turn is NOT byte-identical to buildCardPrompt(...)`);
        if (rebuilt[1]!.content !== card) note(`${tag}: assistant turn differs from the accepted row`);
        // --- language purity + residual card shape (escape rows use the 30-word ceiling)
        const leaks = languageLeaks(card, row.lang);
        if (leaks.length) {
          leakRows++;
          note(`${tag}: language leak — ${leaks[0]}`);
        }
        const viol = cardShapeViolations(card, { lang: row.lang, maxWords: 30 });
        if (viol.length) {
          shapeRows++;
          note(`${tag}: card-shape — ${viol[0]}`);
        }
        // --- dedup within the file + eval contamination
        const key = `${row.lang}|${normalizeQuery(row.query).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()}`;
        if (seenQ.has(key)) note(`${tag}: duplicate (lang, query) in train file`);
        seenQ.add(key);
        const contam = contamination(row.query);
        if (contam) note(`${tag}: answers eval case ${contam} (exact or fuzzy twin)`);
        if (isChitchatQuery(row.query)) note(`${tag}: chitchat/persona query trained as a card`);
        // abstain-kind cards must never name a gate mustNotContain entity (the Sirius lesson)
        if (m.bucket === 'abstain-name' && m.polarity === 'abstain' && abstainDenyRes().some((re) => re.test(card)))
          note(`${tag}: abstain card names a gate mustNotContain entity`);
        cardDupCounts.set(cardTextKey(row.lang, card), (cardDupCounts.get(cardTextKey(row.lang, card)) ?? 0) + 1);
      }
      // --- stats
      const w = wordCount(card);
      lengths.push(w);
      if (w > 30) over30++;
      if (w > 28) over28++;
    }
    if (m) {
      byBucket.set(m.bucket, (byBucket.get(m.bucket) ?? 0) + 1);
      byLang.set(m.lang, (byLang.get(m.lang) ?? 0) + 1);
      byGrade.set(m.grade, (byGrade.get(m.grade) ?? 0) + 1);
      if (m.bucket === 'safety-myth' && m.polarity) {
        polarity.set(m.polarity, (polarity.get(m.polarity) ?? 0) + 1);
        const p = (polarityByLang[m.lang] ??= { affirm: 0, deny: 0 });
        if (m.polarity === 'harmful-yes' || m.polarity === 'true-yes') p.affirm++;
        else p.deny++;
      }
      if (m.bucket === 'abstain-name' && m.polarity) polarity.set(`abstain:${m.polarity}`, (polarity.get(`abstain:${m.polarity}`) ?? 0) + 1);
    }
  }

  // Identical-target cap (the Mercury-×10 lesson) — merge enforces it, this proves it held.
  for (const [k, n] of cardDupCounts) {
    if (n > CARD_TEXT_CAP) note(`identical (lang, card) target appears ${n}× (cap ${CARD_TEXT_CAP}): ${k.slice(0, 60)}`);
  }
  const dupGroups = [...cardDupCounts.values()].filter((n) => n > 1);

  lengths.sort((a, b) => a - b);
  const pct = (p: number) => lengths[Math.min(lengths.length - 1, Math.floor((p / 100) * lengths.length))] ?? 0;
  const affirm = (polarity.get('harmful-yes') ?? 0) + (polarity.get('true-yes') ?? 0);
  const deny = (polarity.get('myth-no') ?? 0) + (polarity.get('safe-no') ?? 0);

  const report = {
    rows: train.length,
    perBucket: Object.fromEntries(byBucket),
    perLang: Object.fromEntries(byLang),
    perGrade: Object.fromEntries([...byGrade.entries()].sort((a, b) => a[0] - b[0])),
    lengthWords: { median: pct(50), p90: pct(90), p99: pct(99), max: lengths[lengths.length - 1] ?? 0, over28, over30 },
    safetyPolarity: {
      ...Object.fromEntries(polarity),
      affirmCells: affirm,
      denyCells: deny,
      perLanguage: polarityByLang,
      note: 'affirmCells vs denyCells must stay ~balanced PER LANGUAGE, not just in aggregate (the DPO one-sided-collapse guard; measured skew: ceb 19 affirm vs 32 deny before the per-(cell,lang) caps)',
    },
    dupCards: {
      groupsOver1: dupGroups.length,
      rowsInGroups: dupGroups.reduce((a, b) => a + b, 0),
      maxCount: Math.max(0, ...cardDupCounts.values()),
      cap: CARD_TEXT_CAP,
    },
    hardViolations: hard.length,
    violations: hard.slice(0, 50),
  };
  writeFileSync(join(OUT, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, violations: undefined }, null, 2));
  if (hard.length) {
    console.error(`\nVALIDATION FAILED: ${hard.length} hard violation(s) — first few:`);
    for (const v of hard.slice(0, 10)) console.error(`  - ${v}`);
    process.exit(2);
  }
  console.log('\nVALIDATION GREEN');
}

main();
