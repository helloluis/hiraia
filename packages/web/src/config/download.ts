/**
 * Hiraia Android APK — single source of truth for the landing-page download.
 *
 * One APK, one on-device model (Hiraia-2B — the CPT'd + full-parameter-SFT'd
 * Qwen3.5-2B, hiraia-sft-2b-v2), one OS target: Android 10+. The built-in card
 * library works without loading that model; 6 GB+ RAM is recommended for local
 * model-generated cards.
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
  /**
   * TRUE for the Sept 2026 v0.1 release: the CPT'd Qwen3.5-2B build, regression gate 45/45
   * green, signed with the pinned release cert. The UI additionally requires `apk.sha256` to
   * be non-empty before it renders a live link, so a deploy with an empty hash falls back to
   * 'coming soon' instead of linking an unverified file. Update url/fileSizeMB/sha256
   * together, always measured from the SIGNED APK.
   */
  released: true,

  version: '0.4.12',

  /** Android's monotonic update number, embedded in the signed APK. */
  versionCode: 12,

  /** The oldest build which may dismiss the update prompt. */
  minSupportedVersionCode: 1,

  /** Date that the immutable APK URL was published. */
  publishedAt: '2026-09-16',

  apk: {
    url: 'https://assets.hiraia.org/models/hiraia-v0p4p12.apk',
    /** Omit from the UI when 0 (file not measured yet). */
    fileSizeMB: 416,
    /** Exact signed APK size, required by the in-app downloader. */
    bytes: 435812289,
    sha256: '29aa45252625e0470f16a0d4c02fc6815063ae63322f49bf75520e6b7417bfa2',
    /** MD5 of the same signed APK, required by the in-app downloader. */
    md5: 'd559eb4d64aa186899f162171b9b7845',
  },

  /** SHA-256 of the signing cert. Stays the same across releases. */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  minAndroid: 10,
  /** Local-model RAM recommendation. Matches ACTIVE_MODEL.minRamGB in the mobile app. */
  minRamGB: 4,
  /**
   * First-run download, in GB: the base model plus the semantic embedder. Both are
   * fetched from the mirror on first launch (nothing else is — art is in the APK, and
   * the full-parameter Hiraia-2B has no adapters). Keep in step with
   * packages/mobile/src/config/model.ts:
   * ACTIVE_MODEL.sizeGB (1.27, hiraia-sft-2b-v2 Q4_K_M) + EMBEDDER labse.Q4_K_M.gguf
   * (~0.38). A user on a capped mobile plan budgets against this number, so round UP,
   * never down.
   */
  modelDownloadGB: 1.7,
} as const;
