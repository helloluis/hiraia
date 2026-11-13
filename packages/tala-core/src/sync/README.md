# Sync adapter integration

Import `createSyncEngine` and `createMemoryStore` from `@hiraia/tala-core/sync`.
Pass `createTalaClient(...).syncTransport`; the engine deliberately does not own timers,
network detection or backoff. Retry `sync()` on the caller's background schedule.
One engine owns a store. Recreate it after clearing the store or switching accounts.

Every LocalStore `commit` must be atomic, including metadata. Keys:

- `sync.mutation.<mutationId>`: exact immutable mutation payload and merge base. Retain across restart.
- `sync.cursor`, `sync.lastSyncedAt`: server progress.
- `sync.rejected.<recordId>`: terminal rejection (entity, status, mutation id). Text stays in the dirty local record; another edit queues a new attempt and clears this marker. If a server version exists the record also has `conflict`.

The runtime report adds `rejected` and `skipped` counts (`DetailedSyncReport` extends
`SyncReport`); `conflicts` counts rejections as well as teacher-choice conflicts for
that cycle. Rejected work is not retried automatically. Unknown pull entities or
unreadable future record shapes are skipped, and the cursor advances; an upgraded
client should clear `sync.cursor` to rehydrate these records. Response validation
must be disabled for sync pulls on `createTalaClient` (`validateResponses: false`)
so future entities reach this compatibility boundary rather than failing in the
transport's old schema.

The memory adapter is intentionally ephemeral. Use IndexedDB/SQLite for acknowledged
saves that must survive page reload or process death. Test fakes implement server
revision checks, idempotency, edit-vs-delete and locked-section rules; production
server integration remains a separate gate.
