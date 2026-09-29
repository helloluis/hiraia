import releases from './platform-releases.json';

export interface PlatformRelease {
  platform: string;
  versionCode: number;
  versionName: string;
  url: string;
  bytes: number;
  md5: string;
  sha256: string;
  signingCertSha256: string;
  abis: string[];
  runtime?: string;
  minSupportedVersionCode: number;
  publishedAt: string;
}

export interface DownloadPlatform {
  id: string;
  name: string;
  device: 'phone' | 'laptop' | 'desktop';
  status: 'available' | 'preview' | 'planned';
  eyebrow: string;
  description: string;
  requirements: string[];
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
    requirements: ['Chromebook with Android app support · ARM64 or Intel/AMD 64-bit', 'School administrator approval may be needed to install the APK'],
    installNote: 'This preview uses the Chromebook’s Android app environment. APK installation must be enabled by the device owner or school. ChromeOS Flex is not supported.',
    screenshot: { src: '/screens/download-chromeos.png', width: 1366, height: 768,
      alt: 'Hiraia’s wide layout showing three full science cards and part of the next card, with all reading controls at the top.',
      caption: 'Desktop Android emulator preview. Testing on school Chromebooks is still pending.' },
  },
  {
    id: 'windows', name: 'Windows', device: 'desktop', status: 'planned',
    eyebrow: 'Looking ahead',
    description: 'A Windows version is planned. We’ll add its download here when it’s ready.',
    requirements: [], installNote: '',
  },
];

export function validRelease(value: unknown): value is PlatformRelease {
  if (!value || typeof value !== 'object') return false;
  const r = value as PlatformRelease;
  return Number.isSafeInteger(r.versionCode) && r.versionCode > 0 &&
    Number.isSafeInteger(r.bytes) && r.bytes > 0 && typeof r.url === 'string' &&
    /^https:\/\/assets\.hiraia\.org\/models\/[a-zA-Z0-9._-]+\.(apk|exe|msix)$/.test(r.url) &&
    /^[a-f0-9]{64}$/i.test(r.sha256) && /^[a-f0-9]{32}$/i.test(r.md5) &&
    /^[a-f0-9]{64}$/i.test(r.signingCertSha256) && typeof r.versionName === 'string';
}

export function platformRelease(platform: string, catalog: Record<string, unknown> = releases.platforms): PlatformRelease | null {
  const candidate = Object.hasOwn(catalog, platform) ? catalog[platform] : null;
  return validRelease(candidate) && candidate.platform === platform ? candidate : null;
}
