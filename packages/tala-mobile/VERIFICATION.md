# Worker E verification receipt — 13 November 2026

Worktree `/home/b11/code/tala-wt/e`, branch `tala-v1-e`; initial base `09dfded61`.
Latest merged integration snapshot: `fbd53f2f342eea6800ffa9d190c2596d28c93369`.
Worker-authored changes are confined to `packages/tala-mobile/**`; integration merges bring other workers' committed changes only.

Final checks, from this worktree, pnpm 9.15.9 / Node 24.21.0:

| Command | Result |
|---|---|
| `pnpm install --filter '@hiraia/tala-mobile...' --ignore-scripts` | PASS, twice as dependencies/integration evolved. No lockfile committed. Transitive react-dom/@types/react-dom peer warnings remain; Android export passed. |
| `pnpm --filter @hiraia/tala-mobile type-check` | PASS (`tsc --noEmit`). |
| `pnpm --filter @hiraia/tala-mobile test` | PASS, 11 tests, 0 failures/skips. |
| `pnpm --filter @hiraia/tala-mobile export` | PASS, `expo export --platform android --max-workers 1`, then budget checks. |
| `pnpm --filter @hiraia/tala-mobile budget` | PASS; also exercised by every export. |
| `git diff --check` | PASS. |
| Static `app.config.js` default-id check | PASS, `com.hiraia.tala.next`. Also covered by the test suite. |

Final export:

- Hermes bytecode **2,436,944 bytes**, below 4,000,000 aim / 6,000,000 limit.
- `index-a263e4dbf9e4c96ee0a651f25788625d.hbc` SHA-256: `986721c248195e04e4bd05795d1ef733248c79e2a3afe5cb12cb7a199bc53e0a`.
- One font asset: Fraunces SemiBold **73,016 bytes**.
- Image asset: existing Hiraia glyph PNG **39,238 bytes**, below 1,000,000 limit.
- Export artifacts are ignored under `dist/`; regenerate using the command above.

Tests cover real SQLite reopen durability, batch rollback including physical deletes, physical private-row purge plus cursor, durable outbox/mutation-id replay after lost responses, all four degradation rungs/recovery/low-resource policy, backoff/window boundaries, single-flight scheduler/cancel, section history preserving unsent snapshots, multi-group marking with Undo, shared-renderer PDF/text/server fallback, default Android ID/OTA isolation, and failure of bundle/image budget gates (including extensionless Metro asset names).

Development failures resolved: the initial rollback test exposed SQLite's nullable `TEXT PRIMARY KEY` behavior; outbox/meta keys now explicitly use `NOT NULL`. Initial scaffold syntax and post-merge print/SessionMark typing failures were corrected, followed by green final checks. No registry/network transient failure required repeated retries.

Not run: Gradle/Android builds, native SQLCipher/device verification, emulator instrumentation, paid provider calls, production server API calls, teacher usability sessions, native performance measurements, APK signing/publication, OTA or deployment. No servers/watchers left running. See README for remaining functional/release gates and CONTRACT-REQUESTS for orchestrator-owned interface needs.
