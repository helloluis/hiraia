# Worker A — contract requests and notes

Owner of the contracts: the orchestrator. §1 lists what was asked for and is now in the contracts. §2 is one
decision still open. §3 is the table of exact server sync behaviour that clients rely on. §4 is smaller
open items.

## 1. Addressed (contracts on `tala-v1` as of 98e02c83b)

| Request | Outcome |
|---|---|
| The `profile` record could not sync: its fixed id (`'profile'`, 7 characters) failed `Id` (`min(8)`). | `Id` floor lowered to 1. The server seeds a profile at sign-up and a device can change it through sync. |
| Modules need to remove their per-teacher rows when an account is deleted (PRIV-6). | `ServerModule.onAccountDeleted?(deps, userId)`. The kernel runs every module's hook inside the deletion transaction; if one throws, nothing is deleted. |
| No way to fetch one older plan without another full windowed pull. | `PullQuery.planIds`. Implemented: see §3 row j. |
| A lock did not say which section versions the device saw. | `Plan.lock.sectionRevs`. Implemented: see §3 row k. |
| Emailed link paths were a private convention. | `MAIL_LINK_PATHS` in the contracts; the mailer uses it. |
| `createTestServer` was not importable from other packages. | `@hiraia/tala-server/testing` export. |
| Boolean query strings parsed `'false'` as true. | `QueryBool` (found independently by worker H). |

## 2. Decision still open: sign-up reveals that an email is registered

`auth.register` returns a session, so signing up with an address that already has an account must fail
visibly (`409 conflict`, `details.reason = 'email_taken'`). Sign-in, reset and verification reveal nothing.
Sign-up is rate limited per address. To hide it at sign-up as well, `auth.register` would have to answer
`Ok` for every address and create the session only after the emailed link is opened. That changes the
sign-up flow on web and mobile, so it is Luis's call.

## 3. Exact server sync behaviour (part of the contract)

| # | Server behaviour | Note for clients |
|---|---|---|
| a | A deleted record's `data` always fits its schema, with the words removed: learner names, day-note text, session remarks, section and section-revision content, class notes. | Never rely on a tombstone's `data`. |
| b | Delete of a record the server never had → `applied` with `record: null`. | Treat as done. |
| c | Stale delete → `conflict` with the live record (the edit wins, §10.5). | Restore the record; do not re-queue the delete. |
| d | Only `applied` results are remembered for replay, for 30 days. A replayed conflict, locked or invalid mutation is judged again. A replay after 30 days is judged again too: it meets a newer rev, comes back `conflict`, and the server already holds what was sent. | An `ask` conflict whose two sides are identical can be resolved without asking the teacher. |
| e | An edit to a part inside a lock is `locked` even if the device is also behind. Re-sending any record unchanged is `applied` with no new rev. | Avoids needless draft copies. |
| f | "Locked" means the plan carries a `lock` and is not a draft. An archived plan that keeps its lock is still locked. | Archive by changing `state` only. |
| g | While locked, the plan record may change only `placements`, `submitted`, `unitId`, and `state` between `locked` and `archived`. The lock is identified by its `revisionCode`; for the same lock the server's copy of the lock details stands (`revision`, a filled-in `lockedBy`, a corrected `lockedAt`), so a device may keep sending its own. Locking sets `aiDraft` false. Unlocking clears `lock` and `submitted`. A locked plan cannot be deleted. | Read the plan back from the push result. |
| h | A `section_revision` cannot be changed once stored (`forbidden`); an identical re-send is `applied`. It is not subject to the lock. | — |
| i | `Mutation.entity` is a strict enum, so one unknown kind fails the whole push with 400. Pull is lenient, push is not. | Open: see §4. |
| j | First sync (no cursor): tombstones are not sent; with `windowFrom`/`windowTo`, plans dated wholly outside the window are left out with their sections and section history, unless locked and dated in a term that contains the server's date give or take a day; plans with no dates are sent. The window travels inside the cursor, so later pages need not repeat it. After the first sync nothing is filtered. `planIds` (up to 50, comma-separated) returns those plans with their sections and history, deleted ones included, with its own paging token; `cursor` is `''` when there is no more, and the device's main cursor is never affected. A cursor the server cannot read means "start again". | — |
| k | When a lock carries `sectionRevs`, it is refused (`invalid`, with a message for the teacher) if any part inside the lock is at a version the device did not see, unless this same device wrote that version, or if a part it lists never reached the server. Without `sectionRevs` the lock is taken as before. | Send `sectionRevs` as the revs the device held when the teacher locked, including 0 for new parts. On refusal: take the server's draft, let the teacher check, lock again. |
| l | Deleting a plan does not delete its sections; it does remove the plan's server-side revision history. | The client deletes each record. |
| m | DOC-1 is checked at lock time with the shared `validatePlanForLock`, against the sections the server holds at that point in the batch. A failed check is `invalid` with the helper's messages. | Push sections before the plan (the outbox order already does). |

## 4. Smaller open items

- **Lenient push:** parse each mutation on its own so an unknown `entity` from a newer app is `invalid` for
  that one mutation, not a 400 for the batch (row i).
- **`TalaServerConfig`:** the trusted-proxy count is env-only (`TALA_TRUSTED_PROXY_HOPS`); a
  `network: { trustedProxyHops }` field would make it visible. A `mail` block is needed once a provider is chosen.
- **`ApiError.message` language:** plain English. Clients localise by `code` and these `details.reason`
  strings from the kernel and core: `no_credentials`, `unknown`, `expired`, `revoked`, `account_deleted`,
  `cross_site`, `body_too_large`, `not_utf8`, `invalid_json`, `content_type_must_be_json`, `bad_path`,
  `rate_limited` (with `retryAfterSeconds` when known), `email_taken`, `invalid_credentials`,
  `display_name_empty`, `password_too_short`, `password_too_common`, `password_too_simple`,
  `password_matches_account`, `link_invalid_or_expired`, `wrong_password`, `no_password`, `mail_unavailable`,
  `google_sign_in_not_available`. Validation failures carry `details.issues: [{ path, message }]`.
- **`RecordStore.get`** returns live records only (null for a deleted one); `list(…, { includeDeleted })`
  shows tombstones. **`checkTallies`** counts only accounts with a confirmed email, so one person cannot make
  a competency look widely checked by signing up many times.
