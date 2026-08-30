/**
 * Art-presence check — the feed with an art pack that does NOT cover the deck.
 *
 * The APK bundles the head of one ordered list of illustrations (~140 MB, 57% of the cards)
 * and backfill supplies the tail while the app is open, so "this card has a picture" is a
 * property of the installation and it changes mid-session. This script drives the REAL feed
 * (src/data/cards.ts, through scripts/load-cards-node.mts) against the REAL registry
 * (src/data/artPresence.ts) and asserts the four things that must hold:
 *
 *   1. IDENTITY   — with every image present the feed is bit-identical to the PRE-PRESENCE
 *                   build. This is the property that lets the change ship before the art pack
 *                   is actually cut, and it is checked against the old code, not against
 *                   itself: load-cards-node reverse-applies PRE_PRESENCE_PATCH to build the
 *                   feed as it behaved before this module existed, and the two are walked
 *                   under the same seed. Same cards, same choices, same labels.
 *   2. NO SHRINK  — with a partial pack the deck does not narrow to the illustrated head.
 *                   Cards without art are served at their pool rate; nothing dead-ends.
 *   3. COOLDOWN   — the illustration cooldown holds for pictures the reader can SEE, and stops
 *                   burning its five slots on pictures that are not on the device.
 *   4. LIVE       — an image landing mid-session flips the answer, notifies subscribers, and
 *                   puts that slug back under cooldown.
 *   5. REHYDRATE  — the backfilled table is memory; the installed-shard set is not. Losing the
 *                   registry (a relaunch) and replaying it from disk must restore exactly the
 *                   presence set that was there, or paid-for art is unreachable forever.
 *
 * It also benchmarks startCard/nextChoices in each configuration, because the presence test
 * sits on the page-turn path.
 *
 *   npx tsx scripts/art-presence-check.mts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCards } from './load-cards-node.mts';

const MOBILE = new URL('..', import.meta.url).pathname;
/** Share of card art the shipping 140 MB pack covers (docs: 57.1–58.5% per grade). */
const BUNDLED_SHARE = 0.571;

// ---------------------------------------------------------------- helpers
/** Deterministic PRNG so two configurations walk the SAME sequence of draws. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stable string hash — picks the "bundled" subset the same way on every run. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(1)}%`;
const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return {
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    p50: s[Math.floor(s.length * 0.5)]!,
    p95: s[Math.floor(s.length * 0.95)]!,
  };
};
const fmt = (o: { mean: number; p50: number; p95: number }) =>
  `mean ${o.mean.toFixed(3)} ms | p50 ${o.p50.toFixed(3)} | p95 ${o.p95.toFixed(3)}`;

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- inputs
const C = await loadCards();
/**
 * The SAME feed with art presence reverse-patched out (see PRE_PRESENCE_PATCH). A second
 * module instance, but it imports the registry by the same absolute path, so `presence`
 * below steers both — which is what makes the identity check a real old-vs-new comparison.
 */
const OLD = await loadCards({ prePresence: true });
/** The registry cards.ts itself consults — re-exported by the loader, never re-imported. */
const presence = C.artPresence as typeof import('../src/data/artPresence.ts');
const cardsIndex = JSON.parse(
  readFileSync(join(MOBILE, 'src/generated/cardsIndex.generated.json'), 'utf8')
) as { cards: { id: string; slug: string }[] };
/** IMAGE_MAP's keys, read as text: the module itself is 30k require()s and cannot load here. */
const MAPPED = new Set(
  [...readFileSync(join(MOBILE, 'src/generated/imageMap.ts'), 'utf8').matchAll(/^ {2}"([^"]+)": require/gm)].map(
    (m) => m[1]!
  )
);
const CARD_SLUGS = cardsIndex.cards.map((c) => c.slug);
const NON_EMPTY = CARD_SLUGS.filter(Boolean);
const FULL = new Set(MAPPED);
/** A 57% pack: the head of the list, modelled as a stable pseudo-random subset of card art. */
const PARTIAL = new Set([...MAPPED].filter((s) => hash32(s) / 2 ** 32 < BUNDLED_SHARE));

const CTX = {
  studentGrade: 5,
  currentQuarter: 2,
  now: Date.UTC(2026, 7, 30),
  cardSeen: new Map(),
  competencySeen: new Map(),
};

// ---------------------------------------------------------------- the walk
interface Walk {
  /** (card id, joined choice labels) per page — the full observable trace of a session. */
  trace: string[];
  pages: number;
  deadEnds: number;
  /** pages whose card has no art on this device (they render through posterFor) */
  posterPages: number;
  /** next card reused an illustration the reader COULD SEE within SLUG_COOLDOWN pages */
  visibleRepeat: number;
  /** …the same, for an illustration that is NOT on the device (invisible, so not a repeat) */
  invisibleRepeat: number;
  distinct: number;
}

/** `feed` is the module under test: the shipping cards.ts, or the pre-presence build (OLD). */
function walkOf(feed: any, seed: number, pages: number, weighted: boolean): Walk {
  const orig = Math.random;
  (Math as { random: () => number }).random = mulberry32(seed);
  const ctx = weighted ? CTX : undefined;
  const trace: string[] = [];
  const seen = new Set<string>();
  const recent: string[] = [];
  const out: Walk = {
    trace,
    pages: 0,
    deadEnds: 0,
    posterPages: 0,
    visibleRepeat: 0,
    invisibleRepeat: 0,
    distinct: 0,
  };
  let cur = feed.startCard(seen, ctx);
  seen.add(cur.id);
  recent.push(cur.id);
  let depth = 0;
  for (let i = 0; i < pages; i += 1) {
    out.pages += 1;
    if (!feed.cardHasArt(cur)) out.posterPages += 1;
    const choices = feed.nextChoices(cur.id, seen, 'tagalog', {
      threadDepth: depth + 1,
      recentIds: [...recent],
      ctx,
    }) as { factId: string; label: string; kind: string }[];
    trace.push(`${cur.id}|${choices.map((c) => `${c.kind}:${c.factId}:${c.label}`).join('~')}`);
    if (!choices.length) {
      out.deadEnds += 1;
      break;
    }
    depth = choices.length > 1 ? 0 : depth + 1;
    const pick = choices[Math.floor(Math.random() * choices.length)]!;
    if (pick.kind === 'lateral') depth = 0;
    const next = feed.getCard(pick.factId)!;
    // did we just serve a picture that was on screen in the last SLUG_COOLDOWN pages?
    const trail = [cur.id, ...recent.slice(-5)];
    if (next.slug && trail.some((id) => feed.getCard(id)?.slug === next.slug)) {
      if (feed.cardHasArt(next)) out.visibleRepeat += 1;
      else out.invisibleRepeat += 1;
    }
    cur = next;
    seen.add(cur.id);
    recent.push(cur.id);
    if (recent.length > 5) recent.shift();
  }
  out.distinct = seen.size;
  (Math as { random: () => number }).random = orig;
  return out;
}

/** The shipping feed, which is what checks 2-4 are about. */
const walk = (seed: number, pages: number, weighted: boolean) => walkOf(C, seed, pages, weighted);

function firstDiff(a: string[], b: string[]): string {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return `page ${i}: "${a[i]}" vs "${b[i]}"`;
  return a.length === b.length ? '' : `length ${a.length} vs ${b.length}`;
}

// ---------------------------------------------------------------- 0. premise
console.log('\n=============== ART-PRESENCE CHECK ===============\n');
console.log(`pool ${CARD_SLUGS.length} cards | ${NON_EMPTY.length} with a slug | IMAGE_MAP ${MAPPED.size} slugs`);
const unmapped = NON_EMPTY.filter((s) => !FULL.has(s) && !FULL.has(s.replace(/-g\d+$/, '').toLowerCase()));
console.log('\n[0] PREMISE — with the full map installed, hasArt(slug) === (slug !== "")');
presence.installBundledArt(FULL);
check(unmapped.length === 0, 'every non-empty card slug resolves in IMAGE_MAP', `${unmapped.length} unmapped`);
check(
  CARD_SLUGS.every((s) => presence.hasArt(s) === (s !== '')),
  'full manifest ⇒ presence is exactly slug-non-emptiness'
);
presence.resetArtPresence();
check(
  CARD_SLUGS.every((s) => presence.hasArt(s) === (s !== '')),
  'no manifest ⇒ same answer (pre-presence behaviour preserved)'
);

// ---------------------------------------------------------------- 1. identity
//
// Against the OLD code, not against itself. Comparing the new feed with no manifest to the
// new feed with a full manifest is a tautology given [0] — both states answer `hasArt` the
// same way, so it cannot see the one thing it is named for (the `servable` rewrite that
// dropped the `f.slug &&` truthiness guard). OLD is today's cards.ts with the three presence
// sites reverse-patched (load-cards-node PRE_PRESENCE_PATCH), so a future edit to `servable`
// or `cooldownSlugs` that changes behaviour shows up here as a diverging trace.
console.log('\n[1] IDENTITY — full bundle behaves exactly like the PRE-PRESENCE build');
for (const weighted of [false, true]) {
  const label = weighted ? 'weighted (FeedContext)' : 'uniform (no context)';
  presence.installBundledArt(FULL);
  const before = walkOf(OLD, 20260830, 600, weighted);
  const after = walkOf(C, 20260830, 600, weighted);
  check(
    before.trace.join('\n') === after.trace.join('\n'),
    `${label}: 600-page walk identical to the old feed (cards, choices, labels)`,
    firstDiff(before.trace, after.trace)
  );
  // …and with no manifest at all, which is how every headless harness runs.
  presence.resetArtPresence();
  const oldBlind = walkOf(OLD, 20260830, 600, weighted);
  const newBlind = walkOf(C, 20260830, 600, weighted);
  check(
    oldBlind.trace.join('\n') === newBlind.trace.join('\n'),
    `${label}: same, with no manifest installed`,
    firstDiff(oldBlind.trace, newBlind.trace)
  );
  // The comparison is only worth anything if the two modules CAN differ. Prove they do.
  presence.installBundledArt(PARTIAL);
  const oldPartial = walkOf(OLD, 4242, 400, weighted);
  const newPartial = walkOf(C, 4242, 400, weighted);
  check(
    oldPartial.trace.join('\n') !== newPartial.trace.join('\n'),
    `${label}: the two builds DO diverge on a partial pack (the check is not vacuous)`,
    firstDiff(oldPartial.trace, newPartial.trace)
  );
}

// ---------------------------------------------------------------- 2/3. partial pack
console.log(`\n[2] NO SHRINK / [3] COOLDOWN — ${pct(PARTIAL.size, MAPPED.size)} of the art on device`);
presence.installBundledArt(PARTIAL);
const absentInPool = CARD_SLUGS.filter((s) => !presence.hasArt(s)).length;
const partial = walk(4242, 1200, true);
check(partial.deadEnds === 0, 'no dead ends: every page offered a next card', `${partial.deadEnds}`);
check(partial.pages === 1200, 'the walk ran to length', `${partial.pages} pages`);
check(
  Math.abs(partial.posterPages / partial.pages - absentInPool / CARD_SLUGS.length) < 0.06,
  'text-only cards served at ~their pool rate (feed did not narrow to illustrated cards)',
  `served ${pct(partial.posterPages, partial.pages)} vs pool ${pct(absentInPool, CARD_SLUGS.length)}`
);
check(
  partial.visibleRepeat === 0,
  'a picture the reader can SEE never repeats inside the cooldown window',
  `${partial.visibleRepeat}`
);
check(
  partial.invisibleRepeat > 0,
  'a picture that is NOT on the device no longer burns a cooldown slot',
  `${partial.invisibleRepeat} such page-turns freed`
);
// the same partial device, but with the feed blind to presence (the pre-fix behaviour)
presence.resetArtPresence();
const blind = walk(4242, 1200, true);
console.log(
  `      variety on the same device: presence-aware ${partial.distinct} distinct cards / ` +
    `${partial.visibleRepeat} visible repeats  vs  presence-blind ${blind.distinct} / ${blind.visibleRepeat}`
);

// ---------------------------------------------------------------- 4. mid-session
console.log('\n[4] LIVE — an image landing while the app is open');
presence.installBundledArt(PARTIAL);
const missing = cardsIndex.cards.find((c) => c.slug && !presence.hasArt(c.slug))!;
let notified = 0;
const stop = presence.subscribeArtPresence(() => {
  notified += 1;
});
const v0 = presence.artPresenceVersion();
check(!presence.hasArt(missing.slug), `${missing.slug} is absent before the shard lands`);
check(C.cardHasArt(C.getCard(missing.id)) === false, 'the feed agrees it has no art');
presence.markArtDownloaded(missing.slug, `file:///art/${missing.slug}.png`);
check(presence.hasArt(missing.slug), 'present immediately after markArtDownloaded');
check(C.cardHasArt(C.getCard(missing.id)) === true, 'the feed sees it without reloading anything');
check(presence.artPresenceVersion() > v0, 'the snapshot version advanced (React subscribers re-render)');
check(notified === 1, 'subscribers notified exactly once', `${notified}`);
presence.markArtDownloaded(missing.slug, `file:///art/${missing.slug}.png`);
check(notified === 1, 'a redundant write notifies nobody', `${notified}`);
presence.markArtDownloadedMany([
  ['a-slug-x', 'file:///a.png'],
  ['a-slug-y', 'file:///b.png'],
]);
check(notified === 2, 'a whole shard notifies once, not once per file', `${notified}`);
presence.forgetArtDownloaded(missing.slug);
check(!presence.hasArt(missing.slug), 'an evicted file goes absent again');
stop();
presence.markArtDownloaded('post-unsubscribe', 'file:///c.png');
check(notified === 3, 'unsubscribe stops delivery', `${notified}`);

// ---------------------------------------------------------------- 5. rehydrate
//
// The registry is memory; the installed-shard set has to be persisted or every launch
// re-downloads the whole tail. That asymmetry is the trap this check exists for: a pack that
// is recorded as installed but whose slugs were never replayed reads as ABSENT, the queue
// skips it because it IS installed, and the bytes the child paid for are unreachable for
// good. install → lose the registry → replay must restore the identical presence set.
console.log('\n[5] REHYDRATE — a relaunch must not lose art that is already on disk');
presence.installBundledArt(PARTIAL);
// DISTINCT slugs: many cards share one illustration, and a shard ships each file once.
const landed: [string, string][] = [
  ...new Set(cardsIndex.cards.filter((c) => c.slug && !presence.hasArt(c.slug)).map((c) => c.slug)),
]
  .slice(0, 400)
  .map((s) => [s, `file:///art/${s}.webp`] as [string, string]);
presence.markArtDownloadedMany(landed);
const afterInstall = CARD_SLUGS.map((s) => presence.hasArt(s));
check(
  landed.length > 0 && landed.every(([s]) => presence.hasArt(s)),
  'a landed shard is present while the app stays open',
  `${landed.length} slugs`
);
// the relaunch: fresh process ⇒ empty registry, bundled manifest re-installed from imageMap
presence.resetArtPresence();
presence.installBundledArt(PARTIAL);
check(
  landed.every(([s]) => !presence.hasArt(s)),
  'without a replay the landed slugs are invisible again (this is the bug being guarded)'
);
check(
  presence.downloadedArtCount() === 0,
  'the backfilled table really is empty after a relaunch',
  `${presence.downloadedArtCount()}`
);
// …and the replay restores it exactly
presence.hydrateDownloadedArt(landed);
check(
  CARD_SLUGS.every((s, i) => presence.hasArt(s) === afterInstall[i]),
  'hydrateDownloadedArt restores the identical presence set over the whole pool'
);
check(
  presence.downloadedArtEntries().length === landed.length,
  'the table the installer can persist round-trips',
  `${presence.downloadedArtEntries().length} of ${landed.length}`
);
let rehydrateNotices = 0;
const stopRehydrate = presence.subscribeArtPresence(() => {
  rehydrateNotices += 1;
});
presence.hydrateDownloadedArt(landed);
check(rehydrateNotices === 0, 'replaying the same snapshot notifies nobody', `${rehydrateNotices}`);
presence.hydrateDownloadedArt(landed.slice(0, 100));
check(rehydrateNotices === 1, 'a snapshot that shrank notifies once', `${rehydrateNotices}`);
check(
  landed.slice(100).every(([s]) => !presence.hasArt(s)),
  'hydrate REPLACES: files no longer on disk drop out instead of lingering as phantoms'
);
stopRehydrate();

// ---------------------------------------------------------------- 6. perf
console.log('\n[6] PERF — the presence test sits on the page-turn path');
function bench(label: string, weighted: boolean) {
  const orig = Math.random;
  (Math as { random: () => number }).random = mulberry32(12345);
  const ctx = weighted ? CTX : undefined;
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) C.startCard(seen, ctx);
  const startT: number[] = [];
  for (let i = 0; i < 700; i += 1) {
    const t = performance.now();
    const c = C.startCard(seen, ctx);
    startT.push(performance.now() - t);
    if (i % 5 === 0) seen.add(c.id);
  }
  const nextT: number[] = [];
  const recent: string[] = [];
  let cur = C.startCard(seen, ctx);
  let depth = 0;
  for (let n = 0; n < 350; n += 1) {
    const t = performance.now();
    const ch = C.nextChoices(cur.id, seen, 'tagalog', {
      threadDepth: depth + 1,
      recentIds: [...recent],
      ctx,
    }) as { factId: string }[];
    nextT.push(performance.now() - t);
    depth = ch.length > 1 ? 0 : depth + 1;
    const pick = ch[0];
    if (!pick) {
      cur = C.startCard(seen, ctx);
      recent.length = 0;
      continue;
    }
    cur = C.getCard(pick.factId)!;
    seen.add(cur.id);
    recent.push(cur.id);
    if (recent.length > 5) recent.shift();
  }
  (Math as { random: () => number }).random = orig;
  console.log(`  ${label}\n    startCard    ${fmt(stats(startT))}\n    nextChoices  ${fmt(stats(nextT))}`);
}
for (const [name, install] of [
  ['no manifest (pre-presence path)', () => presence.resetArtPresence()],
  ['full manifest (today’s APK)', () => presence.installBundledArt(FULL)],
  [`partial manifest (${pct(PARTIAL.size, MAPPED.size)} on device)`, () => presence.installBundledArt(PARTIAL)],
] as [string, () => void][]) {
  install();
  bench(`--- ${name} · uniform ---`, false);
  bench(`--- ${name} · weighted ---`, true);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
