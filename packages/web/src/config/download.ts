/** Compatibility facade for shared requirements and the legacy Android download.
 * Release bytes now live in platform-releases.json, shared by the website and updater. */
import releases from './platform-releases.json';
const android = releases.platforms.android;
export const DOWNLOAD = {
  released: true,
  version: android.versionName,
  versionCode: android.versionCode,
  minSupportedVersionCode: android.minSupportedVersionCode,
  publishedAt: android.publishedAt,
  apk: { url: android.url, fileSizeMB: Math.ceil(android.bytes / 1048576),
    bytes: android.bytes, sha256: android.sha256, md5: android.md5 },
  signingCertSha256: android.signingCertSha256,
  minAndroid: 10,
  minRamGB: 4,
  modelDownloadGB: 1.7,
} as const;
