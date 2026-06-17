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

  /**
   * Direct link to the .apk — served from our OWN mirror (same nginx as the model files), NOT the
   * GitHub release. GitHub redirects to a SIGNED CDN URL that EXPIRES (~1h) and finalizes poorly on
   * mobile (downloads stalled at 100%). The mirror is a plain static file with `Accept-Ranges: bytes`,
   * so a spotty-connection download can RESUME instead of restarting (verified). Same bytes as the
   * GitHub release → the sha256/cert checksums below still match. (Re-mirror on each new APK release.)
   */
  url: 'https://hiraia.b11.dev/models/hiraia.apk',

  /** APK file size in MB. The app + offline knowledge bank + illustrations only — the AI model
   * and the right Filipino adapter download on first run, picked from the device + chosen language. */
  fileSizeMB: 310,

  /** SHA-256 of the .apk file. macOS: `shasum -a 256 hiraia.apk` · Linux: `sha256sum` */
  sha256: '708ea60542f8124668189ba9123594eb9764e918d992be23a035e4e8c3e07f48',

  /** SHA-256 of the signing cert. `apksigner verify --print-certs hiraia.apk` (or `eas credentials`). */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  /**
   * One-time model download after install, served from Hiraia's OWN servers (a verifiable
   * mirror of the public Sailor2 base — inference stays 100% on-device). The exact bytes depend
   * on the phone + chosen language: a capable phone gets the 3B (base ~3.2 GB + embedder ~0.4 GB
   * ≈ 3.6 GB); an entry-level phone gets the 1B (~1.3 GB total). See packages/mobile/src/config/
   * model.ts (ACTIVE_MODEL + the kitten/cat tiers). `modelDownloadRange` is what the UI shows.
   */
  modelDownloadRange: '1.5–4 GB',
  modelDownloadGB: 3.2, // 3B base only, for reference (full 3B path ≈ 3.6 GB with the embedder)

  minAndroid: 12,
  minRamGB: 6,
} as const;
