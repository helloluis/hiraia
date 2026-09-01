/**
 * judge.mts — STAGE 3: decorrelated admission judging.
 *
 * EVERY row whose assistant text an LLM wrote (that is: every row in this build — the
 * reshaped core included, since its cards are qwen3p7-plus distillations) is judged by a
 * DIFFERENT model family (gpt-oss-120b) before admission: factually correct, faithful to its
 * FACT block, right language, card register, grade-vocabulary fit, plus the bucket's own
 * policy (polarity / entity retention / no-forced-connection / never-name-beyond-facts).
 *
 * Rejects are LOGGED with reasons (out/rejects-judge.jsonl), never silently dropped.
 * AUP: judging runs on Fireworks; this process prints ids and stats only.
 *
 *   set -a; source /Users/luis/Code/hiraia/.env.local; set +a
 *   node_modules/.bin/tsx finetuning/sft-v2/judge.mts
 *
 * Resumable via out/cache/judge.jsonl (keyed by row id + a hash of the card text, so a
 * regenerated card is re-judged, not skipped).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Cache,
  CACHE,
  OUT,
  type BuiltRow,
  assertFireworksKey,
  FW_CONC,
  fwUsage,
  pooled,
  readJsonl,
  rowId,
  runJudge,
} from './lib.mts';

const ONLY = (process.env.JUDGE_FILES ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const BUCKET_FILES = [
  'bucket-core.jsonl',
  'bucket-safety.jsonl',
  'bucket-thin.jsonl',
  'bucket-abstain.jsonl',
  'bucket-ceb.jsonl',
  'bucket-compress.jsonl',
  'bucket-en.jsonl',
];

/** Bucket-specific judge policy (item 6 in the shared rubric). */
function policyFor(row: BuiltRow): string | undefined {
  switch (row.bucket) {
    case 'safety-myth': {
      const stance: Record<string, string> = {
        'harmful-yes':
          'the question asks about something genuinely HARMFUL; the card must clearly affirm the danger (never minimize or deny it). ' +
          'AND any LEGAL claim must match the FACTS exactly — if the FACTS say only that SALE to minors is banned, a card claiming the act itself is outright banned by law is a policy failure',
        'myth-no': 'the question asks about a MYTH; the card must clearly deny it and state the real science (never affirm the myth)',
        'safe-no': 'the question worries about something actually SAFE; the card must clearly say it is not harmful (never invent a danger)',
        'true-yes': 'the question doubts something scientifically TRUE; the card must clearly affirm it (never cast doubt on settled science)',
      };
      return `POLARITY — ${stance[row.polarity ?? ''] ?? 'the card stance must be scientifically correct for the question'}.`;
    }
    case 'thin-escape':
      return (
        'ESCAPE SHAPE — no FACT actually answers this question. The card must be a faithful restatement of one of the FACTS, ' +
        'must NOT define or explain the question topic from memory, and must NOT force a connection between the facts and the question.'
      );
    case 'abstain-name':
      return row.polarity === 'abstain'
        ? 'NEVER-NAME-BEYOND-FACTS — the card must not state any specific entity name or number that is absent from the FACTS, and must not hedge ("nobody knows").'
        : 'NAME-WHEN-GROUNDED — the FACTS contain the specific answer; the card MUST name that entity/number explicitly.';
    case 'compress':
      return row.polarity === 'multifact'
        ? 'ENTITY RETENTION — the card must keep the load-bearing named entities/numbers from the FACTS (dropping a name or count the answer depends on is a fail).'
        : 'CONTRAST RETENTION — the FACTS contain a classification contrast (X is A, not B); the card must preserve the correct classification (stating the correct class is required; naming the rejected class is a plus, not required).';
    case 'ceb-quality':
      return 'CEBUANO NATURALNESS — the card must read as natural conversational Cebuano a Bisaya child would hear, not stilted translation; no Tagalog function words.';
    default:
      return undefined;
  }
}

async function main(): Promise<void> {
  assertFireworksKey();
  const cache = new Cache(join(CACHE, 'judge.jsonl'));
  const all: BuiltRow[] = [];
  for (const f of BUCKET_FILES) {
    if (ONLY.length && !ONLY.some((o) => f.includes(o))) continue;
    const p = join(OUT, f);
    if (!existsSync(p)) {
      console.log(`   (missing ${f} — run reshape/generate first)`);
      continue;
    }
    all.push(...readJsonl<BuiltRow>(p));
  }
  console.log(`>> judging ${all.length} rows (100%, decorrelated judge)`);

  // safety-myth is judged at reasoning_effort MEDIUM: the low-effort pass accepted a smoking
  // card claiming an outright legal ban where the FACTS state only a sale-to-minors ban —
  // factual-stance auditing needs the deeper pass; register/shape buckets stay cheap at low.
  // The effort is part of the cache key (for non-low only, so existing low verdicts keep),
  // meaning an effort bump re-judges exactly the buckets it names.
  const EFFORT: Record<string, string> = { 'safety-myth': 'medium' };
  const judgeKey = (row: BuiltRow) => {
    const effort = EFFORT[row.bucket] ?? 'low';
    return effort === 'low' ? rowId('judge', row.id, row.card) : rowId('judge', row.id, row.card, effort);
  };

  await pooled(all, FW_CONC, async (row) => {
    const key = judgeKey(row);
    if (cache.has(key)) return;
    const effort = EFFORT[row.bucket] ?? 'low';
    const verdict = await runJudge(
      {
        card: row.card,
        query: row.query,
        facts: row.facts,
        lang: row.lang,
        grade: row.grade,
        policy: policyFor(row),
        allowUngrounded: row.allowUngrounded,
      },
      effort
    );
    cache.put(key, { rowId: row.id, bucket: row.bucket, effort, ...verdict });
  });

  // Partition into accepted / rejected per bucket.
  const rejects: Array<Record<string, unknown>> = [];
  const perBucket = new Map<string, { total: number; accepted: BuiltRow[] }>();
  for (const row of all) {
    const v = cache.get(judgeKey(row));
    const b = perBucket.get(row.bucket) ?? { total: 0, accepted: [] };
    b.total++;
    if (v?.accept) b.accepted.push(row);
    else rejects.push({ stage: 'judge', bucket: row.bucket, id: row.id, reason: v?.reason ?? 'no-verdict', card: row.card });
    perBucket.set(row.bucket, b);
  }

  for (const [bucket, { total, accepted }] of perBucket) {
    const file = join(OUT, `accepted-${bucket}.jsonl`);
    writeFileSync(file, accepted.map((r) => JSON.stringify(r)).join('\n') + (accepted.length ? '\n' : ''));
    console.log(`>> ${bucket}: ${accepted.length}/${total} accepted (${((100 * accepted.length) / Math.max(1, total)).toFixed(1)}%)`);
  }
  writeFileSync(join(OUT, 'rejects-judge.jsonl'), rejects.map((r) => JSON.stringify(r)).join('\n') + (rejects.length ? '\n' : ''));
  const byReason = new Map<string, number>();
  for (const r of rejects) {
    const k = String(r.reason).split(':')[0]!;
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }
  console.log('>> judge reject reasons:', Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])));
  console.log('>> fireworks usage:', fwUsage());
}

await main();
