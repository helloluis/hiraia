/**
 * Hiraia Android APK release info — single source of truth for the landing-page
 * download.
 *
 * Hiraia is distributed OUTSIDE the Play Store, so legitimacy rests on two
 * published, user-checkable values:
 *
 *   1. `sha256` — SHA-256 of the APK *file*. Lets a user confirm they downloaded
 *      the exact bytes we published (integrity vs. a corrupted / MITM'd / mirror
 *      copy). Changes with every release.
 *
 *   2. `signingCertSha256` — SHA-256 of the APK *signing certificate*. Proves the
 *      app was built and signed by Hiraia's key. Android itself enforces this on
 *      install and on EVERY update (an update signed by a different key is
 *      rejected), so it's the stable, long-term anchor of trust — it does not
 *      change between releases.
 *
 * Workflow: keep `released: false` until a real APK is published (the UI then
 * shows "coming soon"). After an EAS build, host the .apk, fill every field
 * below, and flip `released: true`. The exact commands to compute each value are
 * in packages/mobile/BUILD.md.
 */
export const DOWNLOAD = {
  /** Flip to true only once `url` + `sha256` (+ ideally `signingCertSha256`) are real. */
  released: true,

  version: '0.1.0',

  /** Direct link to the .apk — the public GitHub Release asset (stable URL). */
  url: 'https://github.com/helloluis/hiraia/releases/download/v0.1.0/hiraia.apk',

  /** APK file size in MB. Includes the bundled Filipino fine-tune; the 3.2 GB base model streams on first run. */
  fileSizeMB: 310,

  /** SHA-256 of the .apk file. macOS: `shasum -a 256 hiraia.apk` · Linux: `sha256sum` */
  sha256: '708ea60542f8124668189ba9123594eb9764e918d992be23a035e4e8c3e07f48',

  /** SHA-256 of the signing cert. `apksigner verify --print-certs hiraia.apk` (or `eas credentials`). */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  /**
   * One-time model download after install. The APK is small; on first launch the
   * app fetches the AI model once, then runs fully offline. Mirror these to the
   * mobile `ACTIVE_MODEL` in packages/mobile/src/config/model.ts (3B ≈ 3.2 GB
   * from Hugging Face; 1B ≈ 0.74 GB).
   */
  modelDownloadGB: 3.2,
  modelSource: 'Hugging Face',
  modelSourceUrl: 'https://huggingface.co/mradermacher/Sailor2-3B-Chat-GGUF',

  minAndroid: 12,
  minRamGB: 6,
} as const;
