/**
 * Hiraia Android APK — single source of truth for the landing-page download.
 *
 * One APK, one on-device model (Hiraia-2B — the CPT'd + full-parameter-SFT'd
 * Qwen3.5-2B, hiraia-sft-2b-v2), one device target: Android 12+ with
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
  /**
   * TRUE for the Sept 2026 v0.1 release: the CPT'd Qwen3.5-2B build, regression gate 45/45
   * green, signed with the pinned release cert. The UI additionally requires `apk.sha256` to
   * be non-empty before it renders a live link, so a deploy with an empty hash falls back to
   * 'coming soon' instead of linking an unverified file. Update url/fileSizeMB/sha256
   * together, always measured from the SIGNED APK.
   */
  released: true,

  version: '0.1',

  apk: {
    url: 'https://hiraia.org/models/hiraia.apk',
    /** Omit from the UI when 0 (file not measured yet). */
    fileSizeMB: 297,
    sha256: '3d4092ab00377526be0fb00e043c2a63758fbad0afaf0e2c1db2469d98219cc9',
  },

  /** SHA-256 of the signing cert. Stays the same across releases. */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  minAndroid: 12,
  /** Device-RAM floor. Matches ACTIVE_MODEL.minRamGB in packages/mobile/src/config/model.ts. */
  minRamGB: 6,
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
