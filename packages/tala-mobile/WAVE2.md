# Wave 2 implementation and handoff

- `src/features/generation.ts` and `GenerationScreen.tsx`: durable generation queue, per-request idempotency, progress/cancel/background resume, section regeneration, allowance, cached official objectives and multi-group inputs. Explicit Apply journals the atomic draft/revision operation; replay refuses newer teacher edits. Offline/error templates preserve requests and old text.
- `roster.ts` / `RosterScreen.tsx`: offline deterministic text/CSV parsing and document picking; online import rechecks cloud consent. Review prioritises flagged rows, supports all five decisions, mapping/manual corrections, changed-row consent and partial saves. Confirm freezes its key/body and student IDs before one batch. Drafts expire after 24 hours; unsafe identifiers are withheld.
- `community.ts` / `CommunityScreen.tsx` / `PostQueue.tsx`: typed search, cached details/filtering, structural copy with lineage/custom-template isolation, My posts/remove/report, exact public preview and personal-data checks. Reviewed preview must still match when queued and dispatched. Posts resume with server revision deduplication.
- `tasks.ts` / `index.ts`: encrypted durable task metadata, retry/backoff, recovery and foreground/background coordination. Background work is opportunistic; no wake lock.
- `atomic.ts` / `realignment.ts`: shared required `batch`, nested setup staging and atomic apply/Undo. Older plans use required `fetchPlans`, preserving the main cursor.
- `runtime/history.ts`: edits/restores/revisions in the same atomic operation; unsynced history is retained.
- `src/i18n/wave2.{fil,en}.ts`: paired Filipino/English strings. Human review requested for generation/retry, moderation, roster changed-row/encoding and licence terminology; existing README review list also applies. `before_tala`: “Naituro na bago gumamit ng Tala”.

Only Class activity remains a placeholder in Class; copy a future Nearby port into this package. Do not edit Kotlin/student packages or reuse their Android ID/signing/OTA. Four tabs remain fixed; default ID is `com.hiraia.tala.next`.

Known follow-ups: real-device accessibility/performance/native encryption gates; offline-copy count registration; account lifecycle UI and other wave-one release gaps listed in README. Network fixtures test adapters, not a live server/provider integration. No runtime engine/pacing/print fake remains.
