import { NextResponse } from 'next/server';
import { DOWNLOAD } from '@/config/download';

/**
 * The in-app update manifest — what an INSTALLED phone polls to learn whether a newer APK
 * is on the mirror (packages/mobile/src/store/updateStore.ts is the only consumer).
 *
 * Derived entirely from src/config/download.ts, the same single source of truth the
 * landing page renders, so the website and the phones can never disagree about what the
 * current release is. Nothing here is hand-maintained: publish = edit download.ts, deploy.
 *
 * Shape (schema 1):
 *   {
 *     schema: 1,
 *     app: {                       // the APK — null when there is nothing publishable
 *       versionCode, versionName, url, bytes, sha256, md5,
 *       minSupportedVersionCode, publishedAt
 *     } | null,
 *     content: null,               // reserved: fact-bank / card packs (a later phase)
 *     models: null                 // reserved: model + adapter revisions (a later phase)
 *   }
 * The two reserved keys exist so the phone-side parser can already tolerate them; they will
 * gain shape when those phases land. Add keys, never rename or retype existing ones — an
 * installed app may be many releases behind the website.
 *
 * `app` is null (rather than a half-filled object) unless the release is fully pinned:
 * released, a positive versionCode, an exact byte count and BOTH digests. The phone-side
 * downloader hard-gates on bytes + md5, so offering an APK without them would only ever
 * produce a failed download on a child's metered data. Same rule as the landing page,
 * which links nothing without a sha256.
 *
 * `Cache-Control: no-store` — a phone that checks once a launch must see the deploy, not a
 * CDN's memory of the previous one.
 */

export const dynamic = 'force-dynamic';

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function currentApp() {
  const { apk } = DOWNLOAD;
  const md5 = apk.md5.toLowerCase();
  const sha256 = apk.sha256.toLowerCase();
  const publishable =
    DOWNLOAD.released &&
    Number.isInteger(DOWNLOAD.versionCode) &&
    DOWNLOAD.versionCode > 0 &&
    Number.isInteger(apk.bytes) &&
    apk.bytes > 0 &&
    HEX_32.test(md5) &&
    HEX_64.test(sha256);
  if (!publishable) return null;
  return {
    versionCode: DOWNLOAD.versionCode,
    versionName: DOWNLOAD.version,
    url: apk.url,
    bytes: apk.bytes,
    sha256,
    md5,
    minSupportedVersionCode: DOWNLOAD.minSupportedVersionCode,
    publishedAt: DOWNLOAD.publishedAt,
  };
}

export async function GET() {
  return NextResponse.json(
    { schema: 1, app: currentApp(), content: null, models: null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
