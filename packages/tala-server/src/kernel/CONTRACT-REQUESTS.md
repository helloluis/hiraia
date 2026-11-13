# Worker A — contract requests and notes

Owner of the contracts: the orchestrator. §1 lists what was asked for and is now in the contracts. §2 is one
decision still open. §3 is the table of exact server sync behaviour that clients rely on. §4 is smaller
open items.

## 1. Addressed (contracts on `tala-v1` as of f74e680eb)

| Request | Outcome |
|---|---|
| The `profile` record could not sync: its fixed id (`'profile'`, 7 characters) failed `Id` (`min(8)`). | `Id` floor lowered to 1. The server seeds a profile at sign-up and a device can change it through sync. |
| Modules need to remove their per-teacher rows when an account is deleted (PRIV-6). | `ServerModule.onAccountDeleted?(deps, userId)`. The kernel runs every module's hook inside the deletion transaction; if one throws, nothing is deleted. |
| No way to fetch one older plan without another full windowed pull. | `PullQuery.planIds`. Implemented: see §3 row j. |
| A lock did not say which section versions the device saw. | `Plan.lock.sectionRevs`. Implemented: see §3 row k. |
| Emailed link paths were a private convention. | `MAIL_LINK_PATHS` in the contracts; the mailer uses it. |
| `createTestServer` was not importable from other packages. | `@hiraia/tala-server/testing` export. |
| Boolean query strings parsed `'false'` as true. | `QueryBool` (found independently by worker H). |
| Routes for Google account linking and account merging (PRD §13.3 cases 1, 3, 4, 5). | `auth.googleLink`, `auth.googleLinkRequest`, `auth.googleLinkConfirm`, `auth.googleConnect`, `auth.googleDisconnect`, `auth.removePassword`, `account.merge` are in `API` exactly as specified. The handlers are registered like any others; the scaffolding that carried them ahead of the contract is removed. |
| Path of the page behind the "connect Google" emailed link. | `MAIL_LINK_PATHS.linkGoogle = '/link-google'`. |
| Modules need to hand their per-teacher rows over when two accounts are merged. | `ServerModule.onAccountMerged?(deps, fromUserId, toUserId)`. Until every module that has `onAccountDeleted` also has it, `account.merge` answers `503 merge_not_available` and names the modules. |
| `Mailer` could not send the link mail. | `'link_google'` template in the `Mailer` contract. |

## 1a. Google sign-in, linking and merging: what clients see

The routes, the `/link-google` page path, `ServerModule.onAccountMerged` and the `link_google` mail template
asked for in wave 2 are all in the contract now (table in §1). These are the answers a client has to handle:

| Situation | Answer |
|---|---|
| Google sign-in switched off (`auth.google`, the three link routes, `auth.googleConnect`, `auth.removePassword`, merge by `idToken`) | `501 not_implemented`, `google_sign_in_not_available`. `auth.googleDisconnect` and merge by email and password still work. |
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

## 2a. Open items for Luis from Google sign-in

- **A Google-only account can be deleted with the session and the word `DELETE` alone.** `account.delete` has
  no field for a fresh Google proof, so a borrowed, still signed-in device is enough. Closing it needs an
  optional `idToken` on `account.delete`.
- **Lapsed email ownership.** Someone holding a Google account whose confirmed email they no longer control can
  create a Tala account under that address. If the real mailbox owner later uses "Forgot password", they get
  in, but the Google link stays attached. Closing it means removing Google links on a password reset, which
  would also hit the ordinary case of a teacher who simply forgot their password.
- **Joining accounts asks for both passwords** (decided: keep). Without the signed-in account's own password, a
  borrowed signed-in device could merge another account in and inherit its Google link as a permanent way in.

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
