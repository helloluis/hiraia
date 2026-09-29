import { NextResponse } from 'next/server';
import { platformRelease } from '@/config/platforms';
import assets from '@/config/asset-updates.json';
import tala from '@/config/tala-download.json';

/**
 * Installed apps poll this no-store endpoint for measured release metadata.
 * Hiraia's APK is selected from platform-releases.json (shared with the download page).
 * The optional assets catalog offers compatible model weights and sparse image packs.
 * Tala uses ?app=tala and its own signed-APK release metadata.
 * Keep schema-1 fields stable: older APKs ignore the additional assets field.
 * Empty channels use app:null / empty arrays, never unmeasured placeholder artifacts.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('app') === 'tala') {
    return NextResponse.json(
      {schema: 1, applicationId: 'com.hiraia.tala', app: tala.app},
      {headers: {'Cache-Control': 'no-store'}},
    );
  }
  const platform = new URL(request.url).searchParams.get('platform') || 'android';
  if (!['android', 'chromeos'].includes(platform)) {
    return NextResponse.json({schema: 1, platform, app: null},
      {status: 400, headers: {'Cache-Control': 'no-store'}});
  }
  return NextResponse.json(
    { schema: 1, platform, app: platformRelease(platform), content: null, models: null, assets },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
