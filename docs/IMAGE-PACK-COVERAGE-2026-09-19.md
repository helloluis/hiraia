# Image-pack coverage repair — 2026-09-19

The published image-pack manifest had fallen behind the current bundled-art selection
and card/curriculum assignments. It omitted 6,471 images from the complete corpus
(including 5,384 distinct images needed by graded cards) and redundantly downloaded
1,043 images already inside the APK. Some remaining images were placed in one grade's
pack even though cards used them in other grades. The old coverage test skipped images
absent from every pack, so its first failure understated the problem.

The repair regenerates packs from the existing canonical PNGs. No LLM calls, new art,
card rewrites or curriculum changes are involved. Authored grade suffixes, primary
curriculum grades and additional curriculum cells all contribute to an image's grade
set. Shared images go in common packs; single-grade images stay with that grade.

## Result

- 12,373 images remain bundled in the APK, unchanged.
- 23,272 images are delivered through 42 packs (412,157,235 bytes across all packs).
- Together these cover the complete 35,645-image corpus, without duplication.
- Grade 3–10 selections have zero missing required images. Text-only cards with an
  empty illustration slug are intentionally excluded from illustration requirements.
- New manifest version: `c8379ff0126aa457`. Old manifest and pack objects remain
  available for installed versions. Existing installations continue using their old
  manifest until upgraded; new packs use content-addressed filenames and may require
  a new download rather than reusing older installed pack directories.

| Grade | Previously missing required images | Missing now | Previous download | Corrected download |
|---|---:|---:|---:|---:|
| 3 | 610 | 0 | 233.3 MB | 252.4 MB |
| 4 | 712 | 0 | 234.6 MB | 259.4 MB |
| 5 | 1,051 | 0 | 239.1 MB | 272.5 MB |
| 6 | 1,219 | 0 | 241.5 MB | 283.0 MB |
| 7 | 1,279 | 0 | 236.6 MB | 272.8 MB |
| 8 | 953 | 0 | 232.1 MB | 266.0 MB |
| 9 | 714 | 0 | 231.4 MB | 255.9 MB |
| 10 | 496 | 0 | 228.7 MB | 250.4 MB |

Counts are distinct illustrations within each grade; the same illustration can occur
in multiple rows, so do not sum those rows to obtain a unique corpus count.
Download sizes are decimal MB and exclude artwork already in the APK.

## Reproduce and keep it fixed

From the repository root:

```sh
# Inspect current delivery; nonzero exit for any integrity or coverage defect.
python3 packages/mobile/scripts/audit-image-packs.py --check \
  --report packages/mobile/build/image-coverage/current.json

# Rebuild after a change to cards, grade tags, bundled art or canonical shards.
python3 packages/mobile/scripts/package-art.py
pnpm --filter @hiraia/mobile qa:images
```

The audit checks every pack's complete SHA-256 and MD5, image payload hashes, source
inventory identity, duplicate/missing corpus images, and each grade's full selection.
It accepts an alternate `--manifest` and `--packs-dir` for comparing releases.
It performs no network or model calls. The packer audits its candidate before changing
app references; the APK wrapper repeats the gate. Publishing also audits first and
requires local/app manifests to match. Existing pack keys are never overwritten;
the publisher verifies their complete contents or creates a new immutable key.

Regression coverage includes cross-grade sharing, additional curriculum grades,
images absent from all packs, corrupt data, and grade-10 versus multi-grade suffixes.
The TypeScript coverage test now checks missing images instead of skipping them, and
checks the full source inventory rather than a hard-coded old image count.

## Publication and validation

All 42 packs were uploaded to the existing `hiraia-assets` R2 bucket under
`models/images/` and read back with matching complete SHA-256 checksums. The versioned
manifest is `https://assets.hiraia.org/models/images/manifest-c8379ff0126aa457.json`.
No existing APK URL, app version or public download manifest was changed.

- All 134 mobile tests passed.
- Four independent Python audit regression tests passed.
- Mobile TypeScript check passed.
- All 42 public CDN downloads matched their complete SHA-256 and byte counts.
  The public versioned manifest matches the local manifest exactly; HTTP Range
  delivery returned 206 with the expected HIRAIMG1 prefix.
- Validation APK build passed in **51 seconds**; Metro bundled in **9.175 seconds**.
  All 12,373 bundled images passed exact inventory/hash verification. This is a
  debug-signed local release-variant artifact, not a distributed production update.

Detailed before/after reports and CDN receipts are in
`packages/mobile/build/image-coverage/` (local build outputs).

Validation APK SHA-256: `b967b38b2a1753ad1088b34fb34b2a99271923f9bb5b2fd6d47c40204386a02b`
