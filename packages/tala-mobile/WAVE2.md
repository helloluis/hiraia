# Wave 2 entry points

This package owns the Expo phone client; do not modify `packages/mobile` or Kotlin `packages/tala`.

- `src/App.tsx`: labelled `generation` placeholder above Lessons, `roster` and `activity` placeholders inside Class, and the Community tab. Four bottom destinations are fixed. Plug generation into lesson creation, roster import into the chosen Class, and Community into its existing tab. Do not add a fifth tab.
- `src/runtime/runtime.ts`: secure-token `createTalaClient`, durable SQLite store, real shared `createSyncEngine`. Every teacher record write goes through `engine.put/remove`, never REST CRUD or direct table writes. API generation/copy/import returns content which the client saves through the engine.
- `src/runtime/ladder.ts`: central four-rung policy. Offline queued generation/post/import jobs need their own durable operation queue, cancellation and idempotency; do not treat disabled buttons as the offline fallback.
- `src/runtime/reference.ts`: versioned curriculum/calendar cache. Future UI must select learning areas and cache all class grades/subjects (current setup has Science as its curriculum area; typed custom subjects need proper area selection).
- `src/ui/ContentEditor.tsx`: shared structured section editor. No free-form table editor. Weekgrid → stacked days; multigrade → one block card with group activities. Consider extracting Lesson/Class/Setup into dedicated screens before adding more flows to App.
- `src/runtime/print.ts`: temporary renderer boundary; replace with Worker H's real shared renderer once its signature is available. Preserve fallback order and explicit server offer after text sharing.
- `src/runtime/history.ts`: bounded section snapshots, one per edit session. Use before regeneration/restore too.
- `src/i18n/{fil,en}.ts`: paired keys, Filipino default. Add all user-visible strings to both files.
- Native Class activity: reserved in Class; default package ID `com.hiraia.tala.next`. Nearby integration and Kotlin in-place migration are a later wave. No Kotlin source was changed.

Run only package checks: `pnpm --filter @hiraia/tala-mobile type-check`, `test`, `export`. Never run Gradle on this shared machine. Export enforces real Hermes magic/size, one font, and image size. See README for release gates and incomplete flows.
