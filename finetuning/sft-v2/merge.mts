/**
 * merge.mts — STAGE 4: assemble train-v2.jsonl from the judge-accepted buckets.
 *
 * Emits:
 *   out/train-v2.jsonl       — {"messages":[{role,content},{role,content}]} ONLY, normalised
 *                              to exactly {role, content} (the Arrow wider-struct lesson).
 *                              user = buildCardPrompt(...) — built HERE, at merge time, from
 *                              the row's query/facts/grade/lang by the IMPORTED runtime
 *                              function, so the training surface cannot drift from the app.
 *   out/train-v2.meta.jsonl  — line-aligned provenance sidecar (id, bucket, lang, grade,
 *                              factIds, source) kept OUT of the training file.
 *
 * HARD FAILS (exit non-zero, no output written):
 *   - any FORBIDDEN string in any rendered message (the v1 "answer carefully from general
 *     knowledge" clause and its scaffolding — the single most damaging sentence in v1);
 *   - a duplicate normalised (lang, query) across buckets;
 *   - a row whose query answers an eval-gate or arbitration case verbatim OR as a fuzzy
 *     content-token twin (contamination — Jaccard >= 0.6 after a language-agnostic stoplist).
 *
 * BACKSTOP DROPS (logged to rejects-merge.jsonl): chitchat/persona queries, cards that talk
 * about the FACT block or speak as Hiraia, and identical (lang, card) targets past the cap.
 *
 *   node_modules/.bin/tsx finetuning/sft-v2/merge.mts
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OUT,
  type BuiltRow,
  FORBIDDEN_STRINGS,
  META_FACT_RES,
  PERSONA_CARD_RES,
  contamination,
  isChitchatQuery,
  normalizeQuery,
  readJsonl,
  toTrainingMessages,
  underCardTextCap,
} from './lib.mts';

/** Targeted buckets first: on a (lang,query) collision the failure-class row wins. */
const BUCKET_ORDER = [
  'accepted-safety-myth.jsonl',
  'accepted-thin-escape.jsonl',
  'accepted-abstain-name.jsonl',
  'accepted-ceb-quality.jsonl',
  'accepted-compress.jsonl',
  'accepted-en-topup.jsonl',
  'accepted-card-core.jsonl',
];

function qKey(row: BuiltRow): string {
  return `${row.lang}|${normalizeQuery(row.query).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()}`;
}

function main(): void {
  const rows: BuiltRow[] = [];
  const seen = new Set<string>();
  const cardCounts = new Map<string, number>();
  const dropped: Array<Record<string, unknown>> = [];
  for (const f of BUCKET_ORDER) {
    const p = join(OUT, f);
    if (!existsSync(p)) {
      console.log(`   (missing ${f})`);
      continue;
    }
    for (const row of readJsonl<BuiltRow>(p)) {
      const key = qKey(row);
      if (seen.has(key)) {
        dropped.push({ stage: 'merge-dedup', bucket: row.bucket, id: row.id });
        continue;
      }
      const contam = contamination(row.query);
      if (contam) {
        dropped.push({ stage: 'merge-contamination', bucket: row.bucket, id: row.id, evalCase: contam });
        continue;
      }
      // Backstops for the classes the collection stages now filter — a cached accepted file
      // from an older run must not smuggle them back in (all logged, never silent):
      //   chitchat/persona queries; meta-talk-about-FACTS / persona cards; >3 identical targets.
      if (isChitchatQuery(row.query)) {
        dropped.push({ stage: 'merge-chitchat-query', bucket: row.bucket, id: row.id });
        continue;
      }
      if (META_FACT_RES.some((re) => re.test(row.card)) || PERSONA_CARD_RES.some((re) => re.test(row.card))) {
        dropped.push({ stage: 'merge-meta-or-persona-card', bucket: row.bucket, id: row.id });
        continue;
      }
      if (!underCardTextCap(cardCounts, row.lang, row.card)) {
        dropped.push({ stage: 'merge-dup-card', bucket: row.bucket, id: row.id });
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  }

  const trainLines: string[] = [];
  const metaLines: string[] = [];
  let forbidden = 0;
  for (const row of rows) {
    const messages = toTrainingMessages(row).map((m) => ({ role: m.role, content: m.content }));
    const rendered = JSON.stringify({ messages });
    for (const s of FORBIDDEN_STRINGS) {
      if (rendered.includes(s)) {
        console.error(`FORBIDDEN STRING "${s}" in row ${row.id} (${row.bucket})`);
        forbidden++;
      }
    }
    trainLines.push(rendered);
    metaLines.push(
      JSON.stringify({
        id: row.id,
        bucket: row.bucket,
        lang: row.lang,
        grade: row.grade,
        factIds: row.factIds,
        source: row.source,
        polarity: row.polarity,
        escape: row.escape,
        allowUngrounded: row.allowUngrounded,
      })
    );
  }
  if (forbidden > 0) {
    console.error(`\nMERGE HARD-FAILED: ${forbidden} forbidden-string hit(s). Nothing written.`);
    process.exit(2);
  }

  writeFileSync(join(OUT, 'train-v2.jsonl'), trainLines.join('\n') + '\n');
  writeFileSync(join(OUT, 'train-v2.meta.jsonl'), metaLines.join('\n') + '\n');
  writeFileSync(join(OUT, 'rejects-merge.jsonl'), dropped.map((r) => JSON.stringify(r)).join('\n') + (dropped.length ? '\n' : ''));

  const byBucket = new Map<string, number>();
  const byLang = new Map<string, number>();
  for (const r of rows) {
    byBucket.set(r.bucket, (byBucket.get(r.bucket) ?? 0) + 1);
    byLang.set(r.lang, (byLang.get(r.lang) ?? 0) + 1);
  }
  console.log(`>> train-v2.jsonl: ${rows.length} rows (${dropped.length} dropped at merge)`);
  console.log('   per bucket:', Object.fromEntries(byBucket));
  console.log('   per lang:', Object.fromEntries(byLang));
}

main();
