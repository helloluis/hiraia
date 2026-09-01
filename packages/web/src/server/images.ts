/**
 * Server-side ILLUSTRATION selection for the web demo's dynamic card — the same pick the
 * shipped APK makes on-device, mirrored on the VPS so a card printed on hiraia.org carries the
 * picture the APK would carry. Sibling of server/rag.ts, and the same parity argument: the
 * grounding is already shared, and a demo whose pictures were chosen by different rules would
 * stop being a demo of the app.
 *
 * AN ID LOOKUP, NOT A SIMILARITY SEARCH. The runtime LaBSE scan that used to be path 2 was
 * measured at 27% right / 52% clearly wrong unfloored, 49% precision at the 0.70 floor, with
 * right-vs-wrong cosines overlapping — deleted on both surfaces. The precedence that replaced
 * it, and the 48-disagreement sample that fixed its order, live in @hiraia/shared
 * (rag/images.ts, `resolveIllustrationSlug`):
 *
 *   1. CARD INDEX — factId → the feed card bound to that fact → its authored slug
 *      (mobile src/generated/cardsIndex.generated.json, via the SHARED derivation
 *      `buildFactCardSlugMap` so this map is byte-identical to the phone's). 66% of the
 *      bank, most of it engravings generated FOR the fact.
 *   2. CURATED — the generated fact_id → slug map (mobile src/generated/factImage.ts),
 *      ~10% of the bank, 82% right / 0% clearly wrong.
 *   3. NOTHING — the poster layout. Never a cosine guess.
 *
 * PRESENCE gates each step but no longer terminates the resolve: this site publishes only a
 * fraction of the app's art (public/demo/cards — 1,725 files, ~500 of them ffct engravings of
 * the app's ~30k), so the card-index winner is frequently undrawable HERE. It then yields to
 * the curated map rather than to nothing, because both paths are high-precision id lookups —
 * falling through swaps the best answer for the second-best, not for noise (which is what the
 * old "curated or NOTHING" rule was actually guarding against). The page still never links a
 * 404: a slug is returned only if its PNG is published.
 *
 * The generated maps are read out of the MOBILE package rather than duplicated here — the
 * pattern server/rag.ts established: the full repo is checked out on the VPS, and the
 * generated maps are the artefacts the APK itself ships. A copy in packages/web would be a
 * second thing to regenerate and the first to go stale. Both paths are overridable by env for
 * a deploy that lays the tree out differently.
 *
 * Everything degrades to "no picture", which is the ordinary outcome anyway — but the maps
 * are BUILD ARTEFACTS, so an unreadable one is a deploy fault rather than a mode worth
 * serving quietly; it is logged at error level.
 *
 * SERVER-ONLY. Never import this from a client component — it reads the filesystem and holds
 * the maps in RAM.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildFactCardSlugMap,
  resolveIllustrationSlug,
  type IndexedCard,
  type ScienceFact,
} from '@hiraia/shared';

/** Where the mobile package's generated maps live (same default as server/rag.ts). */
const MOBILE_DIR = process.env.HIRAIA_MOBILE_DIR || path.join(process.cwd(), '..', 'mobile');
const FACT_IMAGE_PATH = path.join(MOBILE_DIR, 'src', 'generated', 'factImage.ts');
const CARDS_INDEX_PATH = path.join(MOBILE_DIR, 'src', 'generated', 'cardsIndex.generated.json');

/** The illustrations this site actually serves. */
const PUBLIC_CARDS_DIR =
  process.env.HIRAIA_DEMO_CARDS_DIR || path.join(process.cwd(), 'public', 'demo', 'cards');

interface Catalog {
  /** factId → card-index slug. Path 1: 66% of the bank, mostly fact-specific engravings. */
  factCard: ReadonlyMap<string, string>;
  /** factId → curated slug. Path 2: ~10% coverage, 82% right and 0% clearly wrong. */
  factImage: Record<string, string>;
  /** slugs with a PNG under public/demo/cards. */
  published: ReadonlySet<string>;
}

/**
 * Read the curated map out of the mobile package.
 *
 * It is machine-written — an `/* eslint-disable *\/`-headed object literal of plain
 * `"key": "value"` pairs — so a pair scan reads it exactly and without evaluating TypeScript
 * on the server. It has a fixed emitter (mobile scripts/gen-image-map.mjs); if that emitter
 * ever stops writing string pairs this returns {}, and buildCatalog treats an empty map as
 * the DEPLOY FAULT it is. Empty is loud; the caller logs it at error level.
 */
function readGeneratedStringMap(file: string, label: string): Record<string, string> {
  try {
    const src = readFileSync(file, 'utf8');
    const out: Record<string, string> = {};
    const re = /"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out[m[1]!] = m[2]!;
    if (Object.keys(out).length === 0) throw new Error('no entries parsed');
    return out;
  } catch (e) {
    console.warn(`[images] ${label} unavailable — that path is off:`, e);
    return {};
  }
}

function buildCatalog(): Catalog {
  // Path 1: the card index, derived through the SHARED rule (prefer the card whose slug is
  // its own id — the engraving generated for the fact) so the phone and this server hold the
  // identical factId → slug map. The demo BUNDLES only a slice of the cards, but the server
  // reads the full index; the published-set gate below is what keeps links real.
  let factCard: ReadonlyMap<string, string> = new Map();
  try {
    const idx = JSON.parse(readFileSync(CARDS_INDEX_PATH, 'utf8')) as { cards?: IndexedCard[] };
    if (!idx.cards?.length) throw new Error('no cards in index');
    factCard = buildFactCardSlugMap(idx.cards);
    console.log(
      `[images] card index attached: ${idx.cards.length} cards → ${factCard.size} fact bindings`
    );
  } catch (e) {
    console.error(
      `[images] card index unreadable (${CARDS_INDEX_PATH}) — the primary illustration path ` +
        'is off and only the ~10%-coverage curated map remains. This is a deploy fault ' +
        '(check HIRAIA_MOBILE_DIR), not a degraded mode:',
      e
    );
  }

  const factImage = existsSync(FACT_IMAGE_PATH)
    ? readGeneratedStringMap(FACT_IMAGE_PATH, 'curated FACT_IMAGE map')
    : {};
  if (Object.keys(factImage).length === 0) {
    console.error(
      `[images] curated FACT_IMAGE map is EMPTY (${FACT_IMAGE_PATH}) — the curated fallback ` +
        'is off. This is a deploy fault (check HIRAIA_MOBILE_DIR), not a degraded mode.'
    );
  }

  let published: ReadonlySet<string> = new Set();
  try {
    published = new Set(
      readdirSync(PUBLIC_CARDS_DIR)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => f.slice(0, -4))
    );
    console.log(`[images] ${published.size} illustrations published under public/demo/cards`);
  } catch (e) {
    console.warn('[images] published art unreadable — cards will print without pictures:', e);
  }

  return { factCard, factImage, published };
}

/** Lazily built, then cached for the process lifetime (a few MB, same as the phone carries). */
let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = Promise.resolve().then(buildCatalog);
  return catalogPromise;
}

/**
 * The card's illustration slug for one grounded fact, or null.
 *
 * NULL IS AN ORDINARY ANSWER and the page is laid out for it: printing a confidently-wrong
 * engraving under a true sentence is worse than printing none. Both paths are gated on the
 * art being published here, so a returned slug always resolves to a real
 * `/demo/cards/<slug>.png`. Kept async for signature stability — nothing here awaits I/O
 * after the first call warms the catalog.
 */
export async function resolveCardImage(fact: ScienceFact): Promise<string | null> {
  const cat = await getCatalog();
  return resolveIllustrationSlug({
    factId: fact.id,
    cardSlugOf: (id) => cat.factCard.get(id),
    curatedSlugOf: (id) => cat.factImage[id],
    isPresent: (slug) => cat.published.has(slug),
  });
}

/** Eagerly warm the catalog (map reads) at server start, as warmRag does for the bank. */
export function warmImages(): void {
  void getCatalog();
}
