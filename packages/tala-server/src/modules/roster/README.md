# Roster module (Worker F)

`createRosterModule()` provides import/get/remap/confirm/abandon; `rosterModule` is the registry singleton.
Pure/offline functions are exported at `@hiraia/tala-core/roster` (`decodeText`, `extractText`,
`structureRows`, `normalizeSource`, `normalizeName`, `traceable`, duplicate grouping).

## Flow and privacy

1. Require a verified account and an owned, non-deleted class. Validate the cloud flag before reading bytes.
2. Read in an isolated worker; never write uploads to disk. Wipe the caller's byte buffer after extraction.
3. Determine structure, immediately discard sensitive **and unmapped** cells, retain only approved cells
   for deterministic remapping. Structure rows have indices/reasons rather than retained school/teacher text.
4. Optional model assistance receives canonical column labels with fully masked samples, or unresolved
   name cells plus row indices. No user/class identity is supplied in model requests (`userId: null`).
   The authenticated gateway may still apply feature/global budgets; there are no paid calls in tests.
5. Independently validate output shape, row cardinality/indices, source character runs with multiplicity,
   no inferred metadata and no lost name runs. Reject invalid proposals and leave explicit review flags.
6. Confirmation returns only allowlisted student fields for the client sync engine. Pending rows remain;
   successful confirmations with an `idempotencyKey` replay the same result. Reusing a key with a changed
   body returns conflict. Full confirmation/abandon deletes the draft. Replay receipts are encrypted with
   a per-process AES-GCM key and expire at the original draft deadline; account deletion purges them too.

Draft content lives only in a per-module memory map, with no persistent tables/migrations and no logs.
A SQLite TEMP table holds only import ID, owner ID and expiry. It contains no names, request bodies or
receipts. `onAccountMerged` updates this ownership table synchronously inside the merge transaction;
if a later merge step fails, SQLite rolls ownership back while the in-memory content stays intact.
Retry keys are scoped by globally unique import ID, so identical client keys from separate accounts
remain separate. Repeating a merge, or merging an account into itself, leaves the content unchanged.
The temporary ownership rows are cleared on account deletion, expiry and shutdown. Drafts expire at
23 h 59 min; a one-minute cleanup timer guarantees removal by 24 h during normal operation. Access also
checks expiry and class ownership/deletion. Shutdown/restart drops all drafts. Uploaded bytes are not kept
for review. Server process memory, swap/core-dump protection and HTTPS are deployment responsibilities.
This is a single-process temporary import service; a multi-instance deployment needs affinity or an
explicit encrypted shared ephemeral store. Do not persist this map as plaintext.

## Limits and library choices

- Maximum 5 MiB input; maximum 500 student rows plus 100 non-student structure rows,
  100 columns, 10,000 characters/cell at extraction, 500 characters/original name, 200 display-name chars.
- Maximum two concurrent reader workers, eight seconds per reader, V8 old/young heap limits 96/16 MiB,
  4 MiB stack. ZIP metadata is checked against 20 MiB total expanded content and 1,000 entries before
  decompression. These are parser bounds, **not** an end-to-end device/RSS benchmark or OS sandbox.
- Spreadsheet formulas, cached formula results, macros and HTML formatting are not imported. External
  links are never followed. DOCX reads only `word/document.xml`, rejects DTDs, and never loads relationships,
  images or external entities. Nested tables return the paste fallback.
- [SheetJS CE 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) comes from its
  official distribution (the npm `xlsx` release is stale). One server-only reader covers XLSX, legacy XLS
  and ODS, avoiding three format implementations. Formula evaluation is not installed or performed.
- [fflate](https://github.com/101arrowz/fflate) is the small ZIP reader; entry filtering bounds expansion
  before extraction. [saxes](https://github.com/lddubeau/saxes) is a strict streaming XML parser, avoiding
  a document object tree and HTML conversion. The worker is plain CommonJS requiring only reader libraries
  and the shared pure-JavaScript decoder. `tsx` is development-only. `execArgv: []` prevents inheriting a
  parent test/dev loader. `text-runtime.cjs` is the canonical decoder; `text.ts` provides its typed facade.
  The worker URL is assigned before constructing the Node Worker so webpack does not turn it into a
  bundled worker entry. Next’s existing server URL parser rule preserves the source-file URL.
- UTF-8 and BOM UTF-16 decoding is pure TS; Windows-1252 fallback is always marked uncertain. Unsupported
  encodings and damaged files offer paste/UTF-8 conversion instead of replacement characters.

## Integration and remaining gates

Read `CONTRACT-REQUESTS.md` for manual first-pass mapping, durable cloud history and encoding selection.
The 500-student row accounting and confirmation idempotency requests are implemented. Replay lasts only
until the original deadline and does not survive a process restart; clients must deduplicate applying a
replayed result to their own local student records. Column-model results are advisory and cannot
resurrect discarded columns; retained names can be remapped. Unrecognised tables currently need pasted
name columns. Exactly-as-written works on physical text lines or approved name cells in binary tables;
it never resurrects discarded sensitive columns. Unsupported/oversized names remain pending for editing.

Clients own the mandatory review UI, per-row accept/edit/split/not-student/keep-original actions, explicit
bulk changed acceptance, column/sheet choice and safe client sync. `@hiraia/tala-core/roster` exports `rosterNotices` with English/Filipino
notice text (Filipino needs native review). Clients must display it and show the route/AI mark.

Before real production data: the orchestrator must enforce the PIA and local-model evaluation gate,
secure server/device storage and transport, account/class deletion in sync/backups, and school-year
retention policy. This module blocks cloud in production but cannot certify those wider requirements.
PRIV-9/10 (plan publication and device activity data) belong to their respective modules. ROS-2 PDF,
ROS-3 photo/scan and ROS-8 re-upload diffs are P1/P2 and are not implemented here.

Tests use invented names and fake LLM gateways. Class fixtures use the real RecordStore. Account deletion
invokes the synchronous `onAccountDeleted` hook to purge all of that teacher’s drafts immediately. Authentication,
route schema validation, response validation, expiry clock and logs use the real `createTestServer` kernel.

## Bundled-build verification (2026-11-13)

Merged `tala-v1` through `7e93851bc`, which pins the matching React/ReactDOM versions.
`pnpm --filter @hiraia/tala-web build` completed successfully.

Run the repeatable smoke check after building:

```sh
node packages/tala-server/src/modules/roster/http-smoke.cjs
```

The script starts the actual built Next app on an ephemeral loopback port with `TALA_ENV=local`
and a new temporary `TALA_DB_PATH`. It registers a throwaway account, creates its class through
HTTP sync, checks that roster upload returns 403 before email verification, reads the verification
token from that temporary database's development outbox without printing it, and verifies over HTTP.
It posts invented pasted-text and XLSX rosters to `/api/v1/roster/imports` with no Origin header.
Both returned HTTP 200 with `linesRead: 3`, `students: 2`, `needsReview: 0`, `notStudents: 1`.
The returned names were `Peña, Miro A.` and `De los Santos, Lira B.`; the XLSX sheet was `Invented names`.
This exercises the plain-JavaScript worker from the bundled API route, including library/file resolution.
No AI service is called. The script deletes the account, stops the child server, and removes the temporary
SQLite database (including sidecars) in its cleanup path. It never prints credentials or email tokens.

Observed acceptance run: port 41767; server shutdown and temporary-directory removal both confirmed.
No web config changes were needed. This validates `next start` with the workspace packages present;
it does not claim a separately packaged Next standalone artifact has been assembled or tested.
