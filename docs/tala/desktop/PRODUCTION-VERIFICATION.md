# Bounded production verification — separate from isolated CI

Luis authorized synthetic use in `rq_czqd79ie`: “Yeah of course I'm allowing the synthetics”.
Release owner design review: `46cb8899c51e4bdfa6a642546a2dd28b`. No production check has
run from this corrected harness. The actual code/workflow still needs that owner's review,
and a normal native local run must pass all three platforms before the owner pushes a
production-check tag. The publication gate is separate.

Native mode is restricted to a hand-pushed `tala-desktop-preview-production-<n>` tag,
first run attempt only, after the same job's isolated shell and real local-server checks
pass. Normal preview/release tags never run it. The source harness does not change the
shipping app, use an HTTPS interception fixture, disable TLS validation, or expose IPC.

Each platform gets one fresh account, visibly named `Synthetic Desktop Native Check
(<run>/<platform>-<arch>)`, under `desktop-native-...@example.com`. The random password
exists only in the test process and its seed subprocess environment; it is never passed
in arguments or written to evidence, artifacts, logs or GitHub secrets. Every operation
uses a fresh browser profile. The account is reused for that job's checks.

Only one standalone lesson and its own sections are created. The title ends in
`(desktop native check, synthetic test)`. The test allows at most one content-section AI
rewrite and one slide-generation request, with no retry. It applies the slide proposal,
opens the presenter and edits that new deck. There are no file uploads or R2 writes.
Seed writes are capped at eight; browser writes at 32 including its reserved cleanup
request. The main walk has a 270-second deadline, cleanup 30 seconds, shutdown five.
Daily quotas and the server's monthly budget remain enforced.

Before any live launch the seed's ten new records are validated offline by Tala's actual
schema and sync engine. Request-guard tests inject unrelated account/record writes,
uploads, malformed bodies, AI retries and cleanup at the cap. They also prove that
owner mode cannot register/delete an account or request slides. These are boundary
tests, not production evidence. `--validate-only` exits before creating any API client.

The request guard rejects other origins and any write outside the expected auth routes,
new plan/section/revision IDs, own generated deck and two allowed AI operations. It caps
registration at one. The script verifies the exact synthetic account with `auth/me`
before seeding and again before cleanup. Planned account and record identities are
written before mutation, so an abrupt process death still leaves an inventory.

Cleanup runs in `finally` while the password is still in memory. It invokes the same
authenticated account-deletion endpoint used by the settings screen, then requires 200
and a subsequent `auth/me` 401. It can only delete the new cohort account. Any uncertainty
is a failed check and is reported by exact email/id for owner inspection; there is no DB
delete or alternate cleanup route. Existing incident accounts remain untouched.

Evidence contains run/source/platform, synthetic identity, new record/deck/job IDs,
status codes, counts and outcomes only. No response bodies, model text, cookies, session
tokens, passwords or production screenshots. The release owner independently verifies
each account and its records are gone and counts the cohort's `llm_usage` calls after
the run, outside a deploy window. Expected residue is limited to hashed ended-session
tokens, rate-limit counters and the monthly spend sum, per the existing deletion proof.

For the release owner's retained account on b11-dev, `production-ai.cjs owner` instead
creates just one `(desktop real-AI check, synthetic test)` standalone lesson and performs
one content rewrite. The owner account and that labelled lesson stay for inspection.
It refuses CI and any email other than the retained synthetic release account. The
credentials remain on b11-dev; no implementation agent runs this mode against production.

The workflow's production step has the exact dedicated-tag condition and follows the
same job's successful local checks. A normal release tag cannot execute it. Re-running
a production job is refused (`GITHUB_RUN_ATTEMPT` must be 1). A new attempt requires
inspection of the prior identities/outcome and a newly reviewed tag, never a blind retry.

Owner invocation after review (credentials already exported privately):

```
TALA_DESKTOP_PRODUCTION_TEST_APPROVAL=rq_czqd79ie \
TALA_DESKTOP_OWNER_AI_CHECK=1 \
TALA_DESKTOP_PRODUCTION_RUN_ID=owner-check-20261128-1 \
node scripts/headless.cjs test/production-ai.cjs owner https://tala.hiraia.org
```

The wrapper accepts additional script arguments. Choose a unique run ID and inspect an
existing receipt before any retry; the script refuses to overwrite it or repeat that ID.
This owner check is Linux evidence, never native Windows/Mac evidence.
