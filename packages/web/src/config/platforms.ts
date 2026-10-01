import releases from './platform-releases.json';
import windowsRelease from './windows-release.json';

interface ReleaseFile {
  versionCode: number;
  versionName: string;
  url: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
}

interface ApkRelease extends ReleaseFile {
  platform: 'android' | 'chromeos';
  md5: string;
  signingCertSha256: string;
  abis: string[];
  runtime?: string;
  minSupportedVersionCode: number;
}

interface WindowsRelease extends ReleaseFile {
  platform: 'windows';
  format: 'zip';
  arch: 'x64';
  signed: false;
}

export type PlatformRelease = ApkRelease | WindowsRelease;

// APK publication replaces platform-releases.json. Keep the separately published
// Windows preview intact when the Android/ChromeOS pair is updated.
const releaseCatalog = {...releases.platforms, windows: windowsRelease};

export interface DownloadPlatform {
  id: string;
  name: string;
  device: 'phone' | 'laptop' | 'desktop';
  status: 'available' | 'preview' | 'planned';
  eyebrow: string;
  description: string;
  requirements: string[];
  downloadNote?: string;
  installNote: string;
  screenshot?: { src: string; width: number; height: number; alt: string; caption: string };
}

/** Presentation is independent of release bytes. Another platform needs one entry here. */
export const DOWNLOAD_PLATFORMS: DownloadPlatform[] = [
  {
    id: 'android', name: 'Android', device: 'phone', status: 'available',
    eyebrow: 'For phones & tablets',
    description: 'A little science, wherever you are. Swipe through illustrated cards, listen along, and put what you learn to the test.',
    requirements: ['Android 10 or newer · 64-bit ARM', '4 GB+ memory recommended for the optional AI tutor'],
    installNote: 'Download the APK, open it, and allow installation from your browser when Android asks. Updating an existing install keeps your progress.',
    screenshot: { src: '/screens/download-android.png', width: 720, height: 1600,
      alt: 'Hiraia on Android showing an illustrated science card in its vertical card feed.',
      caption: 'One card at a time. Read, listen, and explore.' },
  },
  {
    id: 'chromeos', name: 'ChromeOS', device: 'laptop', status: 'preview',
    eyebrow: 'For Chromebooks',
    description: 'More room for curiosity. Browse cards side by side with a keyboard, trackpad, mouse, or touch screen.',
    requirements: ['Chromebook with Android 10+ app support · ARM64 or Intel/AMD 64-bit', 'School administrator approval may be needed to install the APK'],
    installNote: 'This preview uses the Chromebook’s Android app environment. APK installation must be enabled by the device owner or school. ChromeOS Flex is not supported.',
    screenshot: { src: '/screens/download-chromeos.png', width: 1366, height: 768,
      alt: 'Hiraia’s wide layout showing three full science cards and part of the next card, with all reading controls at the top.',
      caption: 'Desktop Android emulator preview. Testing on school Chromebooks is still pending.' },
  },
  {
    id: 'windows', name: 'Windows', device: 'desktop', status: 'preview',
    eyebrow: 'For PCs & laptops',
    description: 'Science on a bigger screen. Explore cards side by side, take the 12-question exam, and listen offline in English or Tagalog.',
    requirements: ['Windows 10 or 11 · Intel/AMD 64-bit (x64)',
      'No dedicated graphics card needed for the optional AI tutor',
      'Tala classroom sync is not available in this preview'],
    downloadNote: 'Extract the ZIP, then open Hiraia.exe. This preview is unsigned, so Windows may show a SmartScreen warning.',
    installNote: 'Extract the whole ZIP to a folder before opening Hiraia.exe. To update, download and extract the newer version. Your profiles, progress, and downloaded content are stored separately and stay on your computer. Windows ARM is not supported.',
    screenshot: { src: '/screens/download-windows-exam.png', width: 1008, height: 689,
      alt: 'Hiraia’s 12-question exam running on Windows, showing the question counter, progress bar, and three answer choices.',
      caption: 'The 12-question exam, available in every edition. Captured from the Windows preview; Windows 10 device testing is still pending.' },
  },
];

export function validRelease(value: unknown): value is PlatformRelease {
  if (!value || typeof value !== 'object') return false;
  const r = value as PlatformRelease;
  const measuredFile = Number.isSafeInteger(r.versionCode) && r.versionCode > 0 &&
    Number.isSafeInteger(r.bytes) && r.bytes > 0 && typeof r.url === 'string' &&
    /^[a-f0-9]{64}$/i.test(r.sha256) && typeof r.versionName === 'string' && r.versionName.length > 0 &&
    typeof r.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.publishedAt);
  if (!measuredFile) return false;
  if (r.platform === 'windows') {
    return r.format === 'zip' && r.arch === 'x64' && r.signed === false &&
      /^https:\/\/assets\.hiraia\.org\/models\/[a-zA-Z0-9._-]+\.zip$/.test(r.url);
  }
  return (r.platform === 'android' || r.platform === 'chromeos') &&
    /^https:\/\/assets\.hiraia\.org\/models\/[a-zA-Z0-9._-]+\.apk$/.test(r.url) &&
    /^[a-f0-9]{32}$/i.test(r.md5) && /^[a-f0-9]{64}$/i.test(r.signingCertSha256);
}

export function platformRelease(platform: string, catalog: Record<string, unknown> = releaseCatalog): PlatformRelease | null {
  const candidate = Object.hasOwn(catalog, platform) ? catalog[platform] : null;
  return validRelease(candidate) && candidate.platform === platform ? candidate : null;
}
