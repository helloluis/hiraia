/**
 * Art-pack packer — cuts the 140 MB bundled head of the illustration corpus and emits the
 * tail as shard manifests for the future backfill downloader.
 *
 * The APK cannot carry all 30,062 mapped illustrations (440 MiB / 461.8 MB), so the bundle
 * ships the HEAD of ONE ordered list and the rest arrives later, shard by shard. This script
 * computes that order, deterministically, and writes:
 *
 *   src/generated/artPack.keep.json        — the keep-list gen-image-map.mjs consumes: only
 *                                            these slugs are require()d into IMAGE_MAP, so
 *                                            Metro bundles exactly the pack and
 *                                            installBundledArt's manifest follows for free.
 *   ../../rag/pipeline/art-shards/         — index.json + one manifest per tail shard for
 *                                            the backfill downloader (NOT built here).
 *
 * Selection = greedy DRAW-WEIGHTED CARDS-PER-BYTE with a COMPETENCY FLOOR:
 *
 *   - The value of an image is the summed draw weight of every feed card that resolves to it
 *     (a card resolves exactly one slug, via resolveImage()'s exact-then-strip-grade-suffix
 *     rule). A card's draw weight is curriculumMultiplier() summed over all 32 grade×quarter
 *     cells (grades 3–10 × Q1–4, packages/shared feedWeighting, default weights, no seen
 *     decay) — i.e. how often the card is drawn across every student the app can serve.
 *   - PHASE 1 (floored lazy-greedy): a card only earns its image credit while its competency
 *     (primary MATATAG code; 'off' for untagged/low-confidence) still sits below
 *     ceil(FLOOR_T × n_competency), where n_competency counts the competency's cards with
 *     resolvable art. Plain value-per-byte greedy leaves ~31 competencies under 60%
 *     illustrated while the average looks fine; the floor spreads the head across the
 *     curriculum before any competency gets over-served. Lazy-greedy because selecting an
 *     image fills floors and stales every other image's credit: re-evaluate the top of the
 *     heap until it stays on top.
 *   - PHASE 2 (plain value-per-byte): once no image holds floor credit, the remaining budget
 *     and the whole tail are ordered by total value per byte. Card-unreachable clip-art
 *     (chat substrate, value 0) is NEVER selected — not even as budget filler when the
 *     residual hole is smaller than every positive-value image — because the decision is
 *     that it rides the download tier; it sorts last and goes straight to the tail.
 *   - FORCE-KEEP: slugs hard-referenced by code ship regardless of value — a missing one is
 *     a blank component (DEMO_IMAGE_SLUG renders in onboarding before any backfill exists).
 *
 * The tail is grouped into grade×quarter shards by OWNER CELL — the strongest MATATAG cell
 * of the image's highest-value card (untagged / card-unreachable → 'common') — and split
 * into ≤ SHARD_CAP chunks in global-order, so the first shard of every cell is that cell's
 * most valuable megabytes. Frozen full-corpus stats ride in index.json so the downloader
 * can show real coverage numbers without recomputing any of this.
 *
 * Deterministic: no RNG, stable tie-breaks (slug asc), byte sizes from the real files.
 *
 *   node_modules/.bin/tsx scripts/build-art-pack.mts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import {
  DEFAULT_CURRICULUM_WEIGHTS,
  curriculumMultiplier,
  type CurriculumTag,
} from '../../shared/src/curriculum/feedWeighting.ts';

const MOBILE = new URL('..', import.meta.url).pathname;
const IMAGES = join(MOBILE, '../images');
const POOL = join(MOBILE, '../../rag/pipeline/cardsPool.app.json');
const CARDS_INDEX = join(MOBILE, 'src/generated/cardsIndex.generated.json');
const TAGS_JSON = join(MOBILE, 'src/generated/curriculumTags.generated.json');
const OUT_KEEP = join(MOBILE, 'src/generated/artPack.keep.json');
const OUT_SHARDS = join(MOBILE, '../../rag/pipeline/art-shards');

/** 140 MB (decimal, the unit every budget discussion used: the full corpus is "461.8 MB"). */
const BUDGET_BYTES = 140_000_000;
/** Competency floor: a card earns floor credit while its competency is below ceil(T × n). */
const FLOOR_T = 0.65;
/** Tail shard size cap (~6–8 MB target). */
const SHARD_CAP = 8_000_000;
/** Slugs hard-referenced by code (grep require/useArtSource/resolveImage literals):
 *  DEMO_IMAGE_SLUG (src/config/onboarding.ts) — the onboarding demo card's art. */
const FORCE_KEEP = ['plant-parts'];

const GRADES = [3, 4, 5, 6, 7, 8, 9, 10] as const;
const QUARTERS = [1, 2, 3, 4] as const;
const MB = (b: number) => (b / 1e6).toFixed(1);

// ---------------------------------------------------------------- corpus (same rules as gen-image-map.mjs)
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}
const CARD_ID = /^(?:ffct|dcard)-\d+$/;
const poolIds = new Set(
  (JSON.parse(readFileSync(POOL, 'utf8')) as { cards: { id: string }[] }).cards.map((c) => c.id)
);
const clipFiles = walk(join(IMAGES, 'assets-png')).sort();
const cardFiles = walk(join(IMAGES, 'cards-png'))
  .sort()
  .filter((f) => {
    const s = basename(f, '.png');
    return !CARD_ID.test(s) || poolIds.has(s); // orphaned card art (dedup leftovers) never maps
  });

interface Img {
  slug: string;
  file: string; // relative to packages/images
  bytes: number;
  kind: 'clip' | 'card';
  cardIds: string[];
  value: number; // Σ card draw-weight over all 32 cells
  perGrade: Float64Array; // Σ card draw-weight per grade (4 quarters summed)
}
const images = new Map<string, Img>();
for (const [kind, files] of [
  ['clip', clipFiles],
  ['card', cardFiles],
] as const) {
  for (const f of files) {
    const slug = basename(f, '.png');
    if (images.has(slug)) continue; // assets-png wins collisions, same as gen-image-map
    images.set(slug, {
      slug,
      file: relative(IMAGES, f),
      bytes: statSync(f).size,
      kind,
      cardIds: [],
      value: 0,
      perGrade: new Float64Array(GRADES.length),
    });
  }
}

// ---------------------------------------------------------------- cards, tags, weights
type TagRow = [string, number, number, number, [number, number, number, number][]?, string[]?];
const tagsJson = JSON.parse(readFileSync(TAGS_JSON, 'utf8')) as Record<string, TagRow>;
function decodeTag(id: string): CurriculumTag | null {
  const r = tagsJson[id];
  if (!r) return null;
  const [competency, grade, quarter, confidence, cells, codes] = r;
  return {
    competency,
    grade,
    quarter,
    confidence,
    cells: cells?.map(([g, q, s, n]) => ({ grade: g, quarter: q, strength: s === 2 ? 2 : 1, norm: n })),
    codes,
  };
}

const cardsIndex = JSON.parse(readFileSync(CARDS_INDEX, 'utf8')) as {
  cards: { id: string; slug: string }[];
};
interface Card {
  id: string;
  img: string | null; // resolved image slug (resolveImage semantics)
  comp: string; // primary competency, 'off' when untagged / below minConfidence
  weight: number; // Σ over 32 cells
  perGrade: Float64Array;
  ownerCell: string; // strongest MATATAG cell, 'common' when off-curriculum
}
const cards: Card[] = [];
for (const c of cardsIndex.cards) {
  let img: string | null = null;
  if (c.slug) {
    if (images.has(c.slug)) img = c.slug;
    else {
      const base = c.slug.replace(/-g\d+$/, '').toLowerCase();
      if (images.has(base)) img = base;
    }
  }
  const tag = decodeTag(c.id);
  const onCurr = !!tag && tag.confidence >= DEFAULT_CURRICULUM_WEIGHTS.minConfidence;
  const perGrade = new Float64Array(GRADES.length);
  let weight = 0;
  GRADES.forEach((g, gi) => {
    for (const q of QUARTERS) {
      const w = curriculumMultiplier(tag, g, q);
      perGrade[gi] += w;
      weight += w;
    }
  });
  let ownerCell = 'common';
  if (onCurr) {
    // strongest cell: max (strength, norm), stable on the authored cell order
    const cells = tag!.cells?.length ? tag!.cells : [{ grade: tag!.grade, quarter: tag!.quarter, strength: 2 as const, norm: 1 }];
    let best = cells[0]!;
    for (const cell of cells) {
      const s = (cell.strength ?? 2) * 10 + (cell.norm ?? 1);
      const bs = (best.strength ?? 2) * 10 + (best.norm ?? 1);
      if (s > bs) best = cell;
    }
    ownerCell = `g${best.grade}-q${best.quarter}`;
  }
  cards.push({ id: c.id, img, comp: onCurr ? tag!.competency : 'off', weight, perGrade, ownerCell });
}

for (const c of cards) {
  if (!c.img) continue;
  const img = images.get(c.img)!;
  img.cardIds.push(c.id);
  img.value += c.weight;
  GRADES.forEach((_, gi) => (img.perGrade[gi] += c.perGrade[gi]!));
}
const cardById = new Map(cards.map((c) => [c.id, c]));

// ---------------------------------------------------------------- competency floors
const compAll = new Map<string, number>(); // illustratable cards per competency
for (const c of cards) if (c.img) compAll.set(c.comp, (compAll.get(c.comp) ?? 0) + 1);
const target = new Map<string, number>();
for (const [comp, n] of compAll) target.set(comp, Math.ceil(FLOOR_T * n));
const covered = new Map<string, number>(); // illustrated-so-far per competency

/** Floor credit of an image right now: weight of its cards whose competency is still short. */
function floorValue(img: Img): number {
  let v = 0;
  for (const id of img.cardIds) {
    const c = cardById.get(id)!;
    if ((covered.get(c.comp) ?? 0) < (target.get(c.comp) ?? 0)) v += c.weight;
  }
  return v;
}

// ---------------------------------------------------------------- selection
/**
 * Reserved for the PHASE 1.5 minimum-one seeds. The greedy fills to within a few hundred
 * bytes of the line, so post-hoc seeds can never fit unless the line is drawn short for
 * them (measured: two ~15 KB seeds against a 139,999,431/140,000,000 fill = both WARN).
 * 64 KiB covers the observed need several times over; whatever the seeds leave unused is
 * intentionally forfeited (~0.02% of budget) rather than triggering another value pass.
 */
const SEED_RESERVE = 65536;
const GREEDY_BUDGET = BUDGET_BYTES - SEED_RESERVE;

const selected: Img[] = [];
const selectedSet = new Set<string>();
let packBytes = 0;
function take(img: Img, phase: string) {
  selected.push(img);
  selectedSet.add(img.slug);
  packBytes += img.bytes;
  for (const id of img.cardIds) {
    const comp = cardById.get(id)!.comp;
    covered.set(comp, (covered.get(comp) ?? 0) + 1);
  }
  phases.set(img.slug, phase);
}
const phases = new Map<string, string>();

// force-keep first — these are load-bearing for code, not for the value function
for (const slug of FORCE_KEEP) {
  const img = images.get(slug);
  if (!img) throw new Error(`force-keep slug has no file: ${slug}`);
  take(img, 'force');
}

// PHASE 1 — floored lazy-greedy (binary heap keyed by stale credit-per-byte)
type Entry = { slug: string; key: number };
const heap: Entry[] = [];
const less = (a: Entry, b: Entry) => a.key > b.key || (a.key === b.key && a.slug < b.slug);
function push(e: Entry) {
  heap.push(e);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (less(heap[i]!, heap[p]!)) [heap[i], heap[p]] = [heap[p]!, heap[i]!];
    else break;
    i = p;
  }
}
function pop(): Entry | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
      if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m]!, heap[i]!];
      i = m;
    }
  }
  return top;
}
for (const img of images.values()) {
  if (selectedSet.has(img.slug)) continue;
  const v = floorValue(img);
  if (v > 0) push({ slug: img.slug, key: v / img.bytes });
}
while (packBytes < BUDGET_BYTES) {
  const top = pop();
  if (!top) break;
  if (selectedSet.has(top.slug)) continue;
  const img = images.get(top.slug)!;
  const fresh = floorValue(img) / img.bytes;
  if (fresh <= 0) continue; // its floors filled since it was queued
  if (heap.length && fresh < heap[0]!.key) {
    push({ slug: top.slug, key: fresh }); // stale — re-rank and try again
    continue;
  }
  if (packBytes + img.bytes > GREEDY_BUDGET) continue; // does not fit; smaller ones may
  take(img, 'floor');
}

// PHASE 1.5 — MINIMUM-ONE SEED: no MATATAG competency with illustratable art lands at
// LITERAL ZERO images. The pure value function left two single-card competencies (G3-L-1,
// G10-L-9) at 0% — their lone images never win per-byte — and the floor's whole point is
// that no competency is invisibly starved. For each MATATAG code (G\d+- prefix; deped:
// modules and 'off' are the backfill tier's job) with ≥1 illustratable card and 0 selected
// images, keep its SMALLEST resolvable image. Cost measured at ~30 KB against a
// 140,000,000-byte budget; if it ever cannot fit, the shortfall is reported, not silent.
{
  const compHasImg = new Set<string>();
  for (const img of selected) for (const id of img.cardIds) compHasImg.add(cardById.get(id)!.comp);
  const missing = [...compAll.keys()].filter((c) => /^G\d+-/.test(c) && !compHasImg.has(c)).sort();
  for (const comp of missing) {
    const candidates = [...images.values()]
      .filter((i) => !selectedSet.has(i.slug) && i.cardIds.some((id) => cardById.get(id)!.comp === comp))
      .sort((a, b) => a.bytes - b.bytes || (a.slug < b.slug ? -1 : 1));
    const pick = candidates.find((i) => packBytes + i.bytes <= BUDGET_BYTES);
    if (pick) take(pick, 'seed');
    else console.log(`WARN: min-one seed for ${comp} does not fit the budget`);
  }
  if (missing.length) console.log(`seeded ${missing.length} zero-image MATATAG competencies`);
}

// PHASE 2 — plain value-per-byte for the remaining budget, and the whole tail order
const rest = [...images.values()]
  .filter((i) => !selectedSet.has(i.slug))
  .sort((a, b) => b.value / b.bytes - a.value / a.bytes || (a.slug < b.slug ? -1 : 1));
const tail: Img[] = [];
for (const img of rest) {
  // Zero-value images (card-unreachable chat clip-art, or cards nothing ever draws) are not
  // budget filler: they ship by download-tier decision, however small the residual hole.
  if (img.value <= 0 || packBytes + img.bytes > GREEDY_BUDGET) tail.push(img);
  else take(img, 'value');
}

// ---------------------------------------------------------------- stats
function md5(file: string): string {
  return createHash('md5').update(readFileSync(join(IMAGES, file))).digest('hex');
}
function coverageStats(pack: ReadonlySet<string>) {
  const perGradeIll = new Float64Array(GRADES.length);
  const perGradeTot = new Float64Array(GRADES.length);
  const compIll = new Map<string, number>();
  for (const c of cards) {
    GRADES.forEach((_, gi) => (perGradeTot[gi] += c.perGrade[gi]!));
    if (c.img && pack.has(c.img)) {
      GRADES.forEach((_, gi) => (perGradeIll[gi] += c.perGrade[gi]!));
      compIll.set(c.comp, (compIll.get(c.comp) ?? 0) + 1);
    }
  }
  const perGrade: Record<string, number> = {};
  GRADES.forEach((g, gi) => (perGrade[`g${g}`] = +(100 * perGradeIll[gi]! / perGradeTot[gi]!).toFixed(1)));
  /** Floor read-out for one code namespace: the MATATAG codes are the finding that motivated
   *  the floor; the 1,015 tiny deped: module codes (median 4 cards) are floored by the same
   *  mechanism but would drown the MATATAG numbers if lumped in. */
  function floorReport(match: (comp: string) => boolean) {
    let minPct = 100;
    let minComp = '';
    let below60 = 0;
    let met = 0;
    let nComps = 0;
    for (const [comp, n] of compAll) {
      if (!match(comp)) continue;
      nComps += 1;
      const pct = (100 * (compIll.get(comp) ?? 0)) / n;
      if (pct < minPct) {
        minPct = pct;
        minComp = comp;
      }
      if (pct < 60) below60 += 1;
      if ((compIll.get(comp) ?? 0) >= (target.get(comp) ?? 0)) met += 1;
    }
    return { nComps, minPct: +minPct.toFixed(1), minComp, below60, met };
  }
  const matatag = floorReport((c) => /^G\d+-/.test(c));
  const deped = floorReport((c) => c.startsWith('deped:'));
  const offPct = +((100 * (compIll.get('off') ?? 0)) / (compAll.get('off') ?? 1)).toFixed(1);
  return { perGrade, matatag, deped, offPct };
}
const packStats = coverageStats(selectedSet);
const fullStats = coverageStats(new Set(images.keys()));

// ---------------------------------------------------------------- keep-list
const clipSel = selected.filter((i) => i.kind === 'clip');
const cardSel = selected.filter((i) => i.kind === 'card');
const sum = (xs: Img[]) => xs.reduce((a, i) => a + i.bytes, 0);
writeFileSync(
  OUT_KEEP,
  JSON.stringify(
    {
      generatedBy: 'scripts/build-art-pack.mts',
      budgetBytes: BUDGET_BYTES,
      bytes: packBytes,
      images: selected.length,
      clipArt: { images: clipSel.length, bytes: sum(clipSel) },
      cardArt: { images: cardSel.length, bytes: sum(cardSel) },
      forceKeep: FORCE_KEEP,
      floorT: FLOOR_T,
      perGradeWeightedIllustratedPct: packStats.perGrade,
      // selection order IS the head of the one ordered list (force → floor → value)
      keep: selected.map((i) => i.slug),
    },
    null,
    1
  ) + '\n'
);

// ---------------------------------------------------------------- tail shards
rmSync(OUT_SHARDS, { recursive: true, force: true });
mkdirSync(OUT_SHARDS, { recursive: true });
/** Owner cell of a tail image: the strongest cell of its highest-weight card; 'common' when
 *  card-unreachable or every card is off-curriculum. */
function ownerCellOf(img: Img): string {
  let best: Card | null = null;
  for (const id of img.cardIds) {
    const c = cardById.get(id)!;
    if (!best || c.weight > best.weight || (c.weight === best.weight && c.id < best.id)) best = c;
  }
  return best ? best.ownerCell : 'common';
}
const byCell = new Map<string, Img[]>();
for (const img of tail) {
  const cell = ownerCellOf(img);
  (byCell.get(cell) ?? byCell.set(cell, []).get(cell)!).push(img);
}
interface ShardMeta {
  id: string;
  cell: string;
  file: string;
  images: number;
  bytes: number;
  md5: string;
}
const shardMetas: ShardMeta[] = [];
const cellOrder = [...byCell.keys()].sort();
for (const cell of cellOrder) {
  const imgs = byCell.get(cell)!; // already in global (tail) order = most valuable first
  let part: Img[] = [];
  let partBytes = 0;
  let n = 0;
  const flush = () => {
    if (!part.length) return;
    n += 1;
    const id = `${cell}-${String(n).padStart(2, '0')}`;
    const entries = part.map((i) => ({ slug: i.slug, file: i.file, bytes: i.bytes, md5: md5(i.file) }));
    // shard md5 = md5 of the member md5s in order: a stable content hash for the whole shard
    const shardMd5 = createHash('md5').update(entries.map((e) => e.md5).join('')).digest('hex');
    writeFileSync(
      join(OUT_SHARDS, `${id}.json`),
      JSON.stringify({ id, cell, bytes: partBytes, md5: shardMd5, images: entries }, null, 1) + '\n'
    );
    shardMetas.push({ id, cell, file: `${id}.json`, images: part.length, bytes: partBytes, md5: shardMd5 });
    part = [];
    partBytes = 0;
  };
  for (const img of imgs) {
    if (partBytes + img.bytes > SHARD_CAP) flush();
    part.push(img);
    partBytes += img.bytes;
  }
  flush();
}
const tailBytes = sum(tail);
writeFileSync(
  join(OUT_SHARDS, 'index.json'),
  JSON.stringify(
    {
      generatedBy: 'packages/mobile/scripts/build-art-pack.mts',
      note: 'Tail of the bundled-art order, grouped by owner grade×quarter cell for the backfill downloader. Image files live under packages/images/.',
      pack: {
        budgetBytes: BUDGET_BYTES,
        bytes: packBytes,
        images: selected.length,
        keepList: 'packages/mobile/src/generated/artPack.keep.json',
      },
      corpus: {
        images: images.size,
        bytes: sum([...images.values()]),
        cards: cards.length,
        cardsWithArt: cards.filter((c) => c.img).length,
        cardUnreachableImages: [...images.values()].filter((i) => i.cardIds.length === 0).length,
        perGradeWeightedIllustratedPct: { pack: packStats.perGrade, full: fullStats.perGrade },
        packFloor: { matatag: packStats.matatag, deped: packStats.deped, offCurriculumPct: packStats.offPct },
        floorT: FLOOR_T,
      },
      tail: { images: tail.length, bytes: tailBytes, shards: shardMetas.length },
      shards: shardMetas,
    },
    null,
    1
  ) + '\n'
);

// ---------------------------------------------------------------- report
console.log(`corpus: ${images.size} images ${MB(sum([...images.values()]))} MB | ${cards.length} cards, ${cards.filter((c) => c.img).length} with resolvable art`);
console.log(`pack:   ${selected.length} images ${MB(packBytes)} MB of ${MB(BUDGET_BYTES)} MB budget`);
console.log(`        clip-art ${clipSel.length} (${MB(sum(clipSel))} MB) + card art ${cardSel.length} (${MB(sum(cardSel))} MB)`);
console.log(`        phases: force ${FORCE_KEEP.length}, floor ${[...phases.values()].filter((p) => p === 'floor').length}, value ${[...phases.values()].filter((p) => p === 'value').length}`);
console.log(`        per-grade draw-weighted illustrated %: ${JSON.stringify(packStats.perGrade)}`);
console.log(`        (full corpus would be: ${JSON.stringify(fullStats.perGrade)})`);
const fl = (l: string, r: { nComps: number; minPct: number; minComp: string; below60: number; met: number }) =>
  console.log(`        ${l}: min ${r.minPct}% (${r.minComp}), ${r.below60} of ${r.nComps} below 60%, ${r.met} met the ${FLOOR_T} target`);
fl('competency floor (MATATAG)', packStats.matatag);
fl('competency floor (deped: modules)', packStats.deped);
console.log(`        off-curriculum bucket: ${packStats.offPct}% illustrated`);
console.log(`tail:   ${tail.length} images ${MB(tailBytes)} MB in ${shardMetas.length} shards -> ${relative(process.cwd(), OUT_SHARDS)}`);
const sb = shardMetas.map((s) => s.bytes).sort((a, b) => a - b);
console.log(`        shard sizes MB: min ${MB(sb[0] ?? 0)} / median ${MB(sb[sb.length >> 1] ?? 0)} / max ${MB(sb[sb.length - 1] ?? 0)}`);
console.log(`force-kept: ${FORCE_KEEP.join(', ')} (${MB(sum(FORCE_KEEP.map((s) => images.get(s)!)))} MB)`);
console.log(`APK delta: bundle drops ${MB(sum([...images.values()]) - packBytes)} MB of art (before APK compression)`);
