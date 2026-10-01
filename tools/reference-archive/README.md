# Private reference and original-image archive

`archive.py` freezes explicitly selected local files, uploads their exact bytes to a
private Cloudflare R2 bucket, and independently verifies or restores a committed
snapshot. It handles PDFs, native-resolution PNG/JPEG/WebP images, extensionless
originals, source documents and recovery provenance without decoding or re-encoding
them. Python 3.10+ on macOS/Linux is required; cloud operations use the existing
`~/.venvs/hiraia-publish` environment's boto3. Inventory and tests use only stdlib.

The `archive.py` CLI never provisions buckets, makes objects public, overwrites existing objects,
or deletes local or remote files. The operator must verify that the destination has
no public R2.dev endpoint or custom domain. `--bucket` is required; `hiraia-assets`
and common public bucket names are refused. Name validation cannot establish privacy.

## Select and freeze the sources

Keep selection files, generated manifests, journals, logs and restores under ignored
`build/reference-archive/`. Other explicitly chosen directories outside this repository
are also accepted. Operational output inside tracked repository directories is refused.
Source roots can be anywhere, including recovered retired-worktree material. Inventory
records their absolute original paths, source IDs and provenance in the private manifest.

Example `build/reference-archive/selection.json`:

```json
{
  "schema": 1,
  "sources": [
    {
      "id": "rescued-originals",
      "kind": "directory",
      "path": "/Users/luis/Code/hiraia/build/reference-archive/rescued-manual-originals-20261001",
      "include": ["**"],
      "exclude": [],
      "provenance": {
        "description": "Original image bytes rescued before format conversion; provenance.json describes recovery"
      }
    },
    {
      "id": "curriculum-source",
      "kind": "file",
      "path": "/absolute/path/to/an-explicitly-selected-source.pdf",
      "provenance": {"country": "PE", "source_url": "https://example.org/original-source"}
    }
  ]
}
```

Replace placeholder paths before running. Source IDs must be unique safe names.
Directory `include` defaults to all files; `exclude` defaults to none. Patterns use
case-sensitive `fnmatch` against relative paths (`**/*.png` also matches root-level
PNG files). Excluded directories are pruned. Do not select only `.png` if a root also
contains original JPEGs or extensionless images. A stable rescued directory should
include its provenance JSON. Symlinks and non-regular files are refused rather than
silently followed. Each source must select at least one file.

```bash
python3 tools/reference-archive/archive.py inventory \
  --selection build/reference-archive/selection.json
```

Alternatively, use repeatable `--root ID=/absolute/directory` and
`--file ID=/absolute/file`; these can supplement a selection file. There is no implicit
scan of the checkout. Inventory is local only and prints one JSON result containing
`snapshot_id`, `manifest`, `manifest_sha256` and `totals`.

Inventory hashes the whole original plus its ordered chunks. It compares device,
inode, size, mode, modification time and change time before/open/after hashing.
Uploading repeats the checks and compares uploaded chunk bytes against the frozen
digest. If a source changes, create a new inventory after its writer finishes. This
is an explicit file selection frozen over an interval, not a filesystem-wide atomic
snapshot. New files created after enumeration belong in a later snapshot.

## Upload and resume

Mint a temporary env file with the separate, stdlib-only helper. It reads the parent
env file locally, signs an HS256 JWT and makes no network request. Defaults are six
hours and `object-read-only`; only explicit `--upload` grants `object-read-write`.
Bucket and output are required. Scope is fixed to that bucket's `objects/sha256/`
and `snapshots/` prefixes, with no administrative permissions.

```bash
# Verify/restore credentials (default: six hours, read only).
python3 tools/reference-archive/mint_credentials.py \
  --env-file .env.cloudflare.local --bucket hiraia-archive \
  --output build/reference-archive/credentials/read-20261001.env

# Upload credentials: choose an explicit lifetime, up to 24 hours.
python3 tools/reference-archive/mint_credentials.py \
  --env-file .env.cloudflare.local --bucket hiraia-archive \
  --upload --ttl-hours 24 \
  --output build/reference-archive/credentials/upload-20261001.env
```

Use a new output filename on renewal. Output is atomic, exclusive and mode 0600;
existing files and symlink paths are refused. Only ignored `build/reference-archive/`
can hold generated credentials. Stdout reports scope, expiry and destination without
credential values. `--ttl-seconds` supports shorter lifetimes (1–86400 seconds).
The account ID is validated against `R2_ENDPOINT` and, if supplied,
`CLOUDFLARE_ACCOUNT_ID`/`R2_ACCOUNT_ID`; a validated account variable can supply the
default endpoint when absent. Temporary credentials cannot be used as the parent.

**Observed limitation, 2026-10-01:** this account's live R2 endpoint rejected JWTs
containing an `actions` claim with `400 InvalidArgument` for `X-Amz-Security-Token`,
including a single GetObject action. The same bucket/prefix-scoped JWT without that
claim worked. The helper therefore omits `actions`. Upload credentials have broader
object read/write permissions, including deletion; they are not restricted to
conditional creation. Indefinite bucket locks were separately verified on both
archive prefixes to block deletion and replacement. These locks are removable by
an administrator. The helper does not establish bucket privacy or inspect/configure
locks; keep those independently verified before minting upload credentials.

JWT claims and derivation follow Cloudflare's
[local signing example](https://developers.cloudflare.com/r2/examples/authenticate-r2-temp-credentials/)
and [temporary credentials reference](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/).

The environment file is parsed as data; it is never executed or printed. Required:
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Optional
`R2_SESSION_TOKEN` supports temporary, bucket-scoped credentials. Use an HTTPS
account-level `*.r2.cloudflarestorage.com` endpoint. The tool makes only GetObject
and PutObject requests; it does not require HeadBucket or ListBuckets permissions.
Keep credentials restricted to the private bucket's `objects/sha256/` and `snapshots/`
prefixes. Use object-read-only for verification/restore and object-read-write for
upload, with separately verified bucket locks. Keep that env file ignored, mode 600,
and out of archive selections.

```bash
~/.venvs/hiraia-publish/bin/python tools/reference-archive/archive.py upload \
  --manifest build/reference-archive/snapshots/SNAPSHOT_ID/manifest.json \
  --env-file build/reference-archive/private-r2.env \
  --bucket hiraia-archive \
  --workers 4
```

Repeat the **same command** to resume. Credentials can be renewed without changing the
manifest. The local journal is locked against concurrent upload of the same snapshot;
the destination bucket, endpoint hash and manifest digest are pinned locally. A killed
process releases its OS lock, and an incomplete final journal line is safely discarded.
All existing remote objects are downloaded and SHA-256 verified again on resume;
a previous journal success is never accepted as proof of intact remote bytes.

Ctrl-C stops submissions, cancels unstarted futures, and wakes/cancels workers waiting
for payload capacity. Transfers that already hold a payload lease or are reading an
existing object finish verification and journal their outcome before the lock is
released. The queued inventory is not drained. Active requests can still take time
to finish within SDK timeout/retry limits. Cancelling during content transfer never
advances to manifest/receipt publication; the CLI returns interrupted status (130).
An interrupt during an already-issued final metadata request can leave that remote
request committed. Resume verifies the stored state rather than assuming the request
failed or attempting to roll back immutable objects.

`--workers` accepts 1–32, default 4; the HTTP connection pool supports 32. The pending
queue is at most twice the worker count. It replenishes workers as transfers complete,
so a slow earlier object cannot stall later work. This changes processing order only;
the frozen manifest, object keys and verification requirements are unchanged.

Uploads share a **512 MiB source-payload budget across all workers in that process**.
The lease is acquired before reading a source chunk and retained through verified
remote creation/read-back. Payload and exception-frame references are discarded
before releasing it, including on failure. Eight full 64 MiB payloads can coexist;
32 small images can transfer concurrently when their combined size fits. Use
`upload --workers 32 --buffer-mib 512` explicitly to select the higher concurrency.
`--buffer-mib` can lower the budget (1–512); it must accommodate the largest selected
chunk or upload fails before remote operations. Progress/final JSON includes the
buffer limit, current reservation and observed peak in bytes.

Chunks default to 64 MiB (`inventory --chunk-mib`, max 128); small images are single
objects, while large files are split without byte changes. Existing-object checks,
read-back, independent verification and restore stream bytes. The payload budget is
**not a total process-memory limit**: allow roughly two 1 MiB blocks per active reader
for streaming-buffer turnover, plus SDK/TLS buffers, hashes, parsed manifest and
serial metadata operations. Metadata is separately capped at 256 MiB. Separate
upload processes each have their own budget; they do not share a machine-wide cap.

Increasing concurrency does not guarantee a speedup. Existing processes retain their
loaded code; changing this script does not alter them. A deliberate restart re-reads
every existing remote object, so account for that verification cost before restarting.

Every new or reused blob is fully downloaded and checked for both byte length and
SHA-256. Upload thus includes at least one complete archive-sized read-back. Resume
also re-reads previously uploaded objects. ETags, stored metadata and HEAD responses
are not integrity evidence. A corrupt existing content-addressed object fails the
snapshot and is never overwritten. Investigate corruption explicitly; do not bypass
checks, edit a frozen manifest, or manually mark a journal complete.

Existing manifests and receipts are read and verified before any create attempt,
so resuming also works with retention-locked objects. If a create races another
writer and returns an error (including AccessDenied), the tool accepts the object
only if a subsequent full GET matches the exact expected bytes. Otherwise it fails.

Objects use `objects/sha256/AA/FULL_SHA256`; exact equal chunks share one object across
files and snapshots. Each original path remains in the manifest, even when its bytes
duplicate another file. `totals.logical_bytes` counts every original path;
`totals.stored_bytes` counts unique chunk bytes within this snapshot, excluding metadata.
`unique_files` counts whole-file byte variants. Upload results separately count created
and reused objects; cross-snapshot dedup can reduce newly stored bytes further.

## Commit and integrity evidence

Snapshot identifiers contain UTC time plus a random suffix. The immutable local
`manifest.json` has a `manifest.sha256` sidecar. Once all content objects pass read-back
and selected source files still match their frozen stats, the tool conditionally creates
and verifies `snapshots/ID/manifest.json`, then a receipt identifying that manifest's
digest, length and totals. Receipt creation is the snapshot commit point. Only after
remote receipt read-back does the local `receipt.json`/`receipt.sha256` appear.

A failure between these steps can leave content blobs or an orphan manifest. These
are retained for resume; restore and verify refuse a snapshot without its committed
receipt. The tool has no delete, garbage-collection or replacement command. Local
`receipt.pending.json` preserves the same receipt bytes across a resumed commit.

Record the reported `receipt_sha256` and snapshot ID independently, for example in
the tracked high-level archive inventory or another trusted backup. Passing the hash
to verify/restore detects changes to the receipt itself. Without a trusted receipt
pin, verification establishes consistency with the currently stored remote receipt,
not historical authenticity. Application-level conditional immutability is not WORM
storage or protection against an administrator deleting/replacing objects externally.

## Reviewed local cleanup

`local_cleanup.py` is a separate, stdlib-only executor for an explicitly reviewed
list of local files. It has no network or remote-delete operation. Start with a
dry run; applying requires the exact SHA256 of the reviewed plan:

```bash
python3 tools/reference-archive/local_cleanup.py --plan /absolute/reviewed-plan.json
python3 tools/reference-archive/local_cleanup.py --plan /absolute/reviewed-plan.json \
  --plan-sha256 REVIEWED_SHA256 --apply
```

Plan schema `1` requires `allowed_roots`, `protected_paths`, a
`remote_verification: {path, sha256}` document, `snapshots` containing
`{manifest_path, receipt_path}`, and `files`. Every file has an absolute normalized
`path`, `sha256`, `bytes`, and `stat: {device, inode, size, mtime_ns, ctime_ns, mode,
links}`. `mode` accepts permission bits or full `st_mode`; `links` must be `1`.
Exact-file proof is `archive: {kind: "exact-file", snapshot_id: "..."}`. The pinned
remote evidence must report matching manifest/receipt hashes and a successful full
restore for every referenced snapshot. This executor validates that evidence
locally; it does not perform another remote verification.

Provider responses use `archive: {kind: "provider-fields", proof_path,
proof_sha256}` pointing to the reviewed provider-audit JSONL. Each matching source
record must prove all parsed fields and native payloads are preserved in the pinned
snapshots, with zero errors, and verify byte-identical JSONL reconstruction against
the source SHA256. A raw response hash is not assumed to be an archived object.
Preserve the plan, provider reconstruction recipes and archival evidence before
removing sources. Metadata, offload markers and all protected build paths are excluded.

Stop writers and check open readers before applying; an already-open descriptor can
still write after a rename. The executor rejects symlinks at every path component,
hardlinks, changed stats and changed bytes. Each file is freshly hashed, atomically
renamed to a reserved `.hiraia-cleanup-...claim` name in the same parent using native
no-overwrite rename, then checked and fully hashed again before unlinking. Rollback
never overwrites a recreated source. No directory is recursively removed.

Journals live under ignored `build/reference-archive/local-cleanup-state/PLAN_SHA/`
by default (`--state-dir` can select another operational directory). They are
locked, fsynced and hash-chained; a crash leaves a recoverable claim or a durable
verified unlink intent. Repeat the same pinned command to resume. Preserve both
the journal and any claim if rollback is blocked. A rolled-back file has a new
ctime and needs a new reviewed plan. Completed paths recreated by another writer
are refused and retained. Dry runs neither claim files nor create a journal.
Progress goes to stderr every 500 completed files or 15 seconds; stdout contains
the final JSON result. Ctrl-C returns `130` and preserves claims for resume.

## Verify independently and restore

These commands need only remote snapshot metadata and credentials; the original
files and local upload journal are not used. Verification reconstructs each unique
original's full SHA-256 by streaming its ordered, individually checked chunks.

```bash
~/.venvs/hiraia-publish/bin/python tools/reference-archive/archive.py verify \
  --snapshot SNAPSHOT_ID --receipt-sha256 TRUSTED_RECEIPT_SHA256 \
  --env-file build/reference-archive/private-r2.env \
  --bucket hiraia-archive --workers 4

~/.venvs/hiraia-publish/bin/python tools/reference-archive/archive.py restore \
  --snapshot SNAPSHOT_ID --receipt-sha256 TRUSTED_RECEIPT_SHA256 \
  --destination build/reference-archive/restore-check \
  --env-file build/reference-archive/private-r2.env \
  --bucket hiraia-archive --workers 4
```

Restore writes `DESTINATION/SOURCE_ID/original/relative/path`. It checks every chunk
and the reassembled full-file hash before atomically creating the destination file.
Existing identical files are hashed and reused; different files are refused. An
interrupted restore can be repeated. A restore that fails halfway can leave completed,
verified files; its JSON status remains `incomplete`. Original permission bits
(excluding special bits) and modification time are restored; ownership, ACLs, extended
attributes, directory metadata and resource forks are outside this byte archive's scope.
Use a dedicated destination with no symlink ancestors and no concurrent external writer.
On macOS prefer `/private/tmp/...` over the symlink `/tmp/...` for an external test restore.

Final stdout is one JSON record. Upload progress is JSON on stderr every 100 objects.
Successful states are `inventoried`, `committed`, `verified`, `restored`; failure states
are `incomplete`, `corrupt`, `failed`, `interrupted`. Exit 0 means complete success,
1 means failure, and 130 means interruption. Results include totals and bounded error
details; upload journals retain individual object outcomes without credentials.

## Validation and implementation references

```bash
python3 -m unittest discover -s tools/reference-archive -p 'test_*.py' -v
python3 -m py_compile tools/reference-archive/archive.py tools/reference-archive/test_archive.py
python3 -m py_compile tools/reference-archive/mint_credentials.py tools/reference-archive/test_mint_credentials.py
python3 tools/reference-archive/archive.py --help
python3 tools/reference-archive/mint_credentials.py --help
```

Tests use a failure-injectable fake S3 client and no credentials or network. They cover
exact-byte deduplication, external source roots, empty/chunked restore, local mutation
during inventory and upload, corrupt existing/uploaded blobs, interrupted resume,
corrupt manifests, locked-object races, truncated reads, committed-receipt requirements, whole-file hash
mismatch, safe paths, bucket refusal and temporary credential forwarding.
Credential-helper tests independently verify JWT scope, HMAC signature, expiry and
secret derivation, exclusive private output, concurrent-file refusal and redacted
success/failure output. No real parent credentials are used by the tests.
Concurrency tests hold an early future open while later work replenishes, check the
bounded pending queue, block simultaneous uploads to prove the shared byte limit is
acquired before source reads, and check reservation release after source/remote failures.
Cancellation tests cover queue shutdown, immediate wakeup of budget waiters, preservation
of the original error, and a real SIGINT sent only to an isolated fake-storage test
subprocess. That probe verifies exit 130, a valid journal, no partial-snapshot receipt,
lock release, and successful subsequent resume.

The implementation uses R2's documented conditional PutObject and Content-MD5 support:
[Cloudflare S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
`IfNoneMatch="*"` is required; a 412/409 is followed by full existing-byte verification,
never an unconditional retry:
[boto3 PutObject reference](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html).
Large files use independent immutable chunks so safety does not depend on conditional
multipart-completion support. The installed SDK must expose PutObject's IfNoneMatch
parameter or writes are refused.
