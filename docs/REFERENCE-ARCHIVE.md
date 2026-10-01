# Hiraia reference and original-image archive

Updated **1 October 2026**, Asia/Manila. The selected archive is **Cloudflare R2 Standard**, private bucket **`hiraia-archive`**. Public R2 access is disabled and no custom domain is attached. The [verification record](REFERENCE-ARCHIVE-20261001.json) pins snapshot IDs, manifest/receipt hashes and completion states. It is the authority for what has actually been uploaded and restored.

**All six snapshots are complete.** Every uploaded object passed remote SHA-256 read-back, and all 54,874 selected file paths passed independent full restores into fresh directories using read-only credentials, with zero errors. The remote listing matches all 54,753 expected objects and 78,099,471,224 stored bytes, including manifests, receipts and the retention probe, with no missing or unexpected objects. Counts include repeated source paths; exact content deduplicates to 54,740 objects. No B2 bucket or maintenance schedule has been created.

## What is preserved

| Scope | Frozen inventory | Meaning |
| --- | ---: | --- |
| Original-image collection, including history supplement | 47,935 distinct image byte variants; 56,528,893,161 bytes | Available original-resolution outputs and explicitly identified best local masters, including historical variants. This is not a count of unique illustrations or proof that every past generation survives. |
| Core image snapshot | 49,275 file paths; 56,635,374,584 unique object bytes | The core 47,893 image variants plus prompts, generation metadata, source-path mappings, provider records and recovery evidence. Every duplicate path retains its provenance; the 42 later historical recoveries have their own snapshot. |
| Country-reference snapshot | 5,230 file paths; 21,307,743,278 unique object bytes | Philippine and Peruvian materials, curriculum sources, acquisition evidence, text extraction, catalogues and scratch research evidence. |
| Manual rescue snapshot | 27 images plus provenance; 32,462,395 bytes | An initial independently restored check, also included in the core image snapshot; not an additional 32 MB of unique storage. |
| Auxiliary image snapshot | 90 file paths; 90,339,506 unique object bytes | Generation reference inputs, available website artwork and explicitly labeled low-resolution survival copies; independently restored. |
| Historical image supplement | 42 additional 1024×1024 image variants plus provenance; 47 files, 25,735,298 bytes | Exact historical Git bytes; independently restored. These are superseded artwork, not recovered copies of the missing manual imports. |
| Expanded `~/Code` search supplement | 204 files; 18,086,613 bytes | 128 auxiliary artwork assets, compact provider records, recovery evidence and a pinned copy of the archive tooling. Adds no original-resolution science variants. |

See the [core image inventory](original-image-archive-inventory-20261001.json), [historical supplement](original-image-history-recovery-20261001.json) and [expanded search record](original-image-code-wide-recovery-20261001.json) for source roots, dimensions, file-format evidence and gaps. The [earlier storage comparison](reference-archive-options-20261001.json) records the recommendation and pricing research before the original-image scope was added.

The image recovery found **2,853 native PNG byte variants**, 3,807,841,950 bytes, present only inside a provider batch response. They were base64-decoded without image decoding or re-encoding and independently hashed. All 21,882 embedded images across 15 provider responses were checked against standalone or recovered hashes. Compact response copies preserve provider metadata and replace embedded payloads with image hashes; original response-file hashes remain in the recovery ledger. The original response files are still local.

Some JPEG originals have no extension; 141 historical files named `.png` actually contain JPEG bytes. Selection uses the inventory's file-signature evidence, and upload uses unchanged binary bytes. A filename extension does not determine the archived format.

The main sources include `rag/pipeline/imagegen/raw/`, the original-output directories under `packages/images/qwen-queue/`, protected manual imports, and distinct original-resolution files recovered from the retired worktree archive. Retired checkouts are read-only recovery inputs, never build inputs. Current 512-pixel `cards-png/` and `factoid-webp/` outputs are derivatives and are not counted as originals.

The expanded search stayed within `~/Code`, including identified Hiraia backups, retired worktrees, nested build checkouts and provider-response containers. It preserved 128 additional auxiliary assets: 92 historical 512-pixel derivatives, nine SVG masters and 27 branding/app/web/wallpaper assets. Another 25 provider-response files contained 2,737 image records; every decoded image hash already matched the core archive. Their compact metadata and source-file hashes are preserved without duplicating the 4.53 GB of base64 responses. The supplement also includes six exact committed archive-tool files from `9294fce56`, with Git and SHA-256 provenance.

The country references include:

- `finetuning/reference-materials/peru-quechua/`: 628 school PDFs, acquisition pages, metadata, raw text and page extraction.
- `finetuning/reference-materials/peru-curriculum/`: the official primary curriculum PDF and its extraction.
- `finetuning/reference-materials/{lrmds,science,deped-science}/`: locally available Philippine resources and extraction.
- `rag/sources/`: curriculum/framework sources and maps, excluding Python caches.
- The Quechua catalogue and review records, country dossiers and useful `/tmp/hiraia-peru-research-20260930/` evidence, including publisher manifests and the AmericasNLP sample.

Acquisition and rights records travel with the files. Archive inclusion does **not** mean a source is approved for model training, redistribution or publication. The Quechua school collection remains on a training-permission hold.

## Coverage gaps

Fifteen later manual clip-art source revisions remain unlocated after the current/retired-root and expanded `~/Code` searches; their names and available derivatives are listed in the linked inventories. Matching image names and known manual aliases identify candidates but do not establish the same historical revision. Do not upscale a derivative and label it recovered original quality.

The historical check examined all 2,825 regular image blobs in commit `9b1657b`'s `packages/images/assets-png` tree. Of these, 2,783 matched already inventoried image hashes and 42 were additional variants. Earlier full-resolution artwork exists for all 15 unresolved subjects, but it predates the later manual replacements and does not close those source-revision gaps.

Generation reference images and four large website assets are auxiliary material, with their roles and uncertain native-generation provenance labeled separately. Available derivatives for the 15 unresolved families are retained as survival copies, not counted in the 47,935 original-resolution variants.

The container search fully listed 31 relevant ZIP/tar files. Five large training/TTS archives received only bounded header inspection; their observed corpus/model/audio content does not prove that no image occurs later. Dependencies, caches and unrelated projects were excluded. This is a documented search of identified Hiraia sources, not proof that every arbitrary or renamed file under `~/Code` has been classified. No search outside `~/Code` was performed for this expansion.

The LRMDs README also records **24,975 DepEd modules on a RunPod volume** at `/workspace/corpus/raw/deped-lrportal/`. Current availability and size remain unverified; this local-library snapshot does not claim to contain that entire remote collection. Model weights, APKs and unrelated training corpora are outside this archive ingest. Any later discoveries require their own explicit inventory and snapshot.

## Storage cost

R2 Standard is **$0.015 per GB-month** with immediate access and no egress or retrieval fees. These image and reference snapshots occupy **78.1 GB**, or about **$1.20/month in storage before free allowances**, including manifests and auxiliary evidence. The account's existing release bucket shares free allowances; this is an incremental storage estimate, not the total account bill. Requests, future variants and taxes are separate. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

The initial upload and verification should fit R2 Standard's monthly one-million write/list and ten-million read allowances if account headroom remains. Billable request quantities round up to million-operation blocks. Infrequent Access lacks these allowances and is poor value for this small-object archive. The earlier B2/Glacier comparison remains in the source ledger; R2 is the service selected and implemented here.

## Integrity and access

The archive uses immutable hash-addressed objects and unique UTC snapshot IDs:

```text
objects/sha256/AA/FULL_SHA256
snapshots/20261001T032632Z-e31bd67b96c7/manifest.json
snapshots/20261001T032632Z-e31bd67b96c7/receipt.json
```

The manifest preserves each source ID, original relative path, source provenance, byte count, full-file SHA-256 and ordered chunk hashes. Country/edition/language/rights details remain in the included acquisition catalogues rather than being inferred from filenames. Identical bytes share storage; a different byte version receives a different key. Larger files are split into bounded immutable chunks and restored without changing their bytes.

A snapshot is committed only after every object has been downloaded from R2 and matched by byte length and SHA-256, followed by verified manifest and receipt uploads. ETags, successful PUTs and matching HEAD sizes are insufficient. The trusted receipt hash is recorded outside the bucket in the verification record. The restore command needs the remote snapshot, credentials and that trusted hash; it does not read original paths or upload journals.

**Retention is active** on both `objects/sha256/` and `snapshots/`. The live check returned `409 ObjectLockedByBucketPolicy` for overwrite and delete attempts against a purpose-created probe object, which remained intact. These R2 rules are administrator-removable; they are protection against ordinary upload credentials, not against an administrator deliberately removing the rules. [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

Upload credentials are temporary, scoped to this bucket and its two archive prefixes, and cannot edit bucket configuration. The live R2 endpoint rejected JWT `actions` restrictions even for `GetObject`, despite their current documentation; bucket/prefix restrictions worked. The functioning upload permission is `object-read-write`, with deletion/overwrite blocked by bucket retention and conditional-create code. Do not describe the credential itself as delete-free. Read-only credentials should be used for restore and verification. [Temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/).

No local deletion is mirrored to R2. The archive tool has no delete or garbage-collection command. Keep local originals until the remote snapshot and restore checks succeed; this task does not request local source cleanup. Credentials and operational journals remain outside Git and outside archive source selections.

After all six full restores passed, the task-created test copies were removed, reclaiming 78,484,870,089 bytes. The verification record logs those exact destinations and counts. All source originals, recovered files, frozen manifests and acquisition evidence remain local.

## Operation and maintenance

The [archive tool runbook](../tools/reference-archive/README.md) covers explicit selection, temporary credentials, inventory, upload/resume, verification and restore. Operational state belongs under ignored `build/reference-archive/`; commit the tooling and small verification records. Large originals, manifests and logs are preserved in R2.

For each acquisition or image-generation batch:

1. Preserve original bytes before transformations. Include source/reference images, prompts, provider metadata, source hashes and derivative mappings. Never overwrite a master with its shipping version.
2. Freeze an explicit inventory with stable source fingerprints and hashes. A file changed during hashing/upload fails the snapshot; acquire a fresh stable inventory rather than editing a frozen manifest.
3. Upload additively and perform complete remote-byte verification. Resume with the same manifest; previous journal success is not proof of current remote integrity.
4. Record the committed snapshot and trusted receipt digest, then restore into an empty destination. Record what was restored and any missing/corrupt object. Large restores must respect available disk space.
5. Add new evidence and archive lessons to the [country bootstrap recipe](COUNTRY-BOOTSTRAP.md). Preserve superseded sources and historical decisions.

Both manual-image processors now preserve exact source bytes under ignored `packages/images/manual-originals/sha256/` and immutable source-to-output records under `provenance/` before removing an unchanged queue input. New archive selections must include **all files** in that store, including extensionless hash-named blobs. A changed source remains pending, and preservation or provenance failure prevents source deletion.

Owner: the Hiraia team member leading each acquisition/generation task. Proposed continuing practice is a quarterly sample restore and annual full restore, plus a full check after changing archive tooling. No recurring job has been scheduled. An independent second-provider copy remains an optional later improvement; it is not part of the current R2-only completion claim.
