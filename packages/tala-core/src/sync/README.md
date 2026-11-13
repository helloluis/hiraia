# Sync adapter integration

Import `createSyncEngine` and `createMemoryStore` from `@hiraia/tala-core/sync`.
Pass `createTalaClient(...).syncTransport`; the engine deliberately does not own timers,
network detection or backoff. Retry `sync()` on the caller's background schedule.
One engine owns a store. Recreate it after clearing the store or switching accounts.

Every LocalStore `commit` must be atomic, including metadata. Keys:

- `sync.mutation.<mutationId>`: exact immutable mutation payload and merge base. Retain across restart.
- `sync.cursor`, `sync.lastSyncedAt`: server progress.
- `sync.rejected.<recordId>`: terminal rejection (entity, status, mutation id). Text stays in the dirty local record; another edit queues a new attempt and clears this marker. If a server version exists the record also has `conflict`.

`SyncReport` includes `rejected` and `skipped` counts; `conflicts` counts rejections as well as teacher-choice conflicts for
that cycle. Rejected work is not retried automatically. Unknown pull entities or
unreadable future record shapes are skipped, and the cursor advances; an upgraded
client should clear `sync.cursor` to rehydrate these records. Response validation may stay enabled: the shared `WireRecord` contract tolerates future entity names and data shapes. The engine validates each record individually.

The memory adapter is intentionally ephemeral. Use IndexedDB/SQLite for acknowledged
saves that must survive page reload or process death. Test fakes implement server
revision checks, idempotency, edit-vs-delete and locked-section rules; production
server integration remains a separate gate.

Deletion semantics: `commit.remove` must physically delete rows in the same
transaction as queue/cursor updates. Acknowledged deletions and pulled tombstones
purge record data; `sync.deleted.<entity>.<id>` retains only the server revision
so old pull replays cannot resurrect the record. `get` and `list` never expose
deleted records. A live local edit survives a remote tombstone; a stale local
delete yields to a live server edit. An applied/null delete acknowledges a record
the server never saw and purges its local tombstone.
