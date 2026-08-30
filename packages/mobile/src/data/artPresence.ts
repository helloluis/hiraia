/**
 * Which illustrations are actually ON THIS DEVICE, right now.
 *
 * The APK bundles the HEAD of one ordered list of card art (~140 MB, a little over half the
 * deck); the TAIL arrives later, shard by shard, while the app is open. So "this card has a
 * picture" stopped being a property of the card and became a property of the *installation* —
 * and it can change mid-session, with the reader looking at the feed.
 *
 * This module is the single answer to that question. It is deliberately:
 *
 *   - PURE and dependency-free. It imports nothing (not the 30k-entry generated image map, not
 *     React, not expo-file-system), so the feed's data layer can consult it and the headless
 *     harnesses can still load that data layer under Node.
 *   - a SET, not a stat(). Presence is answered from two in-memory tables — the bundled
 *     manifest, installed once at startup, and the slugs backfill has landed. There is no
 *     per-card filesystem call anywhere on the page-turn path. Both tables are memory only,
 *     so the backfilled one must be REPLAYED from disk at startup or the art a child paid
 *     for goes invisible on the next launch — see `hydrateDownloadedArt`.
 *   - OPTIMISTIC before the manifest is installed. `installBundledArt` has not run yet (or
 *     never runs, as in a harness) → every non-empty slug reads as present, which is exactly
 *     what the code assumed before this module existed. See `hasArt`.
 *
 * Reads are hot (`hasArt` is on the page-turn path), writes are rare (a shard lands), so the
 * shape is tuned for reads: two lookups and no allocation on the common path.
 */

/**
 * Slugs whose PNG is packaged in the APK — the keys of the generated IMAGE_MAP, installed by
 * that module so the manifest can never drift from what Metro actually bundled.
 *
 * `null` means "nobody told us", NOT "nothing is bundled". A full-bundle build, a unit test and
 * every headless harness all run in that state, and all three must behave exactly as they did
 * before presence existed.
 */
let bundled: ReadonlySet<string> | null = null;

/** Slugs backfill has written to disk since install, mapped to the file URI to render. */
const downloaded = new Map<string, string>();

/**
 * Bumped on every change to either table. This is the `getSnapshot` value for React
 * subscribers (see useArtSource) — a scalar, so a re-render happens exactly when the answer
 * for SOME slug changed, and never otherwise.
 */
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** Grade-suffixed slugs ("photosynthesis-g5") fall back to the ungraded image, as resolveImage does. */
const GRADE_SUFFIX = /-g\d+$/;

/**
 * Install the bundled manifest. Idempotent-ish: calling it again replaces the manifest and
 * notifies, which is what a hot-reload or a test wants.
 */
export function installBundledArt(slugs: ReadonlySet<string>): void {
  if (bundled === slugs) return;
  bundled = slugs;
  changed();
}

/** Whether the bundled manifest has been installed (false → `hasArt` is optimistic). */
export function bundledArtInstalled(): boolean {
  return bundled !== null;
}

/**
 * Is this slug's illustration on this device?
 *
 * The empty slug is not an illustration and never has art — thousands of cards share it and
 * they render as typographic posters, which is a layout, not a defect.
 *
 * NOTE the pre-install answer: with no manifest, any non-empty slug reads as present. Every
 * caller here previously tested `slug` for truthiness and nothing else, so this preserves the
 * old behaviour bit-for-bit until the app installs the real manifest. With the manifest of a
 * FULL bundle installed the answer is also unchanged: all 42,975 non-empty card slugs resolve
 * in IMAGE_MAP (verified by scripts/art-presence-check.mts), so `hasArt(slug) === (slug !== '')`.
 */
export function hasArt(slug: string | null | undefined): boolean {
  if (!slug) return false;
  if (downloaded.size !== 0 && downloaded.has(slug)) return true;
  if (bundled === null) return true;
  if (bundled.has(slug)) return true;
  // Only pay for the rewrite when the slug actually carries a grade suffix.
  return GRADE_SUFFIX.test(slug) && bundled.has(slug.replace(GRADE_SUFFIX, '').toLowerCase());
}

/** The on-disk URI for a backfilled illustration, or undefined if it is bundled / absent. */
export function artUri(slug: string | null | undefined): string | undefined {
  return slug && downloaded.size !== 0 ? downloaded.get(slug) : undefined;
}

/**
 * Record that backfill landed one illustration. Safe to call with a URI it already has — a
 * no-op write must not wake every subscribed card in the deck.
 */
export function markArtDownloaded(slug: string, uri: string): void {
  if (!slug || downloaded.get(slug) === uri) return;
  downloaded.set(slug, uri);
  changed();
}

/** Whole shard at once: one notification for the batch, not one per file. */
export function markArtDownloadedMany(entries: Iterable<readonly [string, string]>): void {
  let dirty = false;
  for (const [slug, uri] of entries) {
    if (!slug || downloaded.get(slug) === uri) continue;
    downloaded.set(slug, uri);
    dirty = true;
  }
  if (dirty) changed();
}

/**
 * REPLACE the backfilled table with what is actually on disk. This is the startup half of
 * the backfill contract, and it is not optional.
 *
 * `downloaded` is memory. The record of which packs are installed is not — it has to survive
 * a kill, or the queue would re-download every shard on every launch. Those two facts
 * together are a trap: a persisted "pack N is installed" plus an empty registry means the
 * pack's slugs read as ABSENT, the queue skips the pack because it IS installed, and the
 * bytes a child already paid for sit on disk permanently unreachable. So whatever persists
 * the installed-shard set must replay the member slugs of every installed pack through here
 * BEFORE the first `hasArt` call.
 *
 * Replacing rather than merging is the point: this is a snapshot of the filesystem, so a
 * file that was evicted, or a pack that failed to promote, drops out instead of lingering as
 * a phantom URI with nothing behind it. One notification for the whole snapshot — and none
 * at all when it already matches, which is the ordinary relaunch.
 */
export function hydrateDownloadedArt(entries: Iterable<readonly [string, string]>): void {
  const next = new Map<string, string>();
  for (const [slug, uri] of entries) if (slug) next.set(slug, uri);
  let same = next.size === downloaded.size;
  if (same) {
    for (const [slug, uri] of next) {
      if (downloaded.get(slug) !== uri) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  downloaded.clear();
  for (const [slug, uri] of next) downloaded.set(slug, uri);
  changed();
}

/**
 * The backfilled table, for the installer to persist. Reading it back from here keeps the
 * on-disk index and the in-memory registry ONE source of truth rather than two that can
 * disagree — the same failure `hydrateDownloadedArt` exists to prevent.
 */
export function downloadedArtEntries(): [string, string][] {
  return [...downloaded];
}

/** Backfilled file went away (eviction, corrupt download). Bundled art is unaffected. */
export function forgetArtDownloaded(slug: string): void {
  if (downloaded.delete(slug)) changed();
}

/** How many backfilled illustrations are on disk — the coverage read-out for the shard queue. */
export function downloadedArtCount(): number {
  return downloaded.size;
}

/** Monotonic snapshot token: changes iff some slug's presence changed. */
export function artPresenceVersion(): number {
  return version;
}

/** Subscribe to presence changes; returns the unsubscribe. */
export function subscribeArtPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Back to the pre-install state. For tests and harnesses only. */
export function resetArtPresence(): void {
  bundled = null;
  downloaded.clear();
  changed();
}
