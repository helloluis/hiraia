/**
 * Resolving a slug to something <Image> can draw — from EITHER place it may live.
 *
 * `resolveImage` (generated) only knows about art packaged in the APK. Once the bundle is the
 * head of the list and backfill supplies the tail, an illustration can also be a file on disk,
 * and it can appear while the reader is looking at the card. This module is the one place that
 * knows both, and the hook is how a rendered card learns that its picture just landed.
 *
 * Importing this module also guarantees the bundled manifest is installed, because it imports
 * the generated map (which registers itself).
 */
import { useMemo, useState, useSyncExternalStore } from 'react';

import { resolveImage } from '../generated/imageMap';

import { artPresenceVersion, artUri, hasArt, subscribeArtPresence } from './artPresence';

/** A Metro asset id (bundled), a file URI (backfilled), or nothing to draw. */
export type ArtSource = number | { uri: string } | null;

/**
 * The picture for this slug on THIS device, or null if it is not here (yet).
 *
 * Backfilled art wins over the bundle when both somehow exist: the on-disk copy is the newer
 * of the two and re-rendering from it is what makes a landing shard visible.
 */
export function artSourceFor(slug: string | null | undefined): ArtSource {
  if (!slug) return null;
  const uri = artUri(slug);
  if (uri) return { uri };
  return hasArt(slug) ? resolveImage(slug) : null;
}

/**
 * `artSourceFor`, but the component re-renders if the answer changes while it is mounted.
 *
 * Subscribing to a scalar version rather than to the source itself keeps `getSnapshot` stable
 * (returning a fresh `{ uri }` object every call would loop React forever) and means a shard
 * landing costs one re-render of the mounted cards, not a poll.
 */
export function useArtSource(slug: string | null | undefined): ArtSource {
  const version = useSyncExternalStore(
    subscribeArtPresence,
    artPresenceVersion,
    artPresenceVersion
  );
  return useMemo(() => artSourceFor(slug), [slug, version]);
}

/** Same picture, by value — a recomputed `{ uri }` is the same picture as the last one. */
function sameArt(a: ArtSource, b: ArtSource): boolean {
  if (a === b) return true;
  return typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.uri === b.uri;
}

/**
 * `useArtSource`, but a page the reader is in the middle of does not re-typeset under them.
 *
 * Whether a card HAS a picture is not a cosmetic detail — it selects the whole layout. With
 * art the factoid is a caption at `tierFor` size; without it the card is set as a poster,
 * with a lifted display line and `fitType` sizing (see CardPage). So a shard landing while
 * a poster page is on screen would, with the raw hook, shrink the type, drop the display
 * line, insert an illustration plate and reflow the paragraph — mid-sentence, with the
 * typewriter's character count carrying over into different metrics.
 *
 * The latch: adopt the live answer when the page changes identity (a mount, or a reused
 * instance handed a new fact), and while that page stays put adopt a newer one ONLY when it
 * cannot change the layout — an asset swapped for another asset, never null↔asset. A page
 * that was a poster when the reader arrived stays a poster until they turn it, and the very
 * next mount of that card is illustrated. The pre-rendered neighbours upgrade the same way,
 * at exactly the moment they become the page you are looking at.
 */
export function useLatchedArtSource(slug: string | null | undefined, pageId: string): ArtSource {
  const live = useArtSource(slug);
  const [latched, setLatched] = useState(live);
  const [page, setPage] = useState(pageId);
  // Deriving state from props during render: React re-runs this component immediately with
  // the new state and never commits the stale pass, so there is no flash of the old layout.
  if (page !== pageId) {
    setPage(pageId);
    setLatched(live);
    return live;
  }
  if (!sameArt(latched, live) && (latched == null) === (live == null)) {
    setLatched(live);
    return live;
  }
  return latched;
}
