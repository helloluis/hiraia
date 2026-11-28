# Bounded production verification — separate from isolated CI

Luis authorized synthetic use in `rq_czqd79ie`: “Yeah of course I'm allowing the synthetics”.
Release owner design review: `46cb8899c51e4bdfa6a642546a2dd28b`. Owner run 2 on b11-dev
created one labelled standalone lesson, then failed before any AI request because a
standalone lesson has no Rewrite control. That run is retained in STATUS.md. This
revision reuses its exact lesson and requires owner review before execution. A normal
native local run must pass all three platforms before the owner pushes a production-check
tag. The publication gate is separate.

Native mode is restricted to a hand-pushed `tala-desktop-preview-production-<n>` tag,
first run attempt only, after the same job's isolated shell and real local-server checks
pass. Normal preview/release tags never run it. The source harness does not change the
shipping app, use an HTTPS interception fixture, disable TLS validation, or expose IPC.

Each platform gets one fresh account, visibly named `Synthetic Desktop Native Check
(<run>/<platform>-<arch>)`, under `desktop-native-...@example.com`. The random password
exists only in the test process and its seed subprocess environment; it is never passed
in arguments or written to evidence, artifacts, logs or GitHub secrets. Every operation
uses a fresh browser profile. The account is reused for that job's checks.

Native mode creates one separate labelled year, class, lesson and its own sections.
The class has zero synthetic learners and paper/pencils; no student records. The title ends in
`(desktop native check, synthetic test)`. The test allows at most one content-section AI
rewrite and one slide-generation request, with no retry. It applies the slide proposal,
opens the presenter and edits that new deck. There are no file uploads or R2 writes.
Seed writes are capped at eight; browser writes at 32 including its reserved cleanup
request. The main walk has a 270-second deadline, cleanup 30 seconds, shutdown five.
Daily quotas and the server's monthly budget remain enforced.

Before any live launch the seed's twelve new records are validated offline by Tala's actual
schema and sync engine. The same fixture also runs in the isolated local UI walk, which
requires the Content textbox and its Rewrite button. Request-guard tests inject unrelated account/record writes,
uploads, malformed bodies, AI retries and cleanup at the cap. They also prove that
owner mode cannot register/delete an account or request slides. These are boundary
tests, not production evidence. `--validate-only` exits before creating any API client.

The request guard rejects other origins and any write outside the expected auth routes,
own plan/section/revision IDs, own generated deck and two allowed AI operations. It caps
registration at one. The script verifies the exact synthetic account with `auth/me`
before seeding and again before cleanup. Planned account and record identities are
written before mutation, so an abrupt process death still leaves an inventory.

The actual web apply helper and sync engine submit eleven mutations for a Content
rewrite: all nine sections, one new Content history record and one plan. Eight section
data digests must remain unchanged. The guard requires precisely that batch once; only
Content can change, history must contain its prior content, and the plan must match its
expected data with `aiDraft`/`aiAssisted` true. It rejects profile, class, year and other
record writes from the browser. The seed separately allows exact new year/class data
and the named plan; no profile operation exists. A 200 sync response must acknowledge
all eleven mutations as `applied`. The offline check uses a synthetic model response
and memory transport, so it is contract evidence, not a successful real-AI call.

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

For the release owner's retained account on b11-dev, `production-ai.cjs owner` requires
the reviewed run-2 receipt via `TALA_DESKTOP_OWNER_RESUME_REPORT`. It refuses a prior AI
submission, uncertain seed or already-linked fixture. It hydrates only that exact plan
and its nine sections; it does not copy the account's library. It creates one new labelled
year/class and links the existing test plan by changing only `placements` and
`gradeGroupIds`, then performs one Content rewrite. The new year label is exactly
`(desktop real-AI check, synthetic test)` (within the 40-character schema limit).
The owner's pinned active school year and profile remain unchanged. The owner account,
existing lesson, new labelled year and class all stay for inspection; no owner-mode
deletion occurs. Native mode deletes these records with its ephemeral account.
It refuses CI and any email other than the retained synthetic release account. The
credentials remain on b11-dev; no implementation agent runs this mode against production.

The workflow's production step has the exact dedicated-tag condition and follows the
same job's successful local checks. A normal release tag cannot execute it. Re-running
a production job is refused (`GITHUB_RUN_ATTEMPT` must be 1). A new attempt requires
inspection of the prior identities/outcome and a newly reviewed tag, never a blind retry.

**Executed once and consumed:** owner run 3 passed on 28 November 2026. The reused
lesson is now linked and rewritten. Do not replay the invocation below with the run-2
receipt. Any new owner check requires a new reviewed design. Native production check 1
also passed on all three OS/architecture combinations; all three ephemeral accounts
were deleted and audited. See [STATUS.md](STATUS.md) and [CANDIDATE.md](CANDIDATE.md).

Historical owner invocation (credentials remained on b11-dev):

First run `node test/linux-preflight.cjs` without credentials. It inspects the exact
Electron binary with `ldd`, prints only unresolved library names, and exits 2 if any
are missing (success is silent, exit 0). It makes no network request and honours an
existing private `LD_LIBRARY_PATH`; it never installs or changes system packages.
Owner mode runs this preflight itself before reading credentials, creating a profile
or launching Electron. If `ldd` itself fails, a fixed error is printed, without its
raw output. A deliberate missing-library control proves owner mode stops there.

```
TALA_DESKTOP_PRODUCTION_TEST_APPROVAL=rq_czqd79ie \
TALA_DESKTOP_OWNER_AI_CHECK=1 \
TALA_DESKTOP_HEADLESS=1 \
TALA_DESKTOP_OWNER_RESUME_REPORT=/owner/private/path/to/reviewed-run-2-receipt.json \
TALA_DESKTOP_PRODUCTION_RUN_ID=owner-check-20261128-3 \
node test/production-ai.cjs owner https://tala.hiraia.org
```

On Linux, `TALA_DESKTOP_HEADLESS=1` selects Electron's documented
[`--ozone-platform=headless`](https://github.com/electron/electron/blob/main/docs/api/command-line-switches.md#--ozone-platformplatform-linux)
backend at launch, without a display server or sandbox/security changes. This test-only
option is not added to the shipping app or the Windows/macOS production invocation.
If a display server is already available, omit that variable. Choose a unique run ID and inspect an
existing receipt before any retry; the script refuses to overwrite it or repeat that ID.
This owner check is Linux evidence, never native Windows/Mac evidence.

On failure, the receipt identifies the precise UI step and selector match/visibility
counts, without page text, response bodies or screenshots. A failed run with new fixture
identities must be inspected before another run; never point the next attempt blindly at
the old standalone receipt. The seed also refuses a plan already linked to a class.

The server's existing gateway can repair malformed model output internally. The
harness caps API job submissions and never retries them; the release owner's
`llm_usage` inspection records actual provider-call counts, including gateway repair.
