# Hiraia licensing review — 28 September 2026

**Terms finalized and scoped content grant recorded on 28 September 2026.**
Luis Buenaventura confirmed sole personal ownership of Hiraia's original work, with no
other human contributors. Existing licenses remain intact. The root notice and contribution
guide now explain the scope; no release or website deployment was performed.

- [Inventory and findings](INVENTORY-2026-09-28.md)
- [Final licensing terms](TERMS.md)
- [Effective coverage manifest](coverage.json) — three exact educational-bank snapshots;
  only Luis's own original-expression and selection/arrangement rights, where they exist
- [Ownership confirmation](OWNERSHIP.md)
- [Machine-readable snapshot](inventory/snapshot.json)

The [earlier draft terms](TERMS-DRAFT.md) and [empty draft manifest](coverage-draft.json) are
retained as historical working documents. They are superseded by the final files above.

The objective is free noncommercial reuse of eligible Hiraia material, with commercial
permissions decided explicitly by its rights holder. That objective cannot be imposed
retroactively on Apache, MIT, CC BY, or CC0 material already released under those terms.
Hiraia also cannot sell permission to bypass somebody else's noncommercial restrictions.

## Scope and remaining provenance work

1. The licensor and commercial signing authority is **Luis Buenaventura**, personally.
   His explicit ownership answer is recorded; this conclusion does not rely on git authorship.
2. CC BY-NC 4.0 covers only his rights in the manifest's three hash-identified content banks.
   Underlying third-party sources, unprotected material, and existing alternative grants are
   excluded from the new restriction. Full record-by-record third-party clearance is not claimed.
3. The contribution guide preserves the historical Apache statement and current Apache
   code policy, while requiring explicit scope and permission for other future contributions.
4. The software-specific terms are final text for future explicit designation. No current
   code has been designated or relabeled. They are custom terms, not a standard open-source
   license; their existence is not a representation of lawyer review.
5. Extend coverage explicitly for eligible future artifacts. Preserve earlier grants and
   ship the appropriate third-party notices; this directory does not establish full release
   compliance. Models, photographs, image packs, and raw training corpora remain separately scoped.

The effective content grant is not an assertion that all repository material has been
cleared. Sole ownership of original work does not resolve third-party permissions or turn
prior permissive grants into noncommercial grants.

## Inventory method and limits

Reviewed working checkout `hiraia-unified` at `abc926e37ddd2c3aa0f1c823e4ecee16d56f7f2c`.
Parallel mobile edits were present and preserved; the snapshot records their paths.

- `pnpm licenses list --json`: installed dependency metadata, with local paths made relative.
- Enumerated tracked image JSON records with top-level license fields, tracked font files,
  and existing license texts. Stored hashes for evidence, fonts, and image metadata.
- Counted the full card pool, quiz bank, and fact bank; recorded their hashes and top-level
  field coverage. These are source-bank counts, not counts of cards shipped in an APK.
- Verified all ten quiz audio output hashes against their existing source manifest.
- Inspected model declarations, voice imports, training provenance notes, native dependency
  declarations, and existing repository license statements.
- Checked current official model cards, license texts, Philippine IP Code, and Google Fonts
  notices. Current upstream pages do not prove the exact historical version's terms.

Not performed: a complete historical file-by-file rights adjudication; remote RunPod corpus
inspection; APK/native binary dependency extraction; Python environment inventory; full
generated-image/provider-contract mapping; or photographer/contributor permissions checks.
No new model calls, generation, builds, deployments, commits, or paid work were performed.
The hashes under `inventory/` preserve the pre-policy review snapshot; the root README,
contribution guide, and TTS licensing explanation were subsequently updated as documented here.

`inventory/pnpm-licenses.json` includes development and platform-specific packages and groups
some versions by name. It is **not** an APK or production-only SBOM. The snapshot contains
1,196 name entries / 1,341 name-version entries, not 1,196 independently cleared components.
