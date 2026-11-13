# Worker A — contract requests and notes

Owner of the contracts: the orchestrator. Each item says what is needed, why, and what the server does
meanwhile. Items marked **blocking** stop something from working end to end.

## 1. **Blocking:** the `profile` record cannot travel through sync

`TeacherProfile.id` is `z.literal('profile')` (7 characters). `Id` is `z.string().min(8)`. Every sync
envelope uses `Id`:

- `Mutation.id` → a device cannot push its profile: the whole `sync.push` request is a 400.
- `RecordEnvelopeSchema.id` → `account.export` and `MutationResult.record` fail validation for a profile.
- The client engine parses pulled records with `RecordEnvelopeSchema` and skips the profile.

**Change needed (either one):** lower `Id` to `min(1)` (it is only a sanity floor), or give the profile a
literal of 8+ characters and tell D, E and H.

**Meanwhile:** the server does not create a profile record at sign-up. It checks the contract at start
(`Id.safeParse(<the literal>)`) and starts seeding it by itself once the two agree, so no change is
needed here afterwards. Server-side `records.put(owner, 'profile', …)` works today, and keeps the
account's name and language in step with the profile.

## 2. Decision needed: sign-up reveals that an email is registered

`auth.register` returns a session, so signing up with an address that already has an account must fail
visibly (`409 conflict`, `details.reason = 'email_taken'`). Sign-in, reset and verification reveal nothing.
Sign-up is rate limited per address. To hide it at sign-up as well, `auth.register` would have to answer
`Ok` for every address and only create the session after the emailed link is opened.

## 3. `ServerModule`: account-deletion hook

PRIV-6 says deleting an account removes everything. Core removes records, revisions, sessions, tokens and
mail. Other modules hold per-teacher rows too (generation jobs, roster import drafts, community posts,
LLM usage). **Add to `ServerModule`:**

```ts
/** Remove everything this module stores for a deleted account. Runs inside the deletion transaction; synchronous. */
onAccountDeleted?: (deps: BaseDeps, userId: Id) => void;
```

**Meanwhile** the kernel already calls it when a module carries it under a `kernel` property
(`ExtendedModule` in `kernel/auth.ts`): `kernel: { onAccountDeleted(deps, userId) { … } }`. Workers C, F
and G can add that today. The same property carries `authenticator`, which only core uses.

## 4. Sync rules the server follows that `contracts/sync.ts` does not spell out

Worth stating in the contract, because the client engine depends on each of them:

| # | Server behaviour | Note for the client engine |
|---|---|---|
| a | A deleted record's `data` always fits its schema, with the words removed: learner names, day-note text, session remarks, section and section-revision content, class notes. | Never rely on a tombstone's `data`. |
| b | Delete of a record the server never had → `applied` with `record: null`. | The engine treats applied-with-null as a rejection today; it should treat it as done. |
| c | Stale delete → `conflict` with the live record (the edit wins, §10.5). | The engine re-queues the delete at the new rev for `merge_fields` entities, so the delete wins. It should restore the record. |
| d | Only `applied` results are remembered for replay. A replayed conflict, locked or invalid mutation is evaluated again. | None. |
| e | An edit to a part inside a lock is `locked` even if the device is also behind. Re-sending a part unchanged is `applied` with no new rev. | Avoids needless draft copies. |
| f | "Locked" means the plan carries a `lock` and is not a draft. An archived plan that keeps its lock is still locked. | Archive by changing `state` only. |
| g | While locked, the plan record may change only `placements`, `submitted`, `unitId`, and `state` between `locked` and `archived`. `lock.revision` is the server's (a device may keep sending null). Locking sets `aiDraft` false and fills an empty `lockedBy` with the account name. Unlocking clears `lock` and `submitted`. | Read the plan back from the push result. |
| h | A `section_revision` cannot be changed once stored (`forbidden`); an identical re-send is `applied`. | — |
| i | `Mutation.entity` is a strict enum, so one unknown kind fails the whole push with 400. Pull is lenient, push is not. | Suggest lenient parsing, answering `invalid` for that one mutation. |
| j | First-sync window: plans with no dates are sent; "the current term" is any term of the teacher's school years that contains the server's date, give or take a day. | There is no way to fetch one old plan on demand except another windowed pull (which re-sends all non-plan records). Suggest an optional entity/plan filter. |
| k | A lock does not say which section versions the device saw. If another device's edits were synced first, the lock snapshot includes them. | Could be closed with `lock.sectionRevs`. |
| l | Deleting a plan does not delete its sections. | The client deletes each record. |

## 5. Smaller items

- **`package.json` exports:** add `"./testing": "./src/testing/index.ts"` so the web worker can use
  `createTestServer` in its own tests.
- **`TalaServerConfig`:** the trusted-proxy count is env-only (`TALA_TRUSTED_PROXY_HOPS`); a
  `network: { trustedProxyHops }` field would make it visible. A `mail` block is needed once a provider is chosen.
- **Emailed link paths** (`/verify-email#token=…`, `/reset-password#token=…`) are a convention between core
  and the web app. They live in `modules/core/mailer.ts` (`MAIL_LINK_PATHS`); they belong in the contracts.
- **`ApiError.message` language:** server messages are plain English. Clients localise by `code` and the
  stable `details.reason` strings core sends (`email_taken`, `invalid_credentials`, `password_too_common`,
  `password_too_simple`, `password_matches_account`, `link_invalid_or_expired`, `wrong_password`,
  `rate_limited`, `account_deleted`, `revoked`, `expired`, `no_credentials`, `cross_site`, `body_too_large`).
- **`RecordStore.get`** returns live records only (null for a deleted one); use `list(…, { includeDeleted })`
  to see tombstones. **`checkTallies`** counts only accounts with a confirmed email.
