import { NextResponse } from 'next/server';
import { DOWNLOAD } from '@/config/download';
import assets from '@/config/asset-updates.json';
import tala from '@/config/tala-download.json';

/**
 * Installed apps poll this no-store endpoint for measured release metadata.
 * Hiraia's APK remains derived from download.ts (shared with the landing page).
 * The optional assets catalog offers compatible model weights and sparse image packs.
 * Tala uses ?app=tala and its own signed-APK release metadata.
 * Keep schema-1 fields stable: older APKs ignore the additional assets field.
 * Empty channels use app:null / empty arrays, never unmeasured placeholder artifacts.
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

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('app') === 'tala') {
    return NextResponse.json(
      {schema: 1, applicationId: 'com.hiraia.tala', app: tala.app},
      {headers: {'Cache-Control': 'no-store'}},
    );
  }
  return NextResponse.json(
    { schema: 1, app: currentApp(), content: null, models: null, assets },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
