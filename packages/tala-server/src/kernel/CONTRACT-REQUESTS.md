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

## 1a. New in wave 2: needed for Google account linking and merging (PRD §13.3)

Everything below is implemented and tested. The handlers switch on by themselves when the contract gains a
route with the same name; until then no real server exposes them.

### Routes to add to `API` (exact specs, as code, in `src/modules/core/pending-routes.ts`)

| Name | Method and path | Auth | Body | Response | §13.3 case |
|---|---|---|---|---|---|
| `auth.googleLink` | `POST /auth/google/link` | none | `{ idToken: string ≤4000, password: string ≤200, deviceLabel: string ≤80 = '' }` | `AuthResult` | 1 (password) |
| `auth.googleLinkRequest` | `POST /auth/google/link/request` | none | `{ idToken }` | `Ok` (always) | 1 (emailed link) |
| `auth.googleLinkConfirm` | `POST /auth/google/link/confirm` | none | `{ token: string 6–200 }` | `Ok` | 1 (emailed link) |
| `auth.googleConnect` | `POST /auth/google/connect` | user | `{ idToken, password }` | `{ user: User }` | 3 |
| `auth.googleDisconnect` | `POST /auth/google/disconnect` | user | `{ password }` | `{ user: User }` | 5 |
| `auth.removePassword` | `POST /auth/password/remove` | user | `{ currentPassword }` | `{ user: User }` | 5 |
| `account.merge` | `POST /account/merge` | user | `{ confirm: 'MERGE', currentPassword?, email?, password?, idToken? }` | `{ user: User, movedRecords: int }` | 4 |

Copy the entries of `PENDING_ROUTES` into `API` wrapped in `route(...)`; all are `owner: 'core'`.

### Other contract additions

- **`MAIL_LINK_PATHS.linkGoogle = '/link-google'`**. The page reads `#token=…` and posts it to
  `auth.googleLinkConfirm`. Until it is in the contract the mailer uses that literal path.
- **`ServerModule.onAccountMerged?: (deps: BaseDeps, fromUserId: Id, toUserId: Id) => void`**. Runs inside the
  merge transaction; synchronous. Move (or remove) the module's rows for `fromUserId` so they belong to
  `toUserId`. **A module with `onAccountDeleted` and no `onAccountMerged` blocks `account.merge`**
  (`503`, `details: { reason: 'merge_not_available', modules: [...] }`), because its rows would be orphaned
  or have to be deleted. Today that is `community`, `generation`, `llm` and `roster`. Suggested behaviour:
  community re-points `author_id`, copies and reports to the surviving account (attribution text unchanged);
  generation, llm and roster may simply delete, as on account deletion.
- **`Mailer` template `'link_google'`** (vars `displayName`, `googleEmail`, `link`). Core sends it through its
  own mailer today; adding it to the `Mailer` interface would let a production transport handle it uniformly.

### What clients see (all `details.reason` values)

| Situation | Answer |
|---|---|
| Google sign-in switched off | `501 not_implemented`, `google_sign_in_not_available` |
| Switched on, `GOOGLE_OAUTH_CLIENT_ID` missing | `503 unavailable`, `google_not_configured` |
| Google's keys cannot be fetched | `503 unavailable`, `google_unreachable` (offer email and password) |
| Token refused (signature, audience, issuer, expiry, shape) | `401 unauthenticated`, `google_token_invalid` |
| Google has not confirmed the Google account's email | `403 forbidden`, `google_email_not_verified` |
| A confirmed Tala account has this email | `409 conflict`, `link_required`, `methods: ['password', 'email_link']` |
| A Tala account has this email but never confirmed it | `409 conflict`, `verify_email_first` |
| The Tala account already has a (different) Google account | `409 conflict`, `google_already_linked` |
| That Google account belongs to another Tala account | `409 conflict`, `google_in_use` |
| `auth.googleLink` for an address with no Tala account | `409 conflict`, `no_account_to_link` |
| Removing the only way into an account | `403 forbidden`, `last_sign_in_method` |
| Wrong password where one is asked again | `403 forbidden`, `wrong_password` (`401 invalid_credentials` on `auth.googleLink`) |
| Merge: other account not proven / same account / nothing given | `403 other_account_not_proven` / `400 same_account` / `400 merge_proof_missing` |
| A device of an account that was merged away | `401 unauthenticated`, `account_merged` (do not wipe unsent work; sign in to the other account) |

Web and mobile each need: a "Continue with Google" button that posts the ID token to `auth.google`; a
"connect" step that handles `link_required` (password field, or "email me a link"); the `/link-google` page;
and connect / disconnect / remove password / join accounts in Settings.

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
