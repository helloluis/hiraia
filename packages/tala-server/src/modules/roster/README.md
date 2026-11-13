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
   successfully returned rows cannot be returned a second time. Full confirmation/abandon deletes the draft.

Drafts live only in a per-module memory map, with no SQLite tables/migrations and no logs. They expire at
23 h 59 min; a one-minute cleanup timer guarantees removal by 24 h during normal operation. Access also
checks expiry and class ownership/deletion. Shutdown/restart drops all drafts. Uploaded bytes are not kept
for review. Server process memory, swap/core-dump protection and HTTPS are deployment responsibilities.
This is a single-process temporary import service; a multi-instance deployment needs affinity or an
explicit encrypted shared ephemeral store. Do not persist this map as plaintext.

## Limits and library choices

- Maximum 5 MiB input; maximum 500 nonempty source rows (including headers; contract request pending),
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
  a document object tree and HTML conversion. `tsx` is a runtime dependency because these packages ship
  TypeScript source and the worker loads it through the supported `tsx/cjs/api` registration API.
- UTF-8 and BOM UTF-16 decoding is pure TS; Windows-1252 fallback is always marked uncertain. Unsupported
  encodings and damaged files offer paste/UTF-8 conversion instead of replacement characters.

## Integration and remaining gates

Read `CONTRACT-REQUESTS.md` for manual first-pass mapping, 500-student row accounting, durable cloud
history, encoding selection and confirmation idempotency. Column-model results are advisory and cannot
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

Tests use invented names, fake LLM gateways and a minimal owned-class RecordStore fake. Authentication,
route schema validation, response validation, expiry clock and logs use the real `createTestServer` kernel.
