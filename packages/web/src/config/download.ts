/**
 * Hiraia Android APK release info — single source of truth for the landing-page
 * downloads. We ship TWO tier-specific APKs (a single auto-detect APK is the
 * eventual goal but not yet device-verified — see hiraia-kitten-cat-tiers memory):
 *
 *   - hiraia-cat.apk   (3B model on GPU/Vulkan) for newer / mid-range phones.
 *   - hiraia-kitten.apk (1B model on CPU armv8.0) for older / entry-level phones,
 *     including budget Adreno-6xx GPUs that can't run the larger model.
 *
 * Hiraia is distributed OUTSIDE the Play Store, so legitimacy rests on two
 * published, user-checkable values per APK:
 *   1. `sha256` — SHA-256 of the APK *file* (changes with every release).
 *   2. `signingCertSha256` — SHA-256 of the signing cert. Android enforces this on
 *      install/update (rejecting a different key), so it's the stable trust anchor
 *      and doesn't change between releases. Same cert for BOTH tiers.
 *
 * Workflow: build each tier's APK on the training pod, push it to the mirror
 * (same nginx as the model files — `Accept-Ranges: bytes` so spotty connections
 * can resume), update sha256 + fileSizeMB below, deploy.
 */

interface TierDownload {
  /** Direct .apk URL on our own mirror. */
  url: string;
  /** APK file size in MB (rounded). */
  fileSizeMB: number;
  /** SHA-256 of the .apk file. Recompute after every build. */
  sha256: string;
  /** Approx one-time AI-model download on first launch (UI string). */
  modelDownloadRange: string;
}

export const DOWNLOAD = {
  /** Flip to true only once both tier URLs + sha256s are real. */
  released: true,

  version: '0.2.0',

  /**
   * PRIMARY TIER. Sailor2-3B + the v9+ Filipino adapter; uses the GPU/Vulkan path,
   * so it needs a phone with a modern Adreno (~Adreno 7xx/8xx) or equivalent.
   */
  cat: {
    url: 'https://hiraia.b11.dev/models/hiraia-cat.apk',
    fileSizeMB: 666,
    sha256: '0f19b5126a0fecb1cb3ba47914bad3493583d9fe8ce833c2e265b38ffc55a190',
    modelDownloadRange: '~3.6 GB',
  } as TierDownload,

  /**
   * ACCESSIBLE TIER. Sailor2-1B + the kitten-v3 Filipino adapter; CPU-only on armv8.0,
   * no GPU required — for budget devices the larger model can't load. Shipping the
   * current adapter for the hackathon submission; the 1B has a known reflex bias on
   * specific yes/no safety questions ("Hindi po, mabuti pa nga ang manigarilyo") that
   * a future device-side guardrail will catch — out of scope for the v0.2.0 build.
   */
  kitten: {
    url: 'https://hiraia.b11.dev/models/hiraia-kitten.apk',
    fileSizeMB: 547,
    sha256: 'e7097e9a813b3ff770cd7077c3363468810fb87a9dcc874222ff810819c347c2',
    modelDownloadRange: '~1.3 GB',
  } as TierDownload,

  /** SHA-256 of the signing cert. Same for both tier APKs (same key signs both). */
  signingCertSha256: '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35',

  minAndroid: 12,
} as const;
