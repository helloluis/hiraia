#!/usr/bin/env node
// Generates: src/generated/imageMap.ts  (slug -> require(png), Metro bundles these)
//        and src/generated/factImage.ts (factId -> best image slug; pure strings,
//        importable anywhere). NOTE: factImage.ts currently has NO importer — its consumer
//        was the deleted chatStore. It is the curated half of the card-illustration
//        substrate (see LocalEngine.resolveImageTag), kept for when cards get pictures.
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const IMAGES = join(MOBILE, '../images/assets-png');
// Card illustrations (the factoid engravings and the DepEd-card art) live in their own flat
// directory named by slug. Kept separate from assets-png because they are a different library
// with a different provenance, and because "a file in here IS a wired illustration" is what
// lets the rest of the image batch land later without touching any code.
const CARD_IMAGES = join(MOBILE, '../images/cards-png');
const FACTS = join(MOBILE, '../../rag/bank/science-facts.jsonl');
// The wired pool decides which card art is REACHABLE. cards-png accumulates a file per card the
// art pipeline ever drew, including cards a later dedup dropped, and every require() below is
// bundled into the APK whether or not anything can reach it.
const POOL = join(MOBILE, '../../rag/pipeline/cardsPool.app.json');
const OUT_MAP = join(MOBILE, 'src/generated/imageMap.ts');
const OUT_FACT = join(MOBILE, 'src/generated/factImage.ts');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}

const files = walk(IMAGES).sort();
const allCardFiles = existsSync(CARD_IMAGES) ? walk(CARD_IMAGES).sort() : [];

/**
 * Card art named for a card that is not in the pool is unreachable: nothing renders it and
 * nothing can ever adopt it (wire-app-pool.py only lets a card adopt its OWN id as a slug). It
 * is pure APK weight — 1,343 dcard PNGs, 21 MB, left behind by the DepEd dedup in
 * merge-card-banks.py. Only CARD-ID files are filtered: a hand-named clip-art slug is a shared
 * library asset, reachable through FACT_IMAGE and the image vectors, and is always kept.
 *
 * This does not feed back into wire-app-pool.py's `bundled` set in any way that matters: the
 * ids dropped here have no card, so no card can lose its illustration to this.
 */
const CARD_ID = /^(?:ffct|dcard)-\d+$/;
const poolIds = existsSync(POOL)
  ? new Set(JSON.parse(readFileSync(POOL, 'utf8')).cards.map((c) => c.id))
  : null;
if (!poolIds) console.warn(`gen-image-map: ${POOL} missing — bundling ALL card art unpruned`);
const cardFiles = allCardFiles.filter((f) => {
  const s = basename(f, '.png');
  return !poolIds || !CARD_ID.test(s) || poolIds.has(s);
});
const orphaned = allCardFiles.length - cardFiles.length;

const slugPath = new Map(); // slug -> file
// assets-png first, so a hand-named clip-art slug always wins a collision with a card id.
for (const f of [...files, ...cardFiles]) {
  const s = basename(f, '.png');
  if (!slugPath.has(s)) slugPath.set(s, f);
}

/**
 * The 140 MB art pack (scripts/build-art-pack.mts): the APK bundles the HEAD of one ordered
 * list of illustrations and the tail rides the backfill downloader (rag/pipeline/art-shards/).
 * IMAGE_MAP — and therefore Metro's bundle AND the installBundledArt manifest, which is
 * IMAGE_MAP's key set — carries ONLY the kept slugs. Everything else (FACT_IMAGE below, the
 * image-vector catalog, cards.db slugs) still spans the FULL corpus: a slug that is not on
 * the device simply does not resolve, and artPresence answers "absent" for it.
 */
const KEEP = join(MOBILE, 'src/generated/artPack.keep.json');
let bundledSlugs = null; // null -> no pack cut yet, bundle everything (pre-packer behaviour)
if (existsSync(KEEP)) {
  const keep = JSON.parse(readFileSync(KEEP, 'utf8')).keep;
  const missing = keep.filter((s) => !slugPath.has(s));
  if (missing.length) {
    throw new Error(
      `gen-image-map: ${missing.length} keep-list slugs have no file (stale artPack.keep.json? ` +
        `re-run scripts/build-art-pack.mts): ${missing.slice(0, 5).join(', ')}`
    );
  }
  bundledSlugs = new Set(keep);
  // The guard above is one-directional (keep slug with no file). The other direction —
  // images ADDED to packages/images after the packer ran — would otherwise land in NEITHER
  // the bundled head NOR the frozen shard manifests: unbundled and undownloadable, silently,
  // while every harness stays green because presence tolerates absence by design. The packer
  // partitions the corpus, so head + tail must count exactly what is on disk.
  const SHARD_INDEX = join(MOBILE, '../../rag/pipeline/art-shards/index.json');
  if (!existsSync(SHARD_INDEX)) {
    throw new Error(
      `gen-image-map: ${KEEP} exists but ${SHARD_INDEX} does not — half a packer output. ` +
        're-run scripts/build-art-pack.mts'
    );
  }
  const tailImages = JSON.parse(readFileSync(SHARD_INDEX, 'utf8')).tail.images;
  if (slugPath.size !== keep.length + tailImages) {
    throw new Error(
      `gen-image-map: ${slugPath.size} mapped images on disk but the art pack covers ` +
        `${keep.length} bundled + ${tailImages} sharded = ${keep.length + tailImages} — ` +
        `images added or removed since the pack was cut are neither bundled nor ` +
        `downloadable. re-run scripts/build-art-pack.mts`
    );
  }
} else {
  console.warn(`gen-image-map: ${KEEP} missing — bundling ALL ${slugPath.size} images (no art pack cut)`);
}
const bundle = bundledSlugs ? new Map([...slugPath].filter(([s]) => bundledSlugs.has(s))) : slugPath;

// ---- imageMap.ts ----
const mapEntries = [...bundle].map(([slug, f]) =>
  `  ${JSON.stringify(slug)}: require(${JSON.stringify(relative(dirname(OUT_MAP), f))}),`);
mkdirSync(dirname(OUT_MAP), { recursive: true });
const bClip = [...bundle.values()].filter((f) => f.startsWith(IMAGES)).length;
writeFileSync(OUT_MAP, `// AUTO-GENERATED by scripts/gen-image-map.mjs — do not edit.
// ${mapEntries.length} bundled 512x512 science images (${bClip} clip-art + ${mapEntries.length - bClip} card art)${bundledSlugs ? ` — the 140 MB art-pack head of the ${slugPath.size}-image corpus (scripts/build-art-pack.mts)` : ''}.
// Metro packages each require().
/* eslint-disable */
import { installBundledArt } from '../data/artPresence';
export const IMAGE_MAP: Record<string, number> = {
${mapEntries.join('\n')}
};
export function resolveImage(slug: string): number | null {
  return IMAGE_MAP[slug] ?? IMAGE_MAP[slug.replace(/-g\\d+$/, '').toLowerCase()] ?? null;
}
export const IMAGE_SLUGS: ReadonlySet<string> = new Set(Object.keys(IMAGE_MAP));
// This map IS the bundled-art manifest — it is generated FROM the files Metro packages, so
// registering it here is the one wiring that cannot drift from the APK. Everything that can
// draw a bundled illustration imports this module, so the manifest is installed before any
// picture is resolved; the feed (src/data/cards.ts) deliberately does NOT import it and stays
// correct either way (see artPresence.hasArt).
installBundledArt(IMAGE_SLUGS);
`);

// ---- factImage.ts (fuzzy fact -> slug) ----
const STOP = new Set('the a an of and or in on to vs for with scene diagram illustration simple closeup close up filipino photo set type types view cross section labeled g2 g3 g4 g5 g6 g7 g8 g9 g10'.split(' '));
const toks = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
const slugToks = new Map([...slugPath.keys()].map((s) => [s, new Set(toks(s))]));
const byTok = new Map();
for (const [s, ts] of slugToks) for (const t of ts) (byTok.get(t) ?? byTok.set(t, []).get(t)).push(s);

const facts = readFileSync(FACTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const factImage = {};
let exact = 0, fuzzy = 0;
for (const f of facts) {
  const concept = f.id.replace(/-g\d+$/, '');
  if (slugPath.has(concept)) { factImage[f.id] = concept; exact++; continue; }
  const ct = new Set([...toks(concept), ...toks(f.topic || '')]);
  if (ct.size === 0) continue;
  const cands = new Set();
  for (const t of ct) for (const s of byTok.get(t) ?? []) cands.add(s);
  let best = null, bestScore = 0;
  for (const s of cands) {
    const st = slugToks.get(s);
    let inter = 0; for (const t of ct) if (st.has(t)) inter++;
    if (inter < 2) continue;
    const score = inter / Math.max(ct.size, st.size);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best && bestScore >= 0.5) { factImage[f.id] = best; fuzzy++; }
}
const fiEntries = Object.entries(factImage).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
writeFileSync(OUT_FACT, `// AUTO-GENERATED by scripts/gen-image-map.mjs — do not edit.
// factId -> best-matching bundled image slug (${exact} exact + ${fuzzy} fuzzy of ${facts.length} facts).
/* eslint-disable */
export const FACT_IMAGE: Record<string, string> = {
${fiEntries.join('\n')}
};
`);
console.log(`imageMap: ${mapEntries.length} bundled of ${slugPath.size} mapped images (${orphaned} orphaned card PNGs skipped — no such card in the pool${bundledSlugs ? `; ${slugPath.size - mapEntries.length} tail images left to the backfill shards` : ''}) | factImage: ${Object.keys(factImage).length}/${facts.length} facts (${exact} exact + ${fuzzy} fuzzy, ${Math.round(100*Object.keys(factImage).length/facts.length)}%)`);
