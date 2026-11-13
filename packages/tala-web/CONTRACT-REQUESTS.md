# Contract requests from worker D (web)

Resolved on tala-v1: `SyncEngine.fetchPlans` and `SyncEngine.batch` (both used), `CalendarDay.realigned` (the week's
"needs attention" list now reads it instead of a per-device cache), `GenerationInput.idempotencyKey` (sent on every
`generation.create`), `RosterConfirmRequest.idempotencyKey` (sent on confirm).

Open:

1. **Plan ↔ artifact link.** After a post, the client has no record of the artifact id on the plan, so "post a new
   version" and "open my post from this lesson" depend on the server matching by plan. A `Plan.artifactId`
   (nullable, server-written or client-written from the post response) would make both explicit.
2. **`TeacherProfile.dataSaver` / `uiLanguage`** are per account; the web also keeps them per device so they apply
   before sign-in and offline. No change needed; noting the dual source.
3. **`print.planPdf` query `images`** is accepted but V1 content has no images; harmless.
