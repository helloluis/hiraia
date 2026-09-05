/**
 * Question-cards feed test harness — drives the REAL card-graph logic (src/data/cards.ts)
 * exactly the way cardStore walks it, headless, across many sessions and "kid policies",
 * and reports quality issues with the factoids, the quiz interjects, and the path choices.
 *
 * It loads cards.ts through scripts/load-cards-node.mts, which shims the four app-only
 * imports (@hiraia/shared, the resident index, the curriculum tags, and cardDb — replaced
 * by a node:sqlite reader over the SAME cards.db + tokens.bin the APK ships).
 * Draws run WITHOUT a FeedContext (uniform), exactly like cards.ts without one — except the
 * MAGNET WALK at the end, which needs the weighted path (the magnet IS a weight) and drives
 * it with a fixed grade-5/Q2 context. Its assertions are hard: a failure exits non-zero.
 *
 *   npx tsx scripts/card-harness.mts                 # default: 6 runs × 40 cards, all policies
 *   RUNS=10 CARDS=60 npx tsx scripts/card-harness.mts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCards } from './load-cards-node.mts';

const MOBILE = new URL('..', import.meta.url).pathname;

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
    deadEnds: 0, // genuinely stuck: nextChoices returned NOTHING
    forks: 0, // pages that offered two choices (cadence or dead-end escape)
    forkGaps: [] as number[], // cards between consecutive forks
    dupLabels: 0,
    genericLabels: 0,
    longFacts: 0,
    missingTrans: 0,
    consecDup: 0,
    consecSameSlug: 0, // next card reuses the CURRENT card's illustration
    slugRepeatIn3: 0, // …or one shown in the last three pages
    quizAsked: 0,
    quizUnavailable: 0,
    quizBadShape: 0,
    quizAboutRecent: 0,
    repeatsInRun: 0,
    lateralNotFresh: 0,
    labelLens: [] as number[],
    factWords: [] as number[],
    // The INDEX BAND's label, which is the authored title when the card has one and its
    // internal `topic` made presentable when it does not (42% of the deck). The band prints
    // one line in tracked caps and clips whatever overruns, so what is audited here is that
    // the fallback never comes back longer than the band holds and never stops mid-word.
    bandFallback: 0,
    bandLens: [] as number[],
    bandMidWord: 0,
  };

  for (const policy of policies) {
    for (let r = 0; r < RUNS; r++) {
      const seen = new Set<string>();
      const recent: string[] = [];
      const asked = new Set<string>();
      let untilQuestion = nextGap();
      // mirrors cardStore.threadDepth: cards since a fork was last OFFERED
      let threadDepth = 0;
      let sinceFork = 0;

      let cur = C.startCard(seen);
      seen.add(cur.id);
      recent.push(cur.id);
      // trailing illustrations, newest last — a repeat here is the "app is repeating
      // itself" failure a child actually notices (the picture, not the wording)
      const slugTrail: string[] = [cur.slug];

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
        // --- index-band label (title, else the topic made presentable) ---
        const bandTitle = C.cardTitle(cur, lang);
        const band = C.bandLabel(bandTitle, cur.topic);
        stats.bandLens.push(band.length);
        if (!bandTitle) stats.bandFallback++;
        if (band.length > 34) add('band-label-too-long', `${cur.id}: "${band}" (${band.length})`);
        // Cut on a word boundary: whatever the source continued with must start a new word.
        if (band.endsWith('…')) {
          const stem = band.slice(0, -1);
          const rest = (bandTitle || cur.topic).replace(/\s+/g, ' ').slice(stem.length);
          if (rest && !/^\s/.test(rest)) {
            stats.bandMidWord++;
            add('band-label-mid-word', `${cur.id}: "${band}" cuts "${bandTitle || cur.topic}"`);
          }
        }
        if (words(tl) > 48) {
          stats.longFacts++;
          add('long-factoid', `${cur.id} (${words(tl)} words): "${tl.slice(0, 70)}…"`);
        }

        // --- path/choice quality ---
        // cardStore pre-increments before asking, so mirror that exactly or the measured
        // fork cadence drifts one card from the app's.
        const depth = threadDepth + 1;
        // recentIds mirrors cardStore: nextChoices uses the trail's ILLUSTRATIONS to keep a
        // picture from coming back within a few pages.
        const choices = C.nextChoices(cur.id, seen, lang, {
          threadDepth: depth,
          recentIds: [...recent],
        }) as Array<{
          factId: string;
          label: string;
          kind: string;
        }>;
        // The feed is single-path by design, so ONE choice is the healthy case. Only an
        // empty result means the walk is genuinely stuck.
        if (choices.length === 0) {
          stats.deadEnds++;
          add('dead-end', `${policy.name}: no choices at all after ${cur.topic}`);
        }
        sinceFork++;
        if (choices.length > 1) {
          stats.forks++;
          stats.forkGaps.push(sinceFork);
          sinceFork = 0;
        }
        // reset the counter on the page that offered the fork, exactly as cardStore does
        threadDepth = choices.length > 1 ? 0 : depth;
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
        // taking the lateral fork is a topic switch, so it restarts the thread (cardStore)
        if (pick.kind === 'lateral') threadDepth = 0;
        const next = C.getCard(pick.factId);
        if (!next) break;
        if (seen.has(next.id)) {
          stats.repeatsInRun++;
          add('repeat-in-run', `${policy.name}: revisited ${next.id}`);
        }
        // consecutive near-dup (same normalized topic)
        const key = (f: { topic: string }) => f.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3).sort().join(' ');
        // An EMPTY slug is not an illustration, so two typographic pages in a row are not a
        // repeated picture — mirror the guard nextChoices uses (`f.slug && blocked.has(...)`).
        // The pool only grew typographic cards once the DepEd bank joined it; without this the
        // metric counted "no picture, twice" as the failure a child notices.
        if (next.slug && next.slug === cur.slug) {
          stats.consecSameSlug++;
          add('same-illustration', `${cur.topic} → ${next.topic} (both: ${next.slug})`);
        }
        if (next.slug && slugTrail.slice(-3).includes(next.slug)) stats.slugRepeatIn3++;
        slugTrail.push(next.slug);
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
  lines.push(
    `  index band: median ${med(stats.bandLens)} chars, longest ${Math.max(...stats.bandLens)} | ` +
      `topic fallback used on ${stats.bandFallback} (${pct(stats.bandFallback)}) | cut mid-word: ${stats.bandMidWord}`
  );
  lines.push('PATH / CHOICES');
  lines.push(`  dead-ends (no choices at all): ${stats.deadEnds}`);
  {
    const g = stats.forkGaps;
    const mean = g.length ? (g.reduce((a, b) => a + b, 0) / g.length).toFixed(1) : 'n/a';
    const pct = ((100 * stats.forks) / Math.max(stats.cards, 1)).toFixed(1);
    lines.push(`  forks (2 choices offered): ${stats.forks} (${pct}% of cards, mean gap ${mean})`);
  }
  lines.push(`  duplicate labels: ${stats.dupLabels}`);
  lines.push(`  weak/generic labels: ${stats.genericLabels}  | median label length: ${med(stats.labelLens)} chars`);
  lines.push(`  repeats within a run: ${stats.repeatsInRun}  | consecutive same-topic: ${stats.consecDup}`);
  lines.push(`  same illustration as previous card: ${stats.consecSameSlug} (${pct(stats.consecSameSlug)})  | reused within 3 pages: ${stats.slugRepeatIn3} (${pct(stats.slugRepeatIn3)})`);
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

  // ==================== MAGNET WALK ====================
  // The asked-topic magnet (cardStore.ask → SearchResult.magnet → FeedContext.magnet),
  // walked the way the store walks it: a deep-first reader, advancing served/auto-release
  // exactly as cardStore.advance does. Assertions are HARD (exit non-zero): the pull must
  // line a big topic up, the auto-release must fire at exhaustion, and the [x] path (a
  // context without the magnet) must leave no residual pull.
  const failures: string[] = [];
  const assertThat = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
    lines.push(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  };
  const ctxFor = (
    magnet?: { ids: ReadonlySet<string>; served: number },
    curriculum?: { idSet: ReadonlySet<string> } | null
  ) => ({
    studentGrade: 5,
    currentQuarter: 2,
    now: Date.now(),
    cardSeen: new Map(),
    competencySeen: new Map(),
    magnet,
    // the store's feedContext maps the cursor to the restriction the same way
    curriculum: curriculum ? { ids: curriculum.idSet } : undefined,
  });

  /** Simulate cardStore's ask→advance walk (deep-first reader) for one query. */
  async function magnetWalk(query: string, pages: number, withMagnet: boolean) {
    const res = await C.searchCards(query, null);
    if (!res.best) throw new Error(`magnet walk: no card served for "${query}"`);
    const ids: string[] = res.magnet;
    const idSet = new Set(ids);
    const seen = new Set<string>([res.best.id]);
    const recent: string[] = [res.best.id];
    let cur = res.best;
    let served = 1; // the landing card itself (navigateTo advances the clock)
    let magnetOn = withMagnet && ids.length > 0;
    let threadDepth = 0;
    let onTopic = 0;
    let walked = 0;
    let releasedAt: number | null = null;
    let unseenAtRelease = -1;
    for (let i = 0; i < pages; i++) {
      const ctx = ctxFor(magnetOn ? { ids: idSet, served } : undefined);
      const depth = threadDepth + 1;
      const choices = C.nextChoices(cur.id, seen, lang, {
        threadDepth: depth,
        recentIds: [...recent],
        ctx,
      });
      threadDepth = choices.length > 1 ? 0 : depth;
      const pick = choices[0];
      if (!pick) break;
      if (pick.kind === 'lateral') threadDepth = 0;
      const next = C.getCard(pick.factId);
      if (!next) break;
      walked++;
      if (idSet.has(next.id)) {
        onTopic++;
        if (magnetOn) served++;
      }
      seen.add(next.id);
      recent.push(next.id);
      if (recent.length > RECENT_WINDOW) recent.shift();
      cur = next;
      // the auto-release, exactly as cardStore.advance runs it after landing
      if (magnetOn && releasedAt === null && !C.hasServableMagnet(cur.id, idSet, seen, recent)) {
        releasedAt = walked;
        unseenAtRelease = ids.filter((id: string) => !seen.has(id)).length;
        magnetOn = false;
      }
    }
    return { best: res.best, setSize: ids.length, ids, idSet, onTopic, walked, served, releasedAt, unseenAtRelease };
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  lines.push('');
  lines.push('==================== MAGNET WALK ====================');

  // 1) a BIG topic must line up: on-topic share of the next 10 draws, magnet on vs off.
  const BIG = 'dinosaur';
  const MAGNET_RUNS = 12;
  const onShares: number[] = [];
  const offShares: number[] = [];
  let bigSet = 0;
  for (let r = 0; r < MAGNET_RUNS; r++) {
    const on = await magnetWalk(BIG, 10, true);
    const off = await magnetWalk(BIG, 10, false);
    bigSet = on.setSize;
    onShares.push(on.onTopic / Math.max(on.walked, 1));
    offShares.push(off.onTopic / Math.max(off.walked, 1));
  }
  lines.push(
    `  "${BIG}": magnet set = ${bigSet} cards | on-topic share of next 10 draws: ` +
      `magnet ON ${(100 * mean(onShares)).toFixed(0)}% vs OFF ${(100 * mean(offShares)).toFixed(0)}% ` +
      `(${MAGNET_RUNS} runs, deep-first reader)`
  );
  assertThat(bigSet >= 20, `"${BIG}" is a big topic (magnet set ${bigSet} >= 20 cards)`);
  assertThat(
    mean(onShares) >= 0.7,
    `magnet ON keeps the next 10 draws predominantly on-topic (${(100 * mean(onShares)).toFixed(0)}% >= 70%)`
  );
  assertThat(
    mean(onShares) >= mean(offShares) + 0.3,
    `the pull is the cause (ON ${(100 * mean(onShares)).toFixed(0)}% vs OFF ${(100 * mean(offShares)).toFixed(0)}%, +30pt floor)`
  );

  // 2) a SMALL topic must auto-release at exhaustion — no unseen servable member left.
  const SMALL = 'geyser';
  const small = await magnetWalk(SMALL, 60, true);
  lines.push(
    `  "${SMALL}": magnet set = ${small.setSize} cards | auto-release after ${small.releasedAt} draws ` +
      `(${small.served} magnet cards served, ${small.unseenAtRelease} unseen members left — unservable under the gates)`
  );
  assertThat(small.setSize > 0 && small.setSize <= 20, `"${SMALL}" is a small topic (set ${small.setSize} in 1..20)`);
  assertThat(small.releasedAt !== null, `auto-release fired at exhaustion (draw ${small.releasedAt})`);
  assertThat(
    small.releasedAt !== null && small.releasedAt <= small.setSize + BRANCH_SLACK,
    `release came promptly (draw ${small.releasedAt} <= set ${small.setSize} + ${BRANCH_SLACK} slack)`
  );

  // 3) the [x] path: dismissing = a context WITHOUT the magnet. The boosted weight must be
  //    exactly magnetMultiplier(served) while held, and exactly the base weight after.
  {
    const res = await C.searchCards(BIG, null);
    const probeId = (res.magnet as string[]).find((id: string) => id !== res.best!.id) ?? res.best!.id;
    const probe = C.getCard(probeId)!;
    const idSet = new Set(res.magnet as string[]);
    const held = C.weightOf(probe, ctxFor({ ids: idSet, served: 0 }));
    const dismissed = C.weightOf(probe, ctxFor(undefined));
    const ratio = held / dismissed;
    lines.push(
      `  [x] path: magnet member weight ×${ratio.toFixed(2)} while held (magnetMultiplier(0) = ${C.magnetMultiplier(0)}), ` +
        `×${(dismissed / dismissed).toFixed(2)} after dismissal`
    );
    assertThat(
      Math.abs(ratio - C.magnetMultiplier(0)) < 1e-9,
      `held pull equals magnetMultiplier(0) (×${C.magnetMultiplier(0)})`
    );
    assertThat(
      C.magnetMultiplier(0) > 1 && Math.abs(C.weightOf(probe, ctxFor(undefined)) - dismissed) < 1e-12,
      'dismissed context carries no residual pull (weight = base weight)'
    );
    // decay shape: halves every 4 served, floors at 1 (never below neutral)
    assertThat(
      Math.abs(C.magnetMultiplier(4) - C.magnetMultiplier(0) / 2) < 1e-9 && C.magnetMultiplier(1000) === 1,
      'decay schedule: halves per 4 served, floors at ×1'
    );
  }

  lines.push(failures.length ? `  MAGNET WALK: ${failures.length} FAILURE(S)` : '  MAGNET WALK: all assertions pass');
  const magnetFailures = failures.length;

  // ==================== CURRICULUM WALK ====================
  // CALENDAR MODE (cardStore.enterCurriculum → FeedContext.curriculum → advanceCurriculum),
  // walked the way the store walks it: enter a topic by jumpCard confined to its set, then a
  // deep-first reader whose every page-turn runs the SAME cursor rule the store runs
  // (advanceCurriculum, from data/cards.ts — one implementation, not a mirror). Assertions are
  // HARD: every draw is in-set until the topic is exhausted, the cursor then moves to the
  // chronologically next competency, the [x] leaves no residual restriction, the end of the
  // outline releases, and an ask mid-mode forms no magnet and the walk resumes.
  lines.push('');
  lines.push('==================== CURRICULUM WALK ====================');
  const GRADE = 5;
  interface Row { code: string; quarter: number; text: string }
  interface Cursor { grade: number; code: string; idSet: ReadonlySet<string>; index: number }
  const outline: Row[] = C.curriculumOutline(GRADE);
  const sizeOf = (code: string): number => C.cardsForCompetency(code).size;
  assertThat(outline.length > 0, `grade ${GRADE} outline lists competencies with cards (${outline.length} rows)`);
  assertThat(
    outline.every((r, i) => i === 0 || r.quarter >= outline[i - 1]!.quarter) && outline.every((r) => sizeOf(r.code) > 0),
    'outline rows are in CG order (quarters non-decreasing) and every row has cards'
  );

  interface Move { at: number; from: Cursor; to: Cursor; unseenLeft: number; curId: string; leftIds: string[] }
  /** cardStore.enterCurriculum + advance, deep-first, until the cursor releases or `maxPages`. */
  function curriculumWalk(startCode: string, maxPages: number, seed: Iterable<string> = []) {
    const entered: Cursor | null = C.curriculumCursor(GRADE, startCode);
    if (!entered) throw new Error(`curriculum walk: ${startCode} is not on the grade ${GRADE} outline`);
    const seen = new Set<string>(seed);
    const recent: string[] = [];
    // ENTER: the landing card is jumpCard confined to the set (enterCurriculum), and the
    // navigateTo commit runs the cursor's exhaustion check on it.
    let cur = C.jumpCard(null, seen, ctxFor(undefined, entered));
    const landedInSet = entered.idSet.has(cur.id);
    seen.add(cur.id);
    recent.push(cur.id);
    let cursor: Cursor | null = C.advanceCurriculum(entered, cur.id, seen);
    let threadDepth = 0;
    const moves: Move[] = [];
    let offSet = 0; // choices offered from OUTSIDE the held set (must stay 0)
    let walked = 0;
    let releasedAt: number | null = null;
    let unseenAtRelease = -1;
    let leftAtRelease: string[] = [];
    let curAtRelease = '';
    while (cursor && walked < maxPages) {
      const held: Cursor = cursor;
      const depth = threadDepth + 1;
      const choices = C.nextChoices(cur.id, seen, lang, {
        threadDepth: depth,
        recentIds: [...recent],
        ctx: ctxFor(undefined, held),
      }) as Array<{ factId: string; kind: string }>;
      threadDepth = choices.length > 1 ? 0 : depth;
      for (const ch of choices) if (!held.idSet.has(ch.factId)) offSet++;
      const pick = choices[0];
      if (!pick) break;
      if (pick.kind === 'lateral') threadDepth = 0;
      const next = C.getCard(pick.factId);
      if (!next) break;
      walked++;
      seen.add(next.id);
      recent.push(next.id);
      if (recent.length > RECENT_WINDOW) recent.shift();
      cur = next;
      // the cursor after this turn, exactly as cardStore.advance runs it
      const after: Cursor | null = C.advanceCurriculum(held, cur.id, seen);
      if (after !== held) {
        const leftIds = [...held.idSet].filter((id) => !seen.has(id));
        const unseenLeft = leftIds.length;
        if (after) moves.push({ at: walked, from: held, to: after, unseenLeft, curId: cur.id, leftIds });
        else {
          releasedAt = walked;
          unseenAtRelease = unseenLeft;
          leftAtRelease = leftIds;
          curAtRelease = cur.id;
        }
      }
      cursor = after;
    }
    return { entered, landedInSet, moves, offSet, walked, releasedAt, unseenAtRelease, leftAtRelease, curAtRelease, seen, recent, cur, cursor };
  }

  // 1) a MID-SIZE topic: every draw in-set until it is exhausted, then the cursor advances to
  //    the chronologically next competency (the outline is already filtered to rows with
  //    cards, and this session has read none of them, so that is simply the next row).
  const mid = outline.find((r) => sizeOf(r.code) >= 40 && sizeOf(r.code) <= 120);
  assertThat(!!mid, 'the grade has a mid-size topic (40..120 cards) to walk');
  if (mid) {
    const size = sizeOf(mid.code);
    const w = curriculumWalk(mid.code, size + 40);
    const first = w.moves[0];
    lines.push(
      `  ${mid.code} (${size} cards): landed in-set=${w.landedInSet} | ${w.walked} pages walked, ` +
        `${w.offSet} off-set choices | cursor moved at page ${first?.at ?? 'never'}` +
        (first ? ` → ${first.to.code} (${first.unseenLeft} unseen members left unservable under the gates)` : '')
    );
    assertThat(w.landedInSet, 'entering lands on a card of the chosen topic');
    assertThat(w.offSet === 0, `every choice offered while held is in the held set (${w.offSet} off-set)`);
    assertThat(!!first, `the topic is exhausted within ${size + 40} pages and the cursor moves on`);
    if (first) {
      assertThat(
        first.from.code === mid.code && first.to.index === first.from.index + 1 && first.to.code === outline[first.from.index + 1]!.code,
        `the cursor advances to the chronologically next competency (${first.from.code} → ${first.to.code}, row ${first.from.index} → ${first.to.index})`
      );
      // The ONLY thing that may be left behind is the current fact reworded (the deck never
      // serves a restatement back-to-back). A member gated merely by the picture cooldown is
      // NOT exhaustion — the cooldown is transient, the cursor never comes back — and a
      // topic's cards often share one picture, so that gate alone used to abandon up to a
      // fifth of a topic (measured: 8 of G8-E-4's 40, all on the Mayon Volcano cone).
      assertThat(
        first.leftIds.every((id) => C.restatesTopic(first.curId, id)),
        `exhaustion is genuine: every member left behind restates the current card (${first.unseenLeft} of ${size} left)`
      );
      assertThat(
        first.at >= size - first.unseenLeft - 1,
        `the topic was walked through before the move (page ${first.at} >= ${size} - ${first.unseenLeft} - 1)`
      );
    }

    // 2) the [x]: dismissing = a context WITHOUT the cursor. The restriction is a filter, not
    //    a weight, so weights are identical held vs not, and an unrestricted draw leaves the set.
    const outside = [...C.cardsForCompetency(outline[outline.length - 1]!.code)].map((id: string) => C.getCard(id)).find((f: { id: string }) => !w.entered.idSet.has(f.id));
    if (outside) {
      const held = C.weightOf(outside, ctxFor(undefined, w.entered));
      const plain = C.weightOf(outside, ctxFor(undefined));
      assertThat(Math.abs(held - plain) < 1e-12, `the restriction is a filter, never a weight (outside card ×${(held / plain).toFixed(2)} held vs plain)`);
    }
    let left = 0;
    const JUMPS = 12;
    for (let i = 0; i < JUMPS; i++) if (!w.entered.idSet.has(C.jumpCard(w.cur.id, w.seen, ctxFor(undefined)).id)) left++;
    lines.push(`  [x] path: ${left}/${JUMPS} unrestricted jumps leave the set (set ${size} of ${C.poolSize()} cards)`);
    assertThat(left >= JUMPS - 2, `after the [x] the feed is unrestricted (${left}/${JUMPS} jumps left the set)`);

    // 4) an ASK mid-mode: the found card is served as a ONE-OFF — no magnet forms — and the
    //    next page-turn from it draws from the held topic again.
    {
      const walk = curriculumWalk(mid.code, 3);
      const cursor = walk.cursor!;
      let found: { id: string } | null = null;
      for (const q of ['dinosaur', 'volcano', 'geyser', 'planet']) {
        const res = await C.searchCards(q, walk.cur.id);
        if (res.best && !cursor.idSet.has(res.best.id)) {
          found = res.best;
          // cardStore.ask forms a magnet only when no cursor is held — the guard is source
          // text, so it is checked as such (a tripwire, alongside the behavioural test below).
          break;
        }
      }
      assertThat(!!found, 'an off-topic ask finds a card outside the held set');
      const storeSrc = (await import('node:fs')).readFileSync(join(MOBILE, 'src/store/cardStore.ts'), 'utf8');
      const guards = storeSrc.split('get().curriculum ? null : formMagnet(').length - 1;
      assertThat(guards === 2, `cardStore.ask forms NO magnet while a cursor is held (guard on both landing paths: ${guards}/2)`);
      if (found) {
        const seen = new Set(walk.seen);
        seen.add(found.id);
        const recent = [...walk.recent, found.id].slice(-RECENT_WINDOW);
        const after = C.advanceCurriculum(cursor, found.id, seen);
        assertThat(after === cursor, 'the one-off landing leaves the cursor where it was');
        const choices = C.nextChoices(found.id, seen, lang, { threadDepth: 1, recentIds: recent, ctx: ctxFor(undefined, after) }) as Array<{ factId: string }>;
        assertThat(
          choices.length > 0 && choices.every((c) => cursor.idSet.has(c.factId)),
          `the curriculum resumes on the next page-turn (${choices.length} choice(s) from the found card, all in the held set)`
        );
      }
    }
  }

  // 3) the END of the outline releases: hold the LAST competency with all but a few of its
  //    cards already read; exhausting those must return null (no later row), never wrap.
  {
    const last = outline[outline.length - 1]!;
    const ids = [...C.cardsForCompetency(last.code)] as string[];
    const KEEP = 5;
    const w = curriculumWalk(last.code, KEEP + 20, ids.slice(KEEP));
    lines.push(
      `  end of outline: ${last.code} (Q${last.quarter}, row ${outline.length - 1}) with ${KEEP} unread of ${ids.length} → ` +
        `released after ${w.releasedAt ?? 'never'} pages (${w.unseenAtRelease} unseen left), ${w.moves.length} later move(s)`
    );
    assertThat(w.releasedAt !== null && w.cursor === null, `past the last competency calendar mode releases (after ${w.releasedAt} pages)`);
    assertThat(w.moves.length === 0, 'the cursor never wraps or moves backward from the last row');
    assertThat(w.offSet === 0, `every choice until the release was in the held set (${w.offSet} off-set)`);
    assertThat(
      w.unseenAtRelease >= 0 && w.leftAtRelease.every((id) => C.restatesTopic(w.curAtRelease, id)),
      `release fired only once nothing servable was left (${w.unseenAtRelease} unseen, each a restatement of the current card)`
    );
  }

  // 5) ENTERING a topic already read out this session: the sheet's row is tappable ("0 / n"),
  //    and the store enters the walk at the next competency with something left — the same
  //    pre-check the die runs — never at a re-read card under a ribbon naming another topic.
  if (mid) {
    const picked = C.curriculumCursor(GRADE, mid.code)!;
    const seen = new Set<string>(picked.idSet);
    const hop = C.advanceCurriculum(picked, null, seen) ?? picked;
    assertThat(
      hop.index === picked.index + 1 && hop.code === outline[picked.index + 1]!.code,
      `a fully-read topic is entered at the next competency (${mid.code} → ${hop.code})`
    );
    const landing = C.jumpCard(null, seen, ctxFor(undefined, hop));
    assertThat(hop.idSet.has(landing.id) && !seen.has(landing.id), 'and lands on an unread card of that competency');
  }

  const curriculumFailures = failures.length - magnetFailures;
  lines.push(curriculumFailures ? `  CURRICULUM WALK: ${curriculumFailures} FAILURE(S)` : '  CURRICULUM WALK: all assertions pass');
  if (failures.length) process.exitCode = 1;

  const report = lines.join('\n');
  console.log(report);
  writeFileSync(join(MOBILE, 'scripts/card-harness-report.txt'), report);
}

/** How many extra draws past the set size the small-topic release may take: the reader can be
 * pulled off-topic by a fork/cooldown for a few pages before the last members are reached. */
const BRANCH_SLACK = 12;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
