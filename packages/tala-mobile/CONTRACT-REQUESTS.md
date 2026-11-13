# Worker E integration requests

Resolved: shared print/plan helpers, required SyncEngine.batch, fetchPlans, LocalStore.commit.remove, section_revision, before_tala, CalendarDay.realigned and GenerationInput.idempotencyKey are integrated. The merged server implements generation idempotency; every new mobile request supplies a stable key, including lost-response retries. No contracts were edited here.

Remaining optional metadata request: conflict envelopes expose server time/revision but no originating device label. Mobile uses “This phone / Other phone”; exact labels require a contract addition.

Native verification is a release gate, not a contract blocker: RN minSdk24 permits Android8/API26, but SQLCipher, background scheduling and resource budgets still require the reference phone. No native build was run.

All logical multi-record feature saves use the real shared batch. Older-plan hydration uses fetchPlans; no direct database hydration or invented plan route exists. Applied-null deletes, blanked tombstones and stale-delete restoration stay in the shared engine. Tests use isolated fake network transports only.
