/**
 * Reading a card's prose from a page that may have been drawn BEFORE that prose arrived.
 *
 * The feed's data layer answers everything about a card synchronously, and that is
 * load-bearing: sequencing, the duplicate check and the choice labels all run inside a page
 * turn and none of them can await (see cardDb's `textOf`). The prose is the one part that is
 * not in the JS bundle — it is 19 MB of the 133 MB database that has to be copied out of the
 * APK once, on first run — so `textOf` can legitimately answer "not yet", and `cardText`
 * turns that into ''.
 *
 * '' is a dangerous non-answer. It does not look like a card that is loading; it looks like a
 * finished card with nothing printed on it, because the typewriter completes instantly on an
 * empty string and the illustration and choice tickets then fade in on schedule. The store
 * warms a page ahead precisely so this cannot happen, and on the warm path (every launch after
 * the first) it does not — but "warmed ahead" is a promise about the ordinary walk, and the
 * ways a card reaches the screen without one are exactly the ways a reader meets a blank card:
 * the first card of a first run, racing the copy; the reroll, which navigates without warming.
 *
 * This module closes that gap the same way `artSource` closes the one for illustrations: the
 * component that is showing the card SUBSCRIBES to it, and asks for what it is missing.
 * Nothing here polls, nothing here awaits, and `textOf` stays synchronous.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { Language } from '@hiraia/shared';

import { requestText, subscribeCardText, textOf, type CardTextRow } from './cardDb';
import { cardEmphasis, cardText, cardTitle, type CardFact } from './cards';

/**
 * The warmed row for a card, re-rendering the caller when it lands — and asking for it if it
 * is not here.
 *
 * The snapshot is the ROW OBJECT, not the version counter, and that is what keeps this cheap.
 * A row is stored once and handed out by reference, so `getSnapshot` is stable by value:
 * `useSyncExternalStore` compares with `Object.is` and bails out without re-rendering when the
 * answer for THIS card did not change. A batch of rows landing for the next page therefore
 * wakes the store's listeners but re-renders only the pages whose own text arrived — which,
 * once the deck is warm, is none of them.
 */
export function useCardTextRow(id: string): CardTextRow | undefined {
  const snapshot = useCallback(() => textOf(id), [id]);
  const row = useSyncExternalStore(subscribeCardText, snapshot, snapshot);
  // Demand-side repair, in an effect so a render never starts a query. Runs once per cold
  // card: when the row lands `row` changes, the effect re-runs and `requestText` returns on
  // its first line. A row that does not exist in the database leaves this quiet rather than
  // looping — the version only moves when rows actually land.
  useEffect(() => {
    if (!row) requestText(id);
  }, [id, row]);
  return row;
}

/** A card's printed content in the reader's language: what CardPage needs to typeset it. */
export interface CardCopy {
  /** The factoid itself, '' while the row is still on its way. */
  text: string;
  /** Terms to emphasise, as exact substrings of `text`. */
  emphasis: string[] | undefined;
  /** The short band title, '' when the card has none (the band falls back to its topic). */
  title: string;
}

/**
 * `cardText` + `cardEmphasis` + `cardTitle` for one card, as one value that updates when the
 * card's row arrives.
 *
 * The three go together on purpose: they are three reads of the SAME row, so resolving them in
 * one memo keyed on that row means a card can never paint its text from a row its emphasis
 * spans do not come from.
 */
export function useCardCopy(fact: CardFact, language: Language): CardCopy {
  const row = useCardTextRow(fact.id);
  return useMemo(
    () => ({
      text: cardText(fact, language),
      emphasis: cardEmphasis(fact, language),
      title: cardTitle(fact, language),
    }),
    // `row` is the freshness token; the accessors read it back out of the store themselves
    // so the language fallback chain stays in one place (cards.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fact, language, row]
  );
}
