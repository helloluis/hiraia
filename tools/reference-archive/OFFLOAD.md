# Using image sources after local offload

An offloaded raw directory retains `.hiraia-archive-offloaded.json`. An individually
offloaded provider response retains `<filename>.hiraia-archive-offloaded.json` beside
its original path. Keep these small markers and all manifests, prompts, submission
IDs, QC records and provenance locally. A marker should identify the original path,
snapshot ID, trusted receipt SHA-256, manifest SHA-256 and selected manifest paths.
Marker presence blocks work even if its JSON is malformed or some files have been
restored. It is an operational stop sign, not proof that a backup is complete.

Image generators often use local output existence as their only completion ledger.
Running them against offloaded output would purchase the same images again.
Converters could silently process an incomplete set or use an already downsized
backup. The Python/JavaScript guards reject marked sources, destinations and their
ancestors before image input enumeration or paid generation. File sidecars also
block extraction and download-resume paths. There is no bypass flag, automatic
download or automatic marker removal.

Before offload, establish remote integrity using the committed receipt and full
content verification, create markers for the exact offloaded paths, then confirm
that no existing generator/converter is running or holding those files. Guards
stop new invocations; they do not interrupt a process already past its check.
Delete only explicitly selected, unchanged, hash-verified archived files with the
guarded cleanup tool. Shipping images, pending manual inputs, generator references,
build masters and unarchived revisions stay local.

## Restore before using an offloaded source

For raw images and other files archived directly:

1. Read the marker's snapshot and independently recorded trusted receipt hash.
   Use the existing archive command with read-only credentials and a **fresh
   staging destination**, never the live image directory:

   ```bash
   ~/.venvs/hiraia-publish/bin/python tools/reference-archive/archive.py restore \
     --snapshot SNAPSHOT_ID --receipt-sha256 TRUSTED_RECEIPT_SHA256 \
     --destination build/reference-archive/restore-for-image-work \
     --env-file build/reference-archive/credentials/read.env \
     --bucket hiraia-archive --workers 4
   ```

   Replace the placeholders with the recorded values and an existing authorized
   read-only credential file. Require exit 0 and final status `restored`. Restore
   verifies every chunk and each complete file from remote metadata; it writes
   `DESTINATION/SOURCE_ID/relative/path` and does not restore into original locations.

2. With image jobs still stopped, map the restored files back using the verified
   manifest's original source paths and the marker's exact selection. Copy exact
   bytes with exclusive creation. Hash any existing destination and reuse it only
   when it is identical; stop on a conflicting or newer version. Do not overwrite
   shipping images, source metadata or new originals merely to make a restore fit.

3. Independently hash **every offloaded file covered by the marker at its original
   path**, comparing full SHA-256 and size with the verified manifest. Restoring a
   subset is insufficient to clear a whole-directory marker. Keep provenance and
   the restore/validation record. Remove only the specific marker whose complete
   selection is now present and verified. No tool clears markers for you.

4. Resume the intended generator/converter only after this validation. Restore the
   originals; do not create placeholder images or substitute shipping derivatives.

Provider-response JSONL files can have a different archived representation: compact
provider metadata plus references to the exact native image bytes. Their sidecars
identify both components and the reconstruction recipe. Restore those components
first, reconstruct the input locally, and validate every image payload's full hash
and every retained provider field against them. Claim byte-exact recovery of the
JSONL container only when its per-file audit supplies a verified serialization
recipe and the reconstructed bytes match the recorded original SHA-256 and size.
Otherwise record that reconstruction preserves fields and image bytes but changes
container serialization; do not silently label it an exact source-file restore.
Keep the sidecar until the applicable reconstruction checks have passed and the
validation record is retained. The guards never reconstruct or clear it themselves.

For the audited provider responses, the explicit reconstruction command uses the
per-file proposal's trusted receipts, metadata/payload references and tested recipe:

```bash
~/.venvs/hiraia-publish/bin/python tools/reference-archive/reconstruct_provider_response.py \
  --proposal build/reference-archive/local-cleanup-20261001/provider-response-deletion-proposal.jsonl \
  --proposal-sha256 b7881d22399acf9623fbeb0fac1ddc0d241c165cad0a24388bba5866ccaa1042 \
  --source /original/absolute/path/to/batch-response.jsonl \
  --destination build/reference-archive/restore-for-image-work/reconstructed-response.jsonl \
  --env-file build/reference-archive/credentials/read.env --bucket hiraia-archive
```

Use the exact original source path recorded in the proposal and a new destination.
The command fetches only that response's required archived components, checks the
reconstructed complete JSONL against its recorded original SHA-256, and creates
the destination exclusively. Repeatable `--local-restore SNAPSHOT_RESTORE_ROOT`
can supply already-restored components for offline reconstruction, instead of
`--env-file` and `--bucket`. Supply `--archive-state build/reference-archive` for
the local pinned manifests and receipts (or their restored state directory). Require a
successful result, then follow the exclusive copy and original-path verification
steps above before removing that response's sidecar. There is no image generation.

Unmarked, deliberately new output directories retain normal generator behavior.
Do not change `OUT`/`SRC` merely to evade an offload marker; use a separate output
directory only for explicitly new generation work with its own provenance.

## Guard checks

```bash
python3 -m unittest discover -s tools/reference-archive -p test_offload_guard.py -v
```

Tests use isolated copies of entrypoints, inert image-library stubs and blocked
network calls. They do not read credentials, convert real artwork, create real
markers or call image providers.
