/**
 * Hiraia Android APK — single source of truth for the landing-page download.
 *
 * One APK, one on-device model (Sailor2-3B), one device target: Android 12+ with
 * 6 GB+ RAM. There is no lighter build — the 1B/4 GB "kitten" tier is retired, so the
 * requirement below is a REQUIREMENT, not a recommendation.
 *
 * Distributed outside the Play Store, so legitimacy rests on two published,
 * user-checkable values:
 *   1. `sha256` — SHA-256 of the APK file (changes with every release).
 *   2. `signingCertSha256` — SHA-256 of the signing cert. Android enforces this
 *      on install/update; it is the stable trust anchor across releases.
 *
 * Workflow: build the APK, push it to the mirror (same nginx as the model files —
 * `Accept-Ranges: bytes` so spotty connections can resume), update sha256 +
 * fileSizeMB below, deploy.
 */

export const DOWNLOAD = {
  /** Flip to true once the APK URL + sha256 are real. */
  released: true,

  version: '0.1',

  apk: {
    url: 'https://hiraia.org/models/hiraia.apk',
    /** Omit from the UI when 0 (file not measured yet). */
    fileSizeMB: 0,
    sha256: '',
  },

  /** SHA-256 of the signing cert. Stays the same across releases. */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  minAndroid: 12,
  /** Device-RAM floor. Matches ACTIVE_MODEL.minRamGB in packages/mobile/src/config/model.ts. */
  minRamGB: 6,
  /**
   * First-run download, in GB: the base model plus the semantic embedder. Both are
   * fetched from the mirror on first launch (nothing else is — adapters and art are in
   * the APK). Keep in step with packages/mobile/src/config/model.ts:
   * ACTIVE_MODEL.sizeGB (3.23, Sailor2-3B Q4_K_M) + EMBEDDER labse.Q4_K_M.gguf (~0.38).
   * A user on a capped mobile plan budgets against this number, so round UP, never down.
   */
  modelDownloadGB: 3.6,
} as const;
