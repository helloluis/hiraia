import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DownloadScreen, type ApkManifest } from '@/features/landing/DownloadScreen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Download the Android app · Tala' };

/** Reads `${TALA_DOWNLOAD_DIR}/tala-apk.json` at request time; the APK itself is served by nginx, not Next. */
async function readManifest(): Promise<ApkManifest | null> {
  const dir = process.env.TALA_DOWNLOAD_DIR;
  if (!dir) return null;
  try {
    const raw = await fs.readFile(path.join(dir, 'tala-apk.json'), 'utf8');
    const m = JSON.parse(raw) as Partial<ApkManifest>;
    if (
      typeof m.file !== 'string' ||
      typeof m.version !== 'string' ||
      typeof m.sha256 !== 'string' ||
      typeof m.bytes !== 'number'
    )
      return null;
    return {
      file: m.file,
      version: m.version,
      versionCode: typeof m.versionCode === 'number' ? m.versionCode : 0,
      buildDate: typeof m.buildDate === 'string' ? m.buildDate : '',
      sha256: m.sha256,
      bytes: m.bytes,
      minAndroid: typeof m.minAndroid === 'string' ? m.minAndroid : '',
      applicationId: typeof m.applicationId === 'string' ? m.applicationId : '',
    };
  } catch {
    return null;
  }
}

export default async function Page() {
  const manifest = await readManifest();
  return <DownloadScreen manifest={manifest} />;
}
