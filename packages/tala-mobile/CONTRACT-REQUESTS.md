# Worker E integration requests

1. RESOLVED: Worker H's shared print renderer and plan helpers are now integrated directly with their real typed signatures. There is no temporary print implementation left. Shared template/header/font/paper helpers power on-device and plain-text fallbacks.
2. `LocalStore.commit` can atomically write multiple records, but `SyncEngine` exposes only individual `put/remove`. A client-level durable multi-record operation (batch or operation journal) is needed for creation/setup/realignment so a killed process can resume the whole operation and Undo can be atomic. Current app individual records/outbox are atomic, not whole multi-record operations.
3. Conflict wire metadata has server time/revision but no device label. Mobile can say “This phone / Other phone” and show timestamps; exact originating device labels require metadata on the conflict envelope.
4. The installed RN 0.81.5 source declares `minSdk = 24` in `react-native/gradle/libs.versions.toml`, below Android 8/API 26. Actual Expo/SQLCipher/background-task compatibility and performance on Android 8 still require the native reference-device spike; a JS export does not verify them. No native builds were run, per instructions.

No contracts were edited by Worker E. Sync and pacing use the real shared implementations, not fakes. The sample curriculum pack/calendar are explicitly fictional demonstration fixtures only.

5. Older-plan hydration: PullQuery now supports planIds, but SyncTransport.pull and SyncEngine.sync options still expose only cursor/limit/window bounds. Please add a shared `fetchPlans(planIds)` (or equivalent) operation that uses typed sync.pull, hydrates records through the normal engine compatibility/conflict rules, paginates if necessary, and leaves sync.cursor unchanged. Mobile should not put remote snapshots through engine.put (which queues them as local changes) or bypass the engine with raw SQLite writes. Server implementation of the filter is also required as announced by A. No single-plan REST fetch route is assumed.

Server-sync compatibility table (§4 of A's notes) was read. Physical LocalStore.remove already works atomically. Applied-null deletes, stale-delete restoration and blanked tombstone handling belong to the shared engine/H; mobile does not fork those policies. Lock/unlock and localised error handling have been updated in the app.
