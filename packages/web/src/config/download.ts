/**
 * Hiraia Android APK — single source of truth for the landing-page download.
 *
 * One APK, one 2B on-device model. Distributed outside the Play Store, so
 * legitimacy rests on two published, user-checkable values:
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
} as const;
