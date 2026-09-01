/**
 * factId → illustration slug, derived from the bundled card index — PATH 1 of the card
 * illustration precedence (@hiraia/shared rag/images.ts, `resolveIllustrationSlug`).
 *
 * The card index binds 33,225 of the bank's 50,279 facts to a feed card by exact id, and
 * 19,547 of those cards carry an engraving generated FOR that very fact — a far stronger
 * answer than any similarity search, which is why this lookup replaced the runtime LaBSE
 * scan as the product path. The derivation rule (prefer the card whose slug is its own id)
 * is shared, because the web server derives the same map from the same file and the two
 * surfaces must reach the same picture.
 *
 * `cardsIndex.generated.json` is already resident in the JS bundle (cards.ts/cardDb.ts paint
 * the feed from it), so importing it here costs nothing new. The Map itself (~33k entries)
 * is built once, lazily, on the first generated card that needs a picture — never on the
 * path to first paint.
 */
import { buildFactCardSlugMap, type IndexedCard } from '@hiraia/shared';

import cardsIndex from '../generated/cardsIndex.generated.json';

let map: Map<string, string> | null = null;

/** The card-index illustration slug for a bank fact, or undefined when no card binds it. */
export function cardSlugForFact(factId: string): string | undefined {
  if (!map) {
    map = buildFactCardSlugMap((cardsIndex as { cards: IndexedCard[] }).cards);
  }
  return map.get(factId);
}
