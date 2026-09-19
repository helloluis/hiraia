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
 * Workflow: build → scripts/sign-apk.sh → deploy/publish-release-assets.py (uploads the
 * signed APK to Cloudflare R2, the origin behind https://assets.hiraia.org — the VPS only
 * keeps 307 redirects for the legacy hiraia.org/models/* URLs — as an IMMUTABLE versioned
 * key plus the hiraia.apk alias, read-back-verified, and prints the block below) → paste →
 * push main → deploy/update.sh. Point `apk.url` at the VERSIONED key the publisher prints:
 * the alias sits behind a 4 h edge cache and could hand a phone the previous build.
 *
 * IN-APP UPDATES read this file too. `/api/app/manifest` (src/app/api/app/manifest/route.ts)
 * serves it as JSON and the installed app polls that on launch to decide whether to show
 * its "Update available!" bar, so THREE more fields are load-bearing at publish time:
 *   • `versionCode` — MUST equal the built APK's android.versionCode
 *     (packages/mobile/app.json `expo.android.versionCode`; the app compares this number
 *     with its own and only offers a STRICTLY HIGHER one). Bump app.json, build, then copy
 *     the same number here. A stale versionCode here = installed phones never see the update.
 *   • `apk.bytes` + `apk.md5` — the app downloads the APK through the same resume + integrity
 *     gate as the model files (engine/modelDownload.ts), which needs the EXACT byte count and
 *     the MD5 (sha256 stays for the human-checkable landing page).
 * All of them are printed by packages/mobile/scripts/sign-apk.sh as a ready-to-paste block —
 * always measured from the SIGNED APK that actually goes to the mirror.
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

  version: '0.4.14',

  /** Android's monotonic update number, embedded in the signed APK. */
  versionCode: 14,

  /** The oldest build which may dismiss the update prompt. */
  minSupportedVersionCode: 1,

  /** Date that the immutable APK URL was published. */
  publishedAt: '2026-09-16',

  apk: {
    url: 'https://assets.hiraia.org/models/hiraia-v0p4p14.apk',
    /** Omit from the UI when 0 (file not measured yet). */
    fileSizeMB: 413,
    /** Exact signed APK size, required by the in-app downloader. */
    bytes: 433302846,
    sha256: 'b0ba8b17cc64af36dff50feb091de6ab475f25166067f8f0d463c53b45651724',
    /** MD5 of the same signed APK, required by the in-app downloader. */
    md5: '71b12038780af061800cdc85e7eb22d2',
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
