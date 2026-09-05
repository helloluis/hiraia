/**
 * Session walker — records what a READER would see across full feed sessions, headless.
 *
 * The deterministic harness (card-harness.mts) audits the feed's internals (fork cadence,
 * label hygiene, magnet assertions). This one produces TRANSCRIPTS for a judge: every page
 * a simulated reader turns, with exactly the copy, title, ticket label and illustration the
 * app would print — labels resolved the way the display-time fix resolves them (authored
 * title first, topic fragment as the cold fallback), not the raw drawn label.
 *
 * A session = start card → N turns under a reader policy (deep/lateral/random kid), with
 * the magnet exercised by mid-session asks, and quiz interjects at the app's own cadence.
 * All walks use the weighted path (grade/quarter/seen-decay/magnet) — this measures the
 * feed a child actually gets, not the uniform one.
 *
 *   npx tsx scripts/session-walk.mts                    # 12 sessions → walk-out/
 *   RUNS=100 TURNS=30 npx tsx scripts/session-walk.mts
 *   ASKS="dinosaur,geyser,photosynthesis" npx tsx scripts/session-walk.mts
 *
 * Output: walk-out/session-<NN>.json — see README-walks.md. One JSON per session so the
 * judge workflow can fan out one agent per file and merge.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { artPathOf, loadCards } from './load-cards-node.mts';

const MOBILE = new URL('..', import.meta.url).pathname;
const OUT = join(MOBILE, 'scripts/walk-out');

type Lang = 'tagalog' | 'english' | 'cebuano';
const RUNS = Number(process.env.RUNS ?? 12);
const TURNS = Number(process.env.TURNS ?? 30);
const RECENT_WINDOW = 5;
const ASKS = (process.env.ASKS ?? 'dinosaur,geyser,photosynthesis,clownfish,volcano')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const GRADES = [Number(process.env.GRADE ?? 5)];

/** The app's own gap generator (cardStore.nextGap): 4–5 pages between interjects. */
const nextGap = () => 4 + Math.floor(Math.random() * 2);

interface PageRecord {
  n: number;
  id: string;
  /** Index band copy: authored title, else topic made presentable (bandLabel grammar). */
  band: string;
  bandWasFallback: boolean;
  /** The factoid body in the session language. */
  text: string;
  /** Bundled illustration file, when the card has art. */
  art: string | null;
  /** The choice ticket(s) printed at the foot, display-time resolved. */
  tickets: Array<{ label: string; kind: string; shelf: boolean }>;
  /** Quiz interject fired on this page (question text + options + answer). */
  quiz?: { q: string; options: string[]; answer: string };
  /** Magnet state entering this page (null = none). */
  magnet: { query: string; served: number } | null;
}

interface SessionRecord {
  session: number;
  policy: string;
  grade: number;
  quarter: number;
  asks: Array<{ query: string; landedOn: string | null; magnetSetSize: number; releasedAfter: number | null }>;
  pages: PageRecord[];
}

/** Display-time label resolution, mirroring useChoiceLabels in cardTextSource.ts.
 * In Node, textOf reads through synchronously, so the title is always available. */
function resolveLabel(C: any, choice: any, lang: Lang): { label: string; shelf: boolean } {
  if (choice.shelf) return { label: choice.label, shelf: true };
  const fact = C.getCard(choice.factId);
  const title = fact ? C.cardTitle(fact, lang) : '';
  return { label: title ? C.bandLabel(title, fact.topic) : choice.label, shelf: false };
}

function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1;
}

async function main() {
  const C = await loadCards();
  const lang: Lang = 'tagalog';

  const policies: Array<{ name: string; pick: (i: number) => 0 | 1 }> = [
    { name: 'deep-diver', pick: () => 0 },
    { name: 'topic-hopper', pick: () => 1 },
    { name: 'wanderer', pick: (i) => (i % 2) as 0 | 1 },
    { name: 'random', pick: () => (Math.random() < 0.5 ? 0 : 1) },
  ];

  // The art pack: a card has a PICTURE on this device iff its slug is in the bundled head.
  // The path is the one the generated imageMap actually require()s, so the judge views the
  // exact file the device renders; art presence in draws is already handled inside cards.ts
  // through the real artPresence registry.
  const artFile = artPathOf;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // TITLE-COVERAGE TRIPWIRE — deterministic, no judge involved. A card with no authored
  // title is unacceptable by rule: every one the walks surface lands here with its exposure
  // count (how many sessions a reader met it), so the queue is ranked by what children
  // actually hit, not by pool order. With full coverage this file comes out empty — the
  // walk then doubles as a REGRESSION tripwire: any new untitled card reappears here.
  const titleQueue = new Map<string, { id: string; fallback: string; hits: number; lastSession: number }>();

  console.log(`pool = ${C.poolSize()} cards | ${RUNS} sessions × ${TURNS} turns | asks: ${ASKS.join(', ')}\n`);

  for (let s = 0; s < RUNS; s++) {
    const policy = policies[s % policies.length]!;
    const grade = GRADES[s % GRADES.length]!;
    const quarter = quarterOf(new Date());
    const seen = new Set<string>();
    const recent: string[] = [];
    const askedFacts = new Set<string>();
    let threadDepth = 0;
    let untilQuestion = nextGap();
    // Two asks per session, spread out: a real kid asks occasionally, and a walk that asks
    // every few pages never leaves the magnet a window to exhaust (auto-release) or the
    // interject a window to fire — both are behaviours the judge should see.
    const askSchedule = ASKS.slice((s * 2) % ASKS.length).concat(ASKS).slice(0, 2);
    const askEvery = Math.max(6, Math.floor(TURNS / 3));
    const askResults: SessionRecord['asks'] = [];

    // The magnet, walked exactly as cardStore does (form on ask-landing; advance + auto-
    // release on ordinary turns; the [x] path is a magnet the reader cleared, which for a
    // walk is indistinguishable from never forming — the magnet test IS the on-path).
    let magnet: { query: string; ids: ReadonlySet<string>; served: number } | null = null;

    const ctx = (m: typeof magnet) => ({
      studentGrade: grade,
      currentQuarter: quarter,
      now: Date.now(),
      cardSeen: new Map(),
      competencySeen: new Map(),
      magnet: m ? { ids: m.ids, served: m.served } : undefined,
    });

    const record: SessionRecord = {
      session: s,
      policy: policy.name,
      grade,
      quarter,
      asks: askResults,
      pages: [],
    };

    let cur = C.startCard(seen);
    seen.add(cur.id);
    recent.push(cur.id);
    let releasedAtTurn: number | null = null;
    let formedAtTurn = -1;

    for (let i = 0; i < TURNS; i++) {
      // ---- mid-session ask: exercise the magnet exactly as cardStore.ask does ----
      if (askSchedule.length && i > 0 && i % askEvery === 0) {
        const query = askSchedule.shift()!;
        const res = await C.searchCards(query, cur.id, ctx(magnet));
        if (res.best) {
          const ids = res.magnet as string[];
          magnet = ids.length ? { query, ids: new Set(ids), served: 1 } : null;
          formedAtTurn = i;
          releasedAtTurn = null;
          cur = res.best;
          seen.add(cur.id);
          recent.push(cur.id);
          if (recent.length > RECENT_WINDOW) recent.shift();
          threadDepth = 0;
          untilQuestion = nextGap();
          askResults.push({
            query,
            landedOn: C.cardTitle(cur, lang) || cur.topic,
            magnetSetSize: ids.length,
            releasedAfter: null,
          });
        } else {
          askResults.push({ query, landedOn: null, magnetSetSize: 0, releasedAfter: null });
        }
      }

      // ---- the page the reader sees ----
      const title = C.cardTitle(cur, lang);
      const page: PageRecord = {
        n: i,
        id: cur.id,
        band: title ? C.bandLabel(title, cur.topic) : C.topicLabel(cur.topic),
        bandWasFallback: !title,
        text: C.cardText(cur, lang),
        art: artFile(cur.slug),
        tickets: [],
        magnet: magnet ? { query: magnet.query, served: magnet.served } : null,
      };

      // quiz interject at the app's cadence, about a recent card (mirror cardStore.ask)
      untilQuestion -= 1;
      if (untilQuestion <= 0 && !magnet) {
        let quiz: any = null;
        const pickLang = (tri: any) => tri?.[lang === 'english' ? 'en' : lang === 'cebuano' ? 'bis' : 'tl'] ?? tri?.en ?? '';
        for (const id of [...recent].reverse()) {
          const q = C.questionForFact(id);
          if (!q || askedFacts.has(q.f)) continue;
          quiz = q;
          askedFacts.add(q.f);
          break;
        }
        if (quiz) {
          page.quiz = {
            q: pickLang(quiz.q),
            options: (quiz.o ?? []).map(pickLang),
            answer: pickLang(quiz.o?.[quiz.a]),
          };
        }
        untilQuestion = nextGap();
      }

      // ---- choices + display-time labels ----
      const depth = threadDepth + 1;
      const choices = C.nextChoices(cur.id, seen, lang, {
        threadDepth: depth,
        recentIds: [...recent],
        ctx: ctx(magnet),
      });
      threadDepth = choices.length > 1 ? 0 : depth;
      page.tickets = choices.map((c: any) => {
        const r = resolveLabel(C, c, lang);
        return { label: r.label, kind: c.kind, shelf: r.shelf };
      });

      if (page.bandWasFallback) {
        const q = titleQueue.get(cur.id) ?? { id: cur.id, fallback: page.band, hits: 0, lastSession: s };
        q.hits += 1;
        q.lastSession = s;
        titleQueue.set(cur.id, q);
      }
      record.pages.push(page);

      // ---- the turn: advance along the policy, then the magnet transition ----
      // A reader taps the ticket that exists: single-path pages have only the deep slot,
      // so a lateral-leaning policy takes what the page offers (choice 0).
      const wanted = policy.pick(i);
      const pick = choices[wanted] ?? choices[0];
      if (!pick) break; // dead end with no escapes
      const next = C.getCard(pick.factId);
      if (!next) break;
      if (magnet && magnet.ids.has(next.id)) magnet.served += 1;
      seen.add(next.id);
      recent.push(next.id);
      if (recent.length > RECENT_WINDOW) recent.shift();
      cur = next;
      if (magnet && releasedAtTurn === null && !C.hasServableMagnet(cur.id, magnet.ids, seen, recent)) {
        releasedAtTurn = i;
        const last = askResults[askResults.length - 1];
        if (last && last.releasedAfter === null) last.releasedAfter = i - formedAtTurn;
        magnet = null;
      }
    }

    writeFileSync(join(OUT, `session-${String(s).padStart(2, '0')}.json`), JSON.stringify(record, null, 1));
    const fallbacks = record.pages.filter((p) => p.bandWasFallback).length;
    const quizzes = record.pages.filter((p) => p.quiz).length;
    console.log(
      `session ${String(s).padStart(2, '0')}  ${policy.name.padEnd(13)} ${String(record.pages.length).padStart(2)} pages  ` +
        `${quizzes} quizzes  band-fallback ${fallbacks}  asks: ${askResults.map((a) => `${a.query}→${a.magnetSetSize}cards`).join(' ') || '—'}`
    );
  }
  const queuePath = join(OUT, 'TITLE-QUEUE.json');
  writeFileSync(
    queuePath,
    JSON.stringify(
      [...titleQueue.values()].sort((a, b) => b.hits - a.hits),
      null,
      1
    )
  );

  console.log(`\ntranscripts → ${OUT}`);
  console.log(
    titleQueue.size
      ? `!! TITLE COVERAGE: ${titleQueue.size} untitled card(s) hit — queued in TITLE-QUEUE.json`
      : `title coverage: 100% across ${RUNS} sessions (queue empty)`
  );
  // Non-zero exit when any untitled card surfaced: a CI tripwire, loud by design.
  if (titleQueue.size) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
