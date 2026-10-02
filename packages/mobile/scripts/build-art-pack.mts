/**
 * Builds the approved bundled illustration set and the complete downloadable tail.
 * The selection is reviewed data in config/bundled-art.selection.json, never silently
 * re-ranked during a content build. Download pack membership is preserved separately by
 * package-art.py so an APK upgrade does not make students buy the same pictures again.
 *
 * Run: node --import tsx scripts/build-art-pack.mts
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

const selection = JSON.parse(readFileSync(join(MOBILE, 'src/config/bundled-art.selection.json'), 'utf8')) as {
  format: number; budgetBytes: number; approvedImages: number;
  selectionMethod: string; forceKeep: string[]; keep: string[];
};
if (selection.format !== 1 || !Number.isSafeInteger(selection.budgetBytes) || selection.budgetBytes <= 0 ||
    !Array.isArray(selection.keep) || new Set(selection.keep).size !== selection.approvedImages ||
    selection.keep.length !== selection.approvedImages) throw new Error('Invalid approved illustration selection');
const BUDGET_BYTES = selection.budgetBytes;
/** Competency floor: a card earns floor credit while its competency is below ceil(T × n). */
const FLOOR_T = 0.65;
/** Tail shard size cap (~6–8 MB target). */
const SHARD_CAP = 8_000_000;
/** Slugs hard-referenced by code (grep require/useArtSource/resolveImage literals):
 *  DEMO_IMAGE_SLUG (src/config/onboarding.ts) — the onboarding demo card's art. */
const FORCE_KEEP = selection.forceKeep;

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

// The exact, user-approved set. Fail before writing anything if an image is missing
// or a regeneration has pushed it past the budget. Never drop an image silently.
const selected = selection.keep.map((slug) => {
  const image = images.get(slug);
  if (!image) throw new Error(`Approved bundled image is missing: ${slug}`);
  return image;
});
const selectedSet = new Set(selection.keep);
for (const slug of FORCE_KEEP) {
  if (!selectedSet.has(slug)) throw new Error(`Required bundled image omitted: ${slug}`);
}
const packBytes = selected.reduce((n, image) => n + image.bytes, 0);
if (packBytes > BUDGET_BYTES) throw new Error(`Approved illustrations exceed budget: ${packBytes} > ${BUDGET_BYTES}`);
const tail = [...images.values()].filter((image) => !selectedSet.has(image.slug))
  .sort((a, b) => b.value / b.bytes - a.value / a.bytes || a.slug.localeCompare(b.slug));

// Retain the original 65% target as an explicit comparison in the coverage report;
// the 40 MB selection promises a minimum, not that old, much larger bundle's floor.
const compAll = new Map<string, number>();
for (const c of cards) if (c.img) compAll.set(c.comp, (compAll.get(c.comp) ?? 0) + 1);
const target = new Map([...compAll].map(([comp, n]) => [comp, Math.ceil(FLOOR_T * n)]));

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
      comparisonFloorT: FLOOR_T,
      selectionMethod: selection.selectionMethod,
      perGradeWeightedIllustratedPct: packStats.perGrade,
      // Stable, reviewed selection order.
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
        comparisonFloorT: FLOOR_T,
      selectionMethod: selection.selectionMethod,
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
console.log(`        selection: ${selection.selectionMethod}`);
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
