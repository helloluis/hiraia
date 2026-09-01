/**
 * Choosing the ILLUSTRATION for a card — now an ID LOOKUP, not a similarity search.
 *
 * THE ARCHITECTURE: the model does not pick illustrations. It writes one card-shaped fact;
 * the picture is resolved from the GROUNDED FACT THE CARD IS ABOUT — which is not always the
 * top hit, see `attributeCardToFact`. (The model still emits `[image: …]` tags out of retired
 * chat-SFT habit; they are stripped in `prompts/cards.ts` and nothing here reads them. The
 * fix for the emission itself is TRAINING-side, not a prompt patch.)
 *
 * This module is shared because BOTH surfaces run the same selection and must reach the same
 * answer for the same fact: the phone (LocalEngine.resolveFactImage) and the web demo
 * (server/images.ts). The precedence lives in ONE function, `resolveIllustrationSlug`, and
 * the map the surfaces derive from the card index is built by ONE function,
 * `buildFactCardSlugMap`, so the two cannot drift.
 *
 * WHY NO RUNTIME COSINE ANY MORE. The previous path 2 — LaBSE over the clip-art catalog on
 * the fact's own text — was MEASURED end-to-end (160 facts × 3 languages on the shipped Q4
 * substrate) at 27.3% right / 52.3% clearly wrong unfloored, 49% precision at 12% coverage at
 * the 0.70 floor, with right-vs-wrong cosines overlapping (mean 0.636 vs 0.587) so NO floor
 * rescues it. On a surface a child reads as authored fact, a picker that is wrong as often as
 * it is right is not a degraded mode, it is an accuracy failure. It has been REPLACED by two
 * id-keyed maps, in measured precedence:
 *
 *   1. CARD INDEX — factId → the feed card bound to that fact → its authored `slug`
 *      (mobile src/generated/cardsIndex.generated.json). 33,225 of 50,279 bank facts (66.1%)
 *      carry a binding, and 19,547 of those slugs are engravings generated FOR that very fact
 *      (slug == the card's own id), with another 13.7k reusing a sibling card's art by
 *      exact-id assignment.
 *   2. CURATED — the generated fact_id → slug map (mobile src/generated/factImage.ts),
 *      5,073 entries (1,583 exact + 3,490 fuzzy), 82% right / 0% clearly wrong on its
 *      measured sample. Consulted where the card index has no drawable answer.
 *   3. NOTHING — text-only, the poster layout. No cosine fallback.
 *
 * THE PRECEDENCE WAS MEASURED, NOT ASSUMED. The two maps overlap on 3,518 bank facts and
 * agree on only 48.7% of them, so the order matters. On a 48-item seed-fixed sample of the
 * 1,805 disagreements, each judged fact-text vs BOTH images (engravings inspected visually
 * where slug names are opaque): card index better 19, curated better 3, tie 26 — and
 * card-first leaves ~1-2 clearly-wrong picks in the sample against ~6 for curated-first.
 * The curated map's weakness is its FUZZY half, which matches thematically (every
 * water-cycle fact → the same "water-cycle-bag-window" plate, an iron→steel fact →
 * "separating-iron-sulfur-mixture"); the card index binds by exact fact id and its engravings
 * were drawn for the fact. Hence CARD INDEX FIRST.
 *
 * FALLTHROUGH ON PRESENCE IS NOW ALLOWED, and that is a deliberate reversal. The old rule —
 * "a curated entry gets that engraving or NOTHING" — existed because the only thing below the
 * curated map was the ~44%-right cosine path, and substituting noise for the best answer was
 * a downgrade. Both remaining paths are high-precision id lookups, so when a surface cannot
 * draw the card-index slug (the web demo publishes only a fraction of the ffct engravings),
 * consulting the curated map is falling back to the SECOND-best answer, not to noise. The
 * final fallback is still NOTHING, and both surfaces are laid out for it.
 *
 * The int8 catalog blob, `ImageIndex`, the domain scoping and `acceptImageMatch` below are
 * KEPT: they are the substrate of the retired-but-shaped `resolveImageTag` path and of
 * OFFLINE candidate proposal (an offline pass may PROPOSE slugs by cosine for a human to
 * accept into the curated map). Nothing in the RUNTIME card path embeds anything any more.
 */

import { tokenize } from './tokenize.js';
import type { ScienceFact } from './types.js';

/** A resolved illustration: the catalog slug and the true cosine it won on. */
export interface ImageMatch {
  slug: string;
  cosine: number;
}

/** The build-time image catalog: one int8 vector per bundled illustration. */
export interface ImageCatalogBlob {
  dims: number;
  /** int8 → cosine dequant factor (cosine = dot(query, int8) * scale). */
  scale: number;
  count: number;
  /** Catalog slug per row, in blob order. */
  slugs: readonly string[];
  /** Row-major int8: [slug0 dims][slug1 dims]… */
  data: Int8Array;
}

/** One row of the generated card index, as this module needs it (a subset of CardFact). */
export interface IndexedCard {
  /** The card's own id (ffct-NNNNN) — also the id of the engraving generated FOR the card. */
  id: string;
  /** The bank fact this card restates — the exact-id key of the whole scheme. */
  factId: string;
  /** The card's authored illustration slug; empty/absent = the card itself has no art. */
  slug?: string;
}

/**
 * factId → illustration slug, derived from the card index (cardsIndex.generated.json) — the
 * SELECTION rule for path 1, shared so the phone and the web derive the identical map.
 *
 * A fact can back several cards (439 of 33k do). Preference, per fact:
 *   1. the first card whose slug IS its own id — an engraving generated FOR this fact, the
 *      strongest binding the library has;
 *   2. otherwise the first card with any non-empty slug (a sibling engraving or a named
 *      clip-art plate, still assigned by exact id).
 * Cards with an empty slug (3,446 of 46,421) contribute nothing.
 *
 * This is exactly the rule the precedence measurement in the header was run with — changing
 * it invalidates those numbers.
 */
export function buildFactCardSlugMap(cards: Iterable<IndexedCard>): Map<string, string> {
  const map = new Map<string, string>();
  const factSpecific = new Set<string>();
  for (const c of cards) {
    if (!c.factId || !c.slug) continue;
    const self = c.slug === c.id;
    if (!map.has(c.factId)) {
      map.set(c.factId, c.slug);
      if (self) factSpecific.add(c.factId);
    } else if (self && !factSpecific.has(c.factId)) {
      map.set(c.factId, c.slug);
      factSpecific.add(c.factId);
    }
  }
  return map;
}

/**
 * Per-fact QA DENYLIST for the CARD-INDEX binding (path 1 only). The card index's weakness is
 * its ~13.7k sibling-slug reuses: a card with no engraving of its own borrows a sibling
 * card's art by exact-id assignment, and when that assignment is wrong the binding prints a
 * WRONG picture over an authored fact. A fact listed here skips path 1 and falls through to
 * the curated map (or to nothing) exactly as if the index had no binding — the deny is on the
 * BINDING, never on the fact's right to a picture. Lives HERE, in the shared resolver, so
 * both surfaces honour it without either remembering to.
 *
 * Confirmed instances only, each verified by reading the bound card's own subject:
 *   - fwg-forms-of-energy-1410 ("a car at 60 km/h has four times the kinetic energy of
 *     30 km/h") binds via a sibling slug to ffct-34903, whose own card and engraving are
 *     "Typhoon Winds" (fwg-typhoon-winds-120). The curated map has the right picture
 *     (energy-forms-icons), so mobile falls through to it; the web, which does not publish
 *     that plate, falls through to text-only — still better than typhoon art on a kinetic-
 *     energy card.
 */
export const CARD_BINDING_DENY: ReadonlySet<string> = new Set(['fwg-forms-of-energy-1410']);

/**
 * THE PRODUCT PATH: the illustration slug for one grounded fact, or null — the measured
 * precedence from the header (card index → curated map → nothing), presence-gated per step.
 *
 * `isPresent` is the SURFACE's question — mobile answers it with `artSourceFor` (bundled +
 * backfilled art), the web with its published set under public/demo/cards — and a slug must
 * pass it to WIN: a slug the surface cannot draw does not block the next path, it yields to
 * it (see the header on why fallthrough is now correct). Null is the ordinary answer and
 * both surfaces lay the card out for it.
 */
export function resolveIllustrationSlug(opts: {
  factId: string;
  /** Path 1: the card-index binding (buildFactCardSlugMap on the surface's index). */
  cardSlugOf: (factId: string) => string | undefined;
  /** Path 2: the curated FACT_IMAGE map. */
  curatedSlugOf: (factId: string) => string | undefined;
  /** Whether THIS surface can actually draw a slug. */
  isPresent: (slug: string) => boolean;
}): string | null {
  const card = CARD_BINDING_DENY.has(opts.factId) ? undefined : opts.cardSlugOf(opts.factId);
  if (card && opts.isPresent(card)) return card;
  const curated = opts.curatedSlugOf(opts.factId);
  if (curated && opts.isPresent(curated)) return curated;
  return null;
}

/**
 * DOMAIN SCOPING. A bare cosine does naive word-association across topics — an EARTH_SPACE
 * earthquake fact matched a "philippine-pangolin" on the shared word "Philippine"; a
 * FORCE_MOTION_ENERGY gravity fact matched an atomic-model diagram. Candidates are therefore
 * constrained to the catalog categories that belong to the fact's science domain: a geology
 * fact can never surface an animal, an animal fact can never surface a reaction diagram.
 * 'general' (topic-agnostic filler) is allowed everywhere; 'flagged' never. An ABSENT domain →
 * no scoping (the floor still applies); an UNKNOWN one → no picture, see `imageDomainScope`.
 *
 * Worth knowing what this does and does NOT buy, measured on the same 480 rows: scoping
 * changed the winner in 32% of them, and those rows are 74% clearly wrong. It removes the
 * cross-domain absurdity and replaces it with an in-domain one (cuttlefish → pig-wallowing-
 * in-mud). It is a guard rail, not a ranker.
 *
 * TYPED BY THE DOMAIN UNION, deliberately: `Record<ScienceFact['domain'], …>` makes adding a
 * domain to the bank a COMPILE ERROR here until it is given a scope. Widened to
 * `Record<string, …>` a new domain would type-check, find no row, and — under the old filter —
 * fall through to an UNSCOPED scan of all 4,228 slugs, i.e. exactly the
 * earthquake→philippine-pangolin class this table exists to prevent, silently.
 */
export const DOMAIN_IMAGE_CATEGORIES: Record<ScienceFact['domain'], ReadonlySet<string>> = {
  LIVING_THINGS: new Set(['biology', 'general']),
  EARTH_SPACE: new Set(['earth-science', 'physics', 'general']), // weather/geology + astronomy
  FORCE_MOTION_ENERGY: new Set(['physics', 'general']),
  MATTER: new Set(['chemistry', 'physics', 'general']),
  PH_GEOGRAPHY: new Set(['earth-science', 'general']),
  /**
   * PH_CIVICS IS ILLUSTRATED BY NOTHING, deliberately — an EMPTY set, which admits no
   * candidate and short-circuits the scan. It used to be scoped to 'general' (919 slugs) and
   * scored 0 right out of 36 rows at EVERY floor, including 0.75: the bank's civics facts
   * (Quezon, the bicameral Congress, the Bill of Rights) simply have no illustration in a
   * clip-art catalog of plants, animals and apparatus. A domain where the measured precision
   * is zero should not be allowed to draw from the noise band.
   */
  PH_CIVICS: new Set<string>(),
  ABOUT_HIRAIA: new Set(['general']),
};

/**
 * The DOMAIN SCOPE predicate for one fact — which catalog slugs this fact is even allowed to
 * be illustrated by. Composed once here so the two surfaces cannot drift on it.
 *
 * Returns `null` for "this fact gets NO picture, do not even embed": either the domain admits
 * no category at all (PH_CIVICS, measured 0 right out of 36) or the domain is not in the table
 * at all. The second case cannot happen through the type system — that is the point of typing
 * the table by the domain union — but a value cast or a JS caller must fail CLOSED, because an
 * unscoped scan is not the behaviour any of the numbers above were measured on.
 *
 * An ABSENT domain (`undefined`) is different from an unknown one and still means "no scoping":
 * the retired tag path (`resolveImageTag`) resolves a description that belongs to no fact.
 *
 * PRESENCE IS NOT PART OF THIS, and that is a correction. It used to be filtered INSIDE the
 * scan, which quietly made the pick a function of the surface: the phone bundles all 4,228
 * catalog slugs, the web publishes 1,218 of them, so the same fact was ranked over two
 * different pools and the web printed a substitute engraving — a different picture from the
 * app's for the same card — rather than the app's picture or none. It also invalidated the
 * floor: the table below was measured over the WHOLE catalog, and the best of a 29% subset
 * clearing 0.70 is not the same claim. So the ranking is now pool-independent and presence is
 * an ADMISSION test on the winner (`acceptImageMatch`): same slug on both surfaces, or none.
 */
export function imageDomainScope(opts: {
  /** The grounded fact's science domain; ABSENT (not unknown) → no scoping. */
  domain?: ScienceFact['domain'];
  /** Catalog category for a slug (mobile: IMAGE_CATEGORY; web: parsed from the same file). */
  categoryOf: (slug: string) => string | undefined;
}): ((slug: string) => boolean) | null {
  const { domain, categoryOf } = opts;
  if (!domain) return () => true;
  const allowed: ReadonlySet<string> | undefined = DOMAIN_IMAGE_CATEGORIES[domain];
  if (!allowed || allowed.size === 0) return null;
  return (slug) => allowed.has(categoryOf(slug) ?? 'general');
}

/**
 * The two gates every retrieved pick has to clear, applied to the WINNER of the scan rather
 * than to its candidates: the caller's measured floor, then whether this surface can actually
 * draw the slug (the APK's bundled + backfilled art; the web's published set).
 *
 * Dropping a present-less winner rather than ranking around it is what keeps the two surfaces
 * on the SAME picture — the alternative prints the best drawable substitute, which is a
 * different card's engraving under this card's sentence. Null is the ordinary answer either
 * way, and both surfaces are laid out for it.
 */
export function acceptImageMatch(
  hit: ImageMatch | null,
  opts: { floor: number; isPresent: (slug: string) => boolean }
): ImageMatch | null {
  if (!hit || hit.cosine < opts.floor) return null;
  return opts.isPresent(hit.slug) ? hit : null;
}

/**
 * Brute-force nearest illustration over the int8 catalog — the ONE cosine loop in the
 * product, so neither surface grows a second one.
 *
 * Same shape and reasoning as SemanticIndex (its fact-bank sibling): the catalog is embedded
 * at build time with the exact runtime embedder (rag/scripts/build-image-vectors.py, LaBSE
 * raw-CLS), shipped quantized, and scanned flat — 4,228 rows is sub-millisecond. The constant
 * dequant `scale` cancels in the ranking and is applied only to recover the true cosine the
 * floor is expressed in.
 */
export class ImageIndex {
  constructor(private blob: ImageCatalogBlob) {}

  get count(): number {
    return this.blob.count;
  }

  /**
   * Best candidate for a NORMALIZED query vector, or null when `accept` left nothing to
   * choose from. Deliberately returns the match WITHOUT applying a floor: the floor belongs
   * to the caller's path (the retired tag path has its own, IMAGE_TAG_FLOOR), and returning
   * the cosine either way is what lets a caller log a near miss.
   */
  best(query: Float32Array, accept?: (slug: string) => boolean): ImageMatch | null {
    const { dims, scale, count, slugs, data } = this.blob;
    let best = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < count; i++) {
      const slug = slugs[i]!;
      if (accept && !accept(slug)) continue;
      let dot = 0;
      const off = i * dims;
      for (let d = 0; d < dims; d++) dot += query[d]! * data[off + d]!;
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    if (best < 0) return null;
    // corpus rows were unit-norm before int8 quantization, so this recovers the true cosine
    return { slug: slugs[best]!, cosine: bestDot * scale };
  }
}

/**
 * WHICH RETRIEVED FACT THE PRINTED CARD IS ACTUALLY ABOUT — the fact to illustrate.
 *
 * The picture used to be anchored to `hits[0]`, the best hit for the QUERY. But the card is
 * written from all four, and `buildCardPrompt` explicitly permits the model to print a
 * different one: "kung walang FACT na sumasagot sa TANONG, isulat na lang nang buo ang
 * pinakamalapit na FACT". When it takes that escape, anchoring on `hits[0]` illustrates a fact
 * the card does not state — "ano ang carabao" retrieves the tamaraw-vs-carabao contrast first,
 * the card states the carabao, and the plate showed a tamaraw: a different, explicitly
 * contrasted species. Same shape for kidlat→thunder and volcano→shield-volcano.
 *
 * So the card is ATTRIBUTED to its source fact before the picture is resolved from it. This is
 * attribution, not ranking: the card is a 20-word restatement of ONE of these four strings, and
 * the question is only which one — a far easier question than the cosine problem above, and it
 * is answered from the printed text rather than from a guess about it.
 *
 * The measure is token overlap weighted by 1/(number of CANDIDATES carrying the token), which
 * has no tunable constant and needs no stop-word list: a word every candidate shares ("ang",
 * "the", the topic noun) carries almost no evidence and is scored as such, while a word unique
 * to one candidate ("tamaraw") is decisive. `tokenize` is the retriever's own tokenizer, so
 * this agrees with how the bank is indexed.
 *
 * CONSERVATIVE BY CONSTRUCTION: ties and a no-overlap card both resolve to index 0, so the
 * result differs from the old `hits[0]` behaviour only when another retrieved fact matches the
 * printed sentence STRICTLY better. Returns an index into `factTexts` — the caller maps it back
 * to the fact, because the illustration needs the fact's ID: it is the key into both the card
 * index and the curated map (`resolveIllustrationSlug`).
 */
export function attributeCardToFact(cardText: string, factTexts: readonly string[]): number {
  if (factTexts.length < 2) return 0;
  const card = new Set(tokenize(cardText));
  if (card.size === 0) return 0;
  const candidates = factTexts.map((t) => new Set(tokenize(t)));
  // How many candidates carry each token the card used — the discriminative weight.
  const spread = new Map<string, number>();
  for (const t of card) {
    let n = 0;
    for (const c of candidates) if (c.has(t)) n++;
    if (n > 0) spread.set(t, n);
  }
  let best = 0;
  let bestScore = 0;
  candidates.forEach((c, i) => {
    let score = 0;
    for (const [t, n] of spread) if (c.has(t)) score += 1 / n;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
