/**
 * The LAN download mirror: the provisioning laptop serving Hiraia's post-install downloads
 * (embedder, vectors, image packs) to donated phones, so a classroom of phones does not pull
 * the same gigabytes over the school's internet link one phone at a time.
 *
 * THE MIRROR IS AN UNTRUSTED DELIVERY TRUCK. Nothing it says is believed. It can only ever
 * be asked for a file whose size and MD5 are already known from somewhere it cannot touch
 * (the table in src/config/model.ts and imagePacks.generated.json, both baked into the APK,
 * or a catalog fetched from hiraia.org over HTTPS), and engine/modelDownload.ts refuses any
 * byte that does not match. So a hostile or broken mirror can waste time and bandwidth but
 * never get a wrong byte installed: a silent mirror costs seconds, a wrong file costs one
 * LAN transfer, and a redirect (the platform's HTTP stack follows them) only changes where
 * the same checked bytes come from. One that trickles bytes can hold a download open, but
 * anything able to pose as the mirror on the Wi-Fi could block the phone's traffic anyway.
 *
 * WHERE THE ADDRESS COMES FROM: only Android managed configuration, the "assetMirror" app
 * restriction that the device owner (Hiraia Setup, packages/provisioner) sets. No deep link,
 * settings screen, catalog field or runtime env var can set one — each of those would let
 * someone other than the phone's owner point downloads elsewhere.
 *
 * Everything here is pure apart from the breaker's own memory, and the native read and the
 * clock are injected, so the rules are testable in Node.
 */

/** The only URLs that may be served by a mirror. Anything else always goes to its own host. */
export const CANONICAL_ASSET_PREFIX = 'https://assets.hiraia.org/models/';

/** One IPv4 octet in canonical decimal: 0–255, no leading zeros. */
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)';
/**
 * scheme://a.b.c.d[:port][/path]. The host must be a LITERAL IPv4 address: a hostname would
 * need DNS, which anyone on the Wi-Fi can answer. No userinfo, query or fragment can match,
 * and path segments are limited to plain characters, so there is no percent-encoding or
 * dot-segment for a URL parser downstream to reinterpret.
 */
const MIRROR = new RegExp(
  `^(https?)://${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}(?::([1-9]\\d{0,4}))?` +
    '((?:/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*)$'
);
/** What may follow the canonical prefix: plain filenames, optionally under a plain folder. */
const REST = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** RFC 1918 private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. */
function isPrivateIpv4(a: number, b: number): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Validate the managed-configuration value. Returns the mirror base URL without trailing
 * slashes, or null for anything that is not an http(s) URL on a private IPv4 address.
 *
 * Plain HTTP is accepted on purpose, and ONLY because the transport is not what makes a
 * download trustworthy here: every byte is checked against the APK-baked size and MD5
 * before it is used. A LAN laptop has no publicly trusted certificate, and TLS would add
 * nothing that check does not already give.
 */
export function parseAssetMirror(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const value = raw.replace(/\/+$/, '');
  const m = MIRROR.exec(value);
  if (!m) return null;
  const [, , a, b, , , port] = m;
  if (!isPrivateIpv4(Number(a), Number(b))) return null;
  if (port !== undefined && Number(port) > 65535) return null;
  return value;
}

/**
 * The mirror URL for a canonical asset URL, or null when it must not go to the mirror.
 * `https://assets.hiraia.org/models/<rest>` becomes `<mirror>/<rest>`, so image packs land at
 * `<mirror>/images/<filename>`. Only that exact prefix maps.
 */
export function mirrorUrlFor(canonicalUrl: string, mirror: string | null): string | null {
  if (!mirror || !canonicalUrl.startsWith(CANONICAL_ASSET_PREFIX)) return null;
  const rest = canonicalUrl.slice(CANONICAL_ASSET_PREFIX.length);
  return REST.test(rest) ? `${mirror}/${rest}` : null;
}

/** Where one download would come from on the mirror: the mirror's base URL, and the file's URL. */
export type AssetMirrorRoute = { mirror: string; url: string };

/**
 * Read the setting (via `readSetting`, the native managed-configuration read) and map
 * `canonicalUrl` onto it. Never throws: a failed read is simply "no mirror". Called when each
 * download starts, not cached, because the device owner can move the mirror at any time.
 */
export async function assetMirrorRoute(
  canonicalUrl: string,
  readSetting: () => unknown
): Promise<AssetMirrorRoute | null> {
  // Assets that could never map do not need the platform call at all.
  if (!canonicalUrl.startsWith(CANONICAL_ASSET_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = await readSetting();
  } catch {
    return null;
  }
  const mirror = parseAssetMirror(raw);
  const url = mirrorUrlFor(canonicalUrl, mirror);
  return mirror && url ? { mirror, url } : null;
}

/**
 * How long a mirror that has just stopped answering is left alone. The setting outlives the
 * warehouse: a provisioned phone carries it to school, where the address points at nothing
 * (or at some unrelated device), and without this every file would first pay a probe that
 * cannot succeed. Short, because in the warehouse the same silence is usually a hiccup (a
 * Wi-Fi roam, the server restarting after a sync), and a warehouse without internet has
 * nowhere else to download from while the mirror is skipped.
 */
export const MIRROR_COOL_OFF_MS = 60_000;
/** Each further silence in a row doubles the cool-off, up to this. */
export const MIRROR_MAX_COOL_OFF_MS = 10 * 60_000;

/**
 * The session breaker. After a mirror fails to answer, every download skips it for a
 * cool-off and goes straight to its own host; after that the mirror gets one more chance,
 * because a laptop that was asleep may be awake again. Every further silence in a row
 * doubles the cool-off (1, 2, 4, 8, then 10 minutes), so a phone away from the warehouse
 * pays for a handful of probes and then one per 10 minutes, not one per file, while a
 * mirror that missed once is back within a minute.
 *
 * Only SILENCE trips it. A mirror that answers — even "not here" for one file — is there,
 * and an answer resets the count: what a file it lacks costs is one LAN round trip.
 *
 * Keyed by the mirror's base URL: a mirror the device owner has moved is a different mirror
 * and is tried at once. Only the latest failure is kept, as only one mirror is set at a time.
 * A clock that runs BACKWARDS ends the cool-off rather than stretching it, so a wrong
 * wall clock can cost one extra probe but never lock a working mirror out.
 */
export function createMirrorBreaker(
  firstMs = MIRROR_COOL_OFF_MS,
  maxMs = MIRROR_MAX_COOL_OFF_MS,
  // Read through `Date` on every call (not a captured `Date.now`), so fake clocks apply.
  now: () => number = () => Date.now()
) {
  let failed: { mirror: string; at: number; coolOffMs: number } | null = null;
  const skipping = (mirror: string): boolean => {
    if (failed === null || failed.mirror !== mirror) return false;
    const elapsed = now() - failed.at;
    return elapsed >= 0 && elapsed < failed.coolOffMs;
  };
  return {
    /** Is `mirror` still cooling off after its last silence? */
    skipping,
    /** `mirror` did not answer: skip it for a while. Returns how long, in ms. */
    trip(mirror: string): number {
      // Downloads that probed side by side report the same silence: one miss, not several.
      if (failed !== null && skipping(mirror)) return failed.coolOffMs;
      const coolOffMs = failed?.mirror === mirror ? Math.min(maxMs, failed.coolOffMs * 2) : firstMs;
      failed = { mirror, at: now(), coolOffMs };
      return coolOffMs;
    },
    /** `mirror` answered, whatever it said: it is there, so its misses are forgotten. */
    answered(mirror: string): void {
      if (failed?.mirror === mirror) failed = null;
    },
  };
}
