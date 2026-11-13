# Contract requests from worker D (web)

1. **`SyncEngine.sync(opts)` — add `planIds?: string[]`.** The server's `PullQuery.planIds` exists for "open an
   older plan" (outside the offline window) but the client engine's `sync()` only takes `windowFrom/windowTo`, so
   the web app cannot ask for one plan without moving the main cursor. Proposed: `sync(opts?: { windowFrom?; windowTo?;
   planIds?: string[] })`, forwarded to `transport.pull`, with the cursor left untouched when `planIds` is given.
   Until then the editor shows "This lesson is not on this device." for such plans.

2. **`TeacherProfile.dataSaver` and `uiLanguage` are per account; the web app also keeps them per device**
   (`localStorage`) so they apply before sign-in and offline. No change needed; noting the dual source.

3. **Realignment "pending" state.** There is no record that says a teacher-entered non-teaching day has not yet
   been fitted (§7.6 "Needs attention: disruptions not yet realigned"). The web app keeps that list per device in
   its cache (`realign.pending`). A synced flag on `CalendarDay` (e.g. `realigned: boolean`) would make it follow
   the teacher across devices.

4. **`print.planPdf` query `images`** is accepted but V1 content has no images; harmless.
