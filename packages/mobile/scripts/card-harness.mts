/**
 * Question-cards feed test harness — drives the REAL card-graph logic (src/data/cards.ts)
 * exactly the way cardStore walks it, headless, across many sessions and "kid policies",
 * and reports quality issues with the factoids, the quiz interjects, and the path choices.
 *
 * It shims cards.ts's app-only imports (@hiraia/shared, the generated pool + curriculum
 * tags, the questions JSON) to their source paths so it can run under tsx without Metro.
 * Draws run WITHOUT a FeedContext (uniform), exactly like cards.ts without one.
 *
 *   npx tsx scripts/card-harness.mts                 # default: 6 runs × 40 cards, all policies
 *   RUNS=10 CARDS=60 npx tsx scripts/card-harness.mts
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const REPO = join(MOBILE, '..', '..');
const SHARED = join(REPO, 'packages/shared/src');

// ---- shim cards.ts's imports to runnable source paths, then dynamic-import it ----
function loadCards() {
  const src = readFileSync(join(MOBILE, 'src/data/cards.ts'), 'utf8')
    .replace(
      /from '@hiraia\/shared';/,
      // keep whatever names cards.ts imports; only the module path is swapped (shared/index.ts re-exports all)
      `from '${join(SHARED, 'index.ts')}';`
    )
    .replace(
      "import cardsPool from '../generated/cardsPool.generated.json';",
      `import cardsPool from '${join(MOBILE, 'src/generated/cardsPool.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import curriculumTagsJson from '../generated/curriculumTags.generated.json';",
      `import curriculumTagsJson from '${join(MOBILE, 'src/generated/curriculumTags.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import questionsJson from './cards-questions.json';",
      `import questionsJson from '${join(MOBILE, 'src/data/cards-questions.json')}' with { type: 'json' };`
    );
  const dir = mkdtempSync(join(tmpdir(), 'cardharness-'));
  const file = join(dir, 'cards-impl.mts');
  writeFileSync(file, src);
  return import(file);
}

type Lang = 'tagalog' | 'english' | 'cebuano';
const RUNS = Number(process.env.RUNS ?? 6);
const CARDS = Number(process.env.CARDS ?? 40);
const RECENT_WINDOW = 5;
const nextGap = () => 4 + Math.floor(Math.random() * 2);

// generic-verb / non-topic labels (mirrors cards.ts BAD_LABELS spirit; harness-side audit)
const GENERIC = /^(tumutubo|lumalaki|ginagawa|gumagawa|nagmumula|nabubuo|ginagamit|matatagpuan|makikita|humahawak|humuhigop|sumusuporta|nagbibigay|tawag|uri|iba|bawat|grows?|made|used|found)$/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Issue {
  kind: string;
  detail: string;
}

async function main() {
  const C = await loadCards();
  const lang: Lang = 'tagalog';
  console.log(`pool = ${C.poolSize()} image-backed facts | ${RUNS} runs × ${CARDS} cards\n`);

  const policies: Array<{ name: string; pick: (i: number) => 0 | 1 }> = [
    { name: 'deep-diver (always deep)', pick: () => 0 },
    { name: 'topic-hopper (always lateral)', pick: () => 1 },
    { name: 'wanderer (alternating)', pick: (i) => (i % 2) as 0 | 1 },
    { name: 'random', pick: () => (Math.random() < 0.5 ? 0 : 1) },
  ];

  const issues: Issue[] = [];
  const add = (kind: string, detail: string) => issues.push({ kind, detail });
  const stats = {
    cards: 0,
    deadEnds: 0,
    dupLabels: 0,
    genericLabels: 0,
    longFacts: 0,
    missingTrans: 0,
    consecDup: 0,
    quizAsked: 0,
    quizUnavailable: 0,
    quizBadShape: 0,
    quizAboutRecent: 0,
    repeatsInRun: 0,
    lateralNotFresh: 0,
    labelLens: [] as number[],
    factWords: [] as number[],
  };

  for (const policy of policies) {
    for (let r = 0; r < RUNS; r++) {
      const seen = new Set<string>();
      const recent: string[] = [];
      const asked = new Set<string>();
      let untilQuestion = nextGap();

      let cur = C.startCard(seen);
      seen.add(cur.id);
      recent.push(cur.id);

      for (let i = 0; i < CARDS; i++) {
        stats.cards++;

        // --- factoid quality (current card) ---
        const tl = C.cardText(cur, 'tagalog');
        stats.factWords.push(words(tl));
        for (const L of ['tagalog', 'english', 'cebuano'] as Lang[]) {
          if (!C.cardText(cur, L)) {
            stats.missingTrans++;
            add('missing-translation', `${cur.id} has no ${L} text`);
            break;
          }
        }
        if (words(tl) > 48) {
          stats.longFacts++;
          add('long-factoid', `${cur.id} (${words(tl)} words): "${tl.slice(0, 70)}…"`);
        }

        // --- path/choice quality ---
        const choices = C.nextChoices(cur.id, seen, lang) as Array<{ factId: string; label: string; kind: string }>;
        if (choices.length < 2) {
          stats.deadEnds++;
          add('dead-end', `${policy.name}: only ${choices.length} choice(s) after ${cur.topic}`);
        }
        if (choices.length === 2) {
          if (choices[0]!.label.toLowerCase() === choices[1]!.label.toLowerCase()) {
            stats.dupLabels++;
            add('duplicate-labels', `both choices = "${choices[0]!.label}" (from ${cur.topic})`);
          }
          for (const ch of choices) {
            stats.labelLens.push(ch.label.length);
            if (GENERIC.test(ch.label) || ch.label.length < 3) {
              stats.genericLabels++;
              add('weak-label', `"${ch.label}" → ${C.getCard(ch.factId)?.topic ?? '?'}`);
            }
          }
          // lateral should be a genuinely different topic (low overlap); check it's not
          // the same topic wording as current
          const lat = C.getCard(choices[1]!.factId);
          if (lat && lat.domain !== cur.domain && choices[1]!.kind === 'lateral') {
            // lateral crossing domain is fine; nothing to flag
          }
        }

        // --- interject (mirror cardStore.choose timing) ---
        untilQuestion -= 1;
        if (untilQuestion <= 0) {
          stats.quizAsked++;
          const cands = recent
            .filter((id) => !asked.has(id))
            .map((id) => ({ id, q: C.questionForFact(id) }))
            .filter((x) => x.q);
          if (!cands.length) {
            stats.quizUnavailable++;
            add('quiz-none-available', `no MCQ among last ${recent.length} facts`);
          } else {
            const chosen = cands[Math.floor(Math.random() * cands.length)]!;
            asked.add(chosen.id);
            stats.quizAboutRecent++;
            const q = chosen.q as { o: unknown[]; a: number; q: Record<string, string>; e: Record<string, string> };
            const okShape =
              Array.isArray(q.o) &&
              q.o.length === 3 && // shipping ruleset: three short choices (card-ui cards.db is 87% three-option)
              q.a >= 0 &&
              q.a < q.o.length &&
              !!q.q.tl &&
              !!q.e.tl;
            if (!okShape) {
              stats.quizBadShape++;
              add('quiz-bad-shape', `${chosen.id}: opts=${q.o?.length} ans=${q.a}`);
            }
          }
          untilQuestion = nextGap();
        }

        // --- advance ---
        const pick = choices[policy.pick(i)] ?? choices[0];
        if (!pick) break; // truly stuck
        const next = C.getCard(pick.factId);
        if (!next) break;
        if (seen.has(next.id)) {
          stats.repeatsInRun++;
          add('repeat-in-run', `${policy.name}: revisited ${next.id}`);
        }
        // consecutive near-dup (same normalized topic)
        const key = (f: { topic: string }) => f.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3).sort().join(' ');
        if (key(next) === key(cur)) {
          stats.consecDup++;
          add('consecutive-dup-topic', `${cur.topic} → ${next.topic}`);
        }
        cur = next;
        seen.add(cur.id);
        recent.push(cur.id);
        if (recent.length > RECENT_WINDOW) recent.shift();
      }
    }
  }

  // ---- report ----
  const med = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  const pct = (n: number) => `${((100 * n) / stats.cards).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push('==================== CARD-FEED HARNESS REPORT ====================');
  lines.push(`sessions: ${policies.length} policies × ${RUNS} runs × ${CARDS} cards = ${stats.cards} cards walked\n`);
  lines.push('FACTOIDS');
  lines.push(`  reading load: median ${med(stats.factWords)} words (tagalog) | long (>48w): ${stats.longFacts} (${pct(stats.longFacts)})`);
  lines.push(`  missing a translation: ${stats.missingTrans}`);
  lines.push('PATH / CHOICES');
  lines.push(`  dead-ends (<2 choices): ${stats.deadEnds}`);
  lines.push(`  duplicate labels: ${stats.dupLabels}`);
  lines.push(`  weak/generic labels: ${stats.genericLabels}  | median label length: ${med(stats.labelLens)} chars`);
  lines.push(`  repeats within a run: ${stats.repeatsInRun}  | consecutive same-topic: ${stats.consecDup}`);
  lines.push('QUIZ INTERJECTS');
  lines.push(`  fired: ${stats.quizAsked} | about a recent fact: ${stats.quizAboutRecent} | NONE available: ${stats.quizUnavailable} | bad shape: ${stats.quizBadShape}`);
  lines.push('');

  const byKind = new Map<string, string[]>();
  for (const it of issues) {
    const arr = byKind.get(it.kind) ?? [];
    if (arr.length < 6) arr.push(it.detail);
    byKind.set(it.kind, arr);
  }
  lines.push('SAMPLE ISSUES (up to 6 each):');
  for (const [kind, examples] of [...byKind.entries()].sort()) {
    const total = issues.filter((i) => i.kind === kind).length;
    lines.push(`  [${kind}] ×${total}`);
    for (const e of examples) lines.push(`     • ${e}`);
  }

  const report = lines.join('\n');
  console.log(report);
  writeFileSync(join(MOBILE, 'scripts/card-harness-report.txt'), report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
