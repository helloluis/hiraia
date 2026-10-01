# Hiraia reference archive

Pricing and inventory checked **1 October 2026**. This is a recommendation and implementation plan; **no archive bucket has been created or uploaded to by this task**. The [source ledger and calculations](reference-archive-options-20261001.json) preserve the rates, assumptions and inventory snapshot.

Use a **private Cloudflare R2 Standard bucket for the working reference library**, with an **independent Backblaze B2 copy of originals and acquisition evidence**. Hiraia already uses R2 for release assets, so the primary archive can reuse familiar tooling while keeping research materials separate from public downloads. If choosing a single new service on storage cost alone, B2 is cheaper and provides immediate access.

The currently inventoried library is small enough that both copies cost about **$0.48/month in storage before free allowances**, or about **$0.41/month** if B2's 10 GB allowance is unused and R2's storage allowance is already consumed. Request charges, taxes, additional versions and remote-only collections are separate. Check account usage before estimating the total bill.

## What needs preserving

The local snapshot totals **5,143 files and 21,611,255,369 bytes**, approximately **21.61 GB decimal**. It is a path/byte inventory, not a deduplicated corpus or a rights audit.

| Local scope | Approximate size | Contents |
| --- | ---: | --- |
| `finetuning/reference-materials/peru-quechua/` | 13.06 GB | 628 school PDFs, acquisition pages, metadata, raw extracted text and page JSONL. |
| `finetuning/reference-materials/peru-curriculum/` | 0.022 GB | Official primary curriculum PDF and original extraction, preserved from scratch storage. |
| `finetuning/reference-materials/lrmds/` | 7.54 GB | Local Philippine learning-resource PDFs and metadata. |
| `finetuning/reference-materials/science/` | 0.94 GB | PDF, DOC and DOCX science materials and extraction. |
| `finetuning/reference-materials/deped-science/` | 0.038 GB | Existing extracted records. |
| `rag/sources/` | 0.011 GB | Seven PDFs, including curriculum/framework references, and small derived files. |

Prioritize original source bytes, acquisition evidence, edition/rights metadata, checksums and human corrections. Text extraction and thumbnails are reproducible but inexpensive to retain when labeled with their source hash and extraction method. Small mapping files can change after this snapshot; use a fresh manifest for the actual upload.

Also snapshot the small catalogue, acquisition-gap, rights-hold and review records in `tools/quechua-school-corpus/`, the Peru research documents/inventory in `docs/`, and the curriculum maps. These records preserve decisions that are absent from raw PDFs. Either include their bytes with the snapshot or pin and verify a repository revision containing them; untracked files have no remote Git copy. These additional records are outside the folder-size snapshot above.

**This is not the complete remote inventory.** The LRMDs README records 24,975 DepEd modules on a RunPod volume at `/workspace/corpus/raw/deped-lrportal/`. Its present availability, byte count and backup status were not checked. Inventory that collection before treating this archive as complete. Model weights, APKs, illustration packs and general training corpora are outside these estimates.

Earlier exploratory Peru downloads also remain under `/tmp/hiraia-peru-research-20260930/`, including publisher manifests and an AmericasNLP parallel-text sample. Review and preserve useful evidence during archive ingest, deduplicating the curriculum PDF already saved in the permanent reference folder. Temporary downloads are outside this size estimate and should not be treated as a durable copy.

## Cost comparison

Approximate monthly **storage only**, excluding free allowances and tax. Column sizes are decimal bytes; AWS prices are converted from its binary GB billing. B2 estimates interpret its advertised TB as decimal; provider usage reports and invoices control the final amount.

| Option | Peru school collection 13.06 GB | Current library 21.61 GB | 100 GB | 1 TB | Use here |
| --- | ---: | ---: | ---: | ---: | --- |
| R2 Standard | $0.21 | $0.33 | $1.50 | $15.00 | Recommended working archive. |
| Backblaze B2 | $0.09 | $0.15 | $0.70 | $6.95 | Recommended independent copy; also viable alone. |
| S3 Glacier Flexible Retrieval | $0.04 | $0.07 | $0.34 | $3.35 | Consider later for rarely used bulk archives. |
| S3 Glacier Deep Archive | $0.01 | $0.02 | $0.09 | $0.92 | Consider at much larger scale with slow restores acceptable. |

Rates: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [AWS S3 US East rate card](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json), [AWS Deep Archive US East rate card](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3GlacierDeepArchive/current/us-east-1/index.json). AWS figures are payload storage only and exclude per-object archive metadata, requests, temporary restored copies and downloads.

R2 Standard offers immediate retrieval without retrieval/egress fees. Its monthly account allowance includes 10 GB of storage, one million write/list operations and ten million read operations. The proposed initial upload and full verification fit those request allowances if sufficient headroom remains. Billable requests round to whole million-operation blocks. **Avoid R2 Infrequent Access for this collection:** it lacks the free allowance, and a small write/read batch can trigger $9.90 in request blocks. The inventoried upload plus full read-back would cost about $10.34 for the first full month on that tier. [R2 billing examples](https://developers.cloudflare.com/r2/pricing/).

B2's current rate is **$6.95/TB per 30 days**, with the first 10 GB free and ordinary API calls free. Downloads up to three times average stored data are included; excess direct egress is $0.01/GB. This suits an independent copy and periodic restores. The older $6/TB rate changed on 1 May 2026. [B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [price-change announcement](https://www.backblaze.com/blog/backblaze-pricing-and-product-updates/).

Glacier Flexible Retrieval has a 90-day minimum; Deep Archive has 180 days. Typical bulk restores take 5–12 hours and up to 48 hours respectively. Download and temporary-copy charges can exceed months of storage savings: downloading 1 decimal TB from US East would incur about $74.82 in internet egress even with an otherwise unused 100 binary GB allowance, before restore charges. The active reference library benefits more from straightforward access than from saving a few cents. [Storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html), [restore options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html), [transfer rate card](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json).

Wasabi's current $7.99/TB/month offering has a one-TB minimum and 90-day minimum storage duration. That minimum makes it poor value for this library today. [Wasabi pricing](https://wasabi.com/pricing), [product terms](https://wasabi.com/product-terms).

## Archive structure

Keep the archive private. Do not attach it to `assets.hiraia.org` or enable a public bucket URL. The existing release publisher deliberately makes assets public and is therefore not the archive uploader. Public access to a textbook also does not settle redistribution or training permission.

Use immutable content-addressed keys, for example:

```text
objects/sha256/34/34009689b6e3fe2194ec61c1675af13407528ae5e0f34f4d484007efd9e832f7.pdf
snapshots/2026-10-01T020000Z-initial/manifest.jsonl
snapshots/2026-10-01T020000Z-initial/manifest.sha256
```

Country, publisher, language, grade, title and original filename belong in the manifest. Identical bytes can share one object while retaining every source attribution. A different edition receives a different hash/key. Give derived files their own hashes and parent-source hashes; never overwrite an original with cleaned text. Use a unique UTC timestamp and snapshot ID so two acquisitions on the same day cannot overwrite a manifest.

The manifest should include source and acquisition URLs, title, publisher, edition, retrieval date, country/subject/grade, language/variety and confidence, bytes, SHA-256, media type, reuse/training status, local path, cloud bucket/key and verified-copy status. Store the manifest in Git and with every remote snapshot. Credentials stay outside the repository.

Cloud durability alone does not protect against deleting or overwriting the right object with the wrong bytes. R2 bucket locks can prevent changes to protected prefixes, but a configuration administrator can remove the rules. Use hash-based keys and scoped credentials; do not rely on unverified native S3 versioning behavior. [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

B2 retains file versions by default. Its Object Lock can add retention protection; enabling that bucket feature is irreversible, and compliance retention cannot be shortened. For an ordinary research archive, governance retention with an ingest key lacking delete/bypass capabilities is the proposed starting point. Choose the retention period during setup and keep administrator credentials separate. [B2 versions](https://www.backblaze.com/docs/en/cloud-storage-lifecycle-rules), [Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).

## Implementation and maintenance

1. Inventory the local scopes and the remote DepEd collection. Build a manifest, verify source hashes and resolve duplicate bytes without discarding provenance. Preserve the existing 628-PDF Quechua collection as a named acquisition snapshot.
2. Create a dedicated private R2 Standard bucket and a private B2 bucket with separate, narrowly scoped ingest credentials. Set retention deliberately; do not reuse the website publisher's public destination or administrative credentials.
3. Upload originals, evidence and snapshot manifests additively. Never propagate local deletions automatically. Keep the local source copy until remote verification succeeds.
4. Download every initially uploaded object, compute SHA-256 from the returned bytes and compare it with the manifest. A successful upload or matching HEAD length is insufficient. Record verified locations and timestamps only after the comparison passes.
5. Independently restore a complete snapshot from **each provider** into an empty directory using that archive and its manifests alone. Demonstrate that another machine can recover the catalogue and originals without this MacBook's paths or caches. A successful R2 restore does not validate the B2 copy.
6. Assign an archive owner. After each acquisition, add new hashes and publish a new manifest. Proposed maintenance is a quarterly sample restore and an annual full restore, plus a full check after changing archive tooling. Record the last successful restore and investigate missing objects or checksum failures immediately.

The cadence above is a proposal; no scheduled task was created. The next implementation milestone is a verified, restorable copy with a manifest and an owner, rather than simply a bucket containing uploaded files.

Feed new archival lessons back into the [country bootstrap recipe](COUNTRY-BOOTSTRAP.md).
