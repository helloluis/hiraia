# Tala server kernel

`createTalaServer()` returns `{ handle(request: Request): Promise<Response>, close(), config }`. `handle` takes and
returns Web Fetch objects, so the same server runs inside the Next.js route handler and behind the standalone
dev server (`src/dev-server.ts`).

```ts
import { createTalaServer, getTalaServer } from '@hiraia/tala-server';

const server = createTalaServer();                 // environment → config → database → migrations → modules
const response = await server.handle(request);     // optional second argument: { ip } when the adapter knows it
server.close();

getTalaServer();                                   // one shared instance per process (use this from Next.js)
```

`better-sqlite3` and `@node-rs/argon2` are native modules. In Next.js list both in `serverExternalPackages`.

## Running the dev server

```bash
pnpm install --filter "@hiraia/tala-server..."        # once, from the repository root

pnpm --filter @hiraia/tala-server dev                 # watches and restarts: tsx watch src/dev-server.ts
pnpm --filter @hiraia/tala-server exec tsx src/dev-server.ts    # one run, no watcher

TALA_PORT=8790 pnpm --filter @hiraia/tala-server dev  # another port (default 8787)
```

It prints `Tala API (local) on http://127.0.0.1:8787/api/v1 · database: <path>` and serves every route in the
contract. With no variables set it runs in `local` mode on a private SQLite file under this package's
`node_modules/.cache`, calls no model provider, and sends no mail.

- Check it: `curl http://127.0.0.1:8787/api/v1/config`
- Read the mail it "sent" (verification, reset and link mails are written to a table instead):
  `pnpm --filter @hiraia/tala-server exec tsx src/modules/core/tools/outbox.ts`
- Start again from nothing: stop it and delete the database file it printed.
- It listens on 127.0.0.1 only. Set `TALA_HOST` to reach it from a phone on the same network.
- Before starting, make sure the port is free (`ss -tlnp | grep 8787`); it stops with a clear message if not.

## What happens to a request

1. The path is matched against the `API` table in `@hiraia/tala-core`. Nothing outside the table exists.
   Unknown path → 404, wrong method → 405, a route with no handler yet → 501 `not_implemented`.
2. A state-changing request that carries an `Origin` other than ours (or `Sec-Fetch-Site: cross-site`) → 403.
3. The session is read from `Authorization: Bearer …` (mobile) or the session cookie (web). Routes marked
   `auth: 'user'` answer 401 without one; `details.reason` says why (`no_credentials`, `unknown`, `expired`,
   `revoked`, `account_deleted`).
4. Path parameters, query and JSON body are validated with the route's zod schemas. Bodies are size-limited
   while they are read (64 KB signed out, 1 MB signed in, more for `sync.push` and `roster.import`).
5. The handler runs. `throw new HttpError(code, plainMessage, details?)` for expected failures.
6. The result is validated against the route's response schema. Keys the contract does not name are
   stripped; a wrong shape is a 500 and a `response_contract_violation` log entry.

Every error body is `{ error: { code, message, details? } }`. Messages are plain English and safe to show;
clients localise by `code` and `details.reason`.

## Writing a module

```ts
export const myModule: ServerModule = {
  name: 'community',
  migrations: [{ id: 'community:001_init', sql: `CREATE TABLE community_artifacts (…) STRICT;` }],
  handlers: { 'community.search': (ctx, { query }) => … },
  services: (base) => ({ … }),             // optional: what this module offers through ctx.services
  start: (deps) => () => {},               // optional: timers and job runners; return a stop function
  onAccountDeleted: (deps, userId) => {},  // delete this module's rows for a deleted account (PRIV-6)
  onAccountMerged: (deps, from, to) => {}, // hand this module's rows to another account of the same teacher (§13.3 case 4)
};
```

- `onAccountDeleted` runs once per module inside the deletion transaction (also when a module still sets it
  under `kernel`). If it throws, the account is not deleted. A module that has it but no `onAccountMerged`
  blocks account merging: its rows would otherwise be orphaned or lost.

- Migrations run once, in order, each in its own transaction, and are recorded with a checksum. An applied
  migration that was edited stops the server at start: add a new one instead. Ids must be
  `<module>:<3 digits>_<name>`, ascending.
- Two modules claiming one route, or a handler for a route that is not in the table, stop the server at start.
- `ctx.log` only accepts short primitive fields, redacts field names that suggest content or credentials, and
  cuts strings at 200 characters. Do not try to work around it: logs must not hold lesson text, class lists,
  prompts, model output, tokens or email addresses (PRD §14.4).
- `ctx.services.rateLimit.take(key, limit, windowSeconds)` is durable and stores only a hash of the key.
- Tests: `createTestServer` in `src/testing` (see its README).

## Environment variables

Names only are ever printed in errors; values are not. Everything has a safe local default.

| Variable | Default | Meaning |
|---|---|---|
| `TALA_ENV` | `local` | `local`, `staging` or `production`. |
| `TALA_DB_PATH` | `node_modules/.cache/tala/local.sqlite` under the working directory | SQLite file. **Required** outside local. Created with owner-only permissions. |
| `TALA_PUBLIC_ORIGIN` | `http://localhost:3000` (local), `https://tala.hiraia.org` (production) | Origin of the web app. **Required** in staging. Used for emailed links, the cookie's `Secure` flag, the cross-site check and HSTS. Must be https in production. |
| `TALA_PORT`, `TALA_HOST` | `8787`, `127.0.0.1` | Dev server only. |
| `TALA_TRUSTED_PROXY_HOPS` | `0` (local), `1` (staging, production) | How many reverse proxies in front of the server are ours. With 0, `X-Forwarded-For` is ignored. With n, the n-th entry from the right is the client address used for abuse limits. Set it to match the real chain (for example 2 behind a CDN and nginx). If it is too low every client looks like one address; limits then use a much wider shared bucket instead of locking everyone out. |
| `TALA_LOG_LEVEL` | `info` | `info`, `warn`, `error` or `silent`. Logs are JSON lines on stdout. |
| `TALA_SESSION_TTL_DAYS` | `90` | Sliding session lifetime. At least 31 outside local, so a phone stays signed in through 30 days offline (OFF-5). |
| `TALA_SESSION_COOKIE` | `__Host-tala_session` on https, `tala_session` on http | Cookie name. |
| `GOOGLE_OAUTH_CLIENT_ID` | — | Client id(s) a Google ID token must be issued for; several (web, Android) separated by commas. Needed when `TALA_FEATURE_GOOGLE_SIGNIN` is on; without it Google sign-in answers "not set up". |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Not read by this server: verifying an ID token needs no secret. Listed because the PRD (AUTH-12) names it for the web app's own Google set-up. |
| `DEEPSEEK_API_KEY` | — | Primary model key. Read by the gateway at call time; the config holds only this name. |
| `DASHSCOPE_API_KEY` (or `ALIBABACLOUD_API_KEY`) | — | Fallback model key, same rule. |
| `TALA_LLM_PRIMARY_MODEL`, `TALA_LLM_FALLBACK_MODEL` | empty | Model identifiers. Deliberately no built-in guess: empty means not configured. |
| `TALA_LLM_PRIMARY_BASE_URL`, `TALA_LLM_FALLBACK_BASE_URL` | DeepSeek's and DashScope's own API endpoints | Direct provider APIs only, never an aggregator. **[verify]** against each provider's current documentation. |
| `TALA_LLM_LOCAL_ENDPOINT`, `TALA_LLM_LOCAL_MODEL`, `TALA_LLM_LOCAL_API_KEY` | — | Hiraia-hosted model. Both of the first two must be set. |
| `TALA_LLM_<PRIMARY\|FALLBACK\|LOCAL>_INPUT_USD_PER_MILLION`, `…_OUTPUT_USD_PER_MILLION` | unset (unpriced) | Prices for the budget ceiling. Both or neither. |
| `TALA_LLM_TIMEOUT_MS` | `60000` | Per provider call. |
| `TALA_ROSTER_LLM_ROUTE` | `cloud` before production; in production `local` if a local model is configured, else `rules` | Route for roster cleaning. **`cloud` is refused in production** whatever is set (§12.4.1). |
| `TALA_LLM_ROUTE_<FEATURE>` | `cloud` | Per-feature route: `cloud`, `local`, `rules`, `off`. Feature name upper-cased with `_`, e.g. `TALA_LLM_ROUTE_LESSON_GENERATE`. |
| `TALA_PROMPT_VERSIONS` | empty | Active prompt versions, e.g. `lesson/multigrade=3,roster/names=2`. |
| `TALA_QUOTA_FULL_PER_DAY`, `TALA_QUOTA_SECTION_PER_DAY` | `20`, `60` | Per-teacher generation allowances. Placeholders until alpha measurements. |
| `TALA_BUDGET_MONTHLY_USD`, `TALA_BUDGET_ALERT_USD` | `50`, 80% of the ceiling | Model spend ceiling and alert. Placeholders. |
| `TALA_LLM_CACHE_SECONDS` | `300` | Identical-request cache window. |
| `TALA_MODERATION_ENABLED`, `TALA_MODERATION_GUIDELINE_VERSION`, `TALA_MODERATION_AUTOHIDE_PERSONAL_DATA` | `true`, `1`, `true` | Community moderation switches. |
| `TALA_LIMIT_ROSTER_ROWS`, `TALA_LIMIT_ROSTER_FILE_BYTES`, `TALA_LIMIT_ATTACHMENT_BYTES`, `TALA_PAGE_SIZE` | `500`, 5 MB, 5 MB, `20` | Limits. The first, second and fourth cannot exceed the contract's own limits. |
| `TALA_OFFLINE_WEEKS_BACK`, `TALA_OFFLINE_WEEKS_AHEAD` | `4`, `8` | Plan window kept on a device. |
| `TALA_SLOW_RESPONSE_MS`, `TALA_RETRY_MAX`, `TALA_RETRY_BASE_MS`, `TALA_RETRY_CAP_MS` | `3000`, `5`, `1000`, `60000` | Client resilience settings, served by `config.get`. |
| `TALA_ABUSE_REGISTER_PER_IP_PER_HOUR`, `TALA_ABUSE_LOGIN_PER_IP_PER_MINUTE` | `60`, `30` | Per-address limits. Generous because a whole school often shares one connection. |
| `TALA_ABUSE_POST_PER_USER_PER_DAY`, `TALA_ABUSE_REPORT_PER_USER_PER_DAY` | `20`, `20` | Community limits. |
| `TALA_CURRICULUM_CONFIRMATIONS_TO_MARK_CHECKED`, `TALA_CURRICULUM_CORRECTIONS_TO_REVIEW` | `1`, `2` | Curriculum self-check thresholds. |
| `TALA_PACING_BUFFER_RATIO`, `TALA_PACING_ASSESSMENT_SESSIONS_PER_TERM`, `TALA_PACING_MIN_SESSIONS_PER_COMPETENCY`, `TALA_PACING_ASSUME_TAUGHT`, `TALA_PACING_PAIRING_RULE` | the contract's `DEFAULT_PACING_PARAMS` | Hiraia-published pacing defaults. |
| `TALA_FEATURE_GENERATION`, `TALA_FEATURE_COMMUNITY`, `TALA_FEATURE_ROSTER_AI`, `TALA_FEATURE_GOOGLE_SIGNIN` | `true`, `true`, `true`, `false` | Feature switches, served by `config.get`. |
| `TALA_MIN_CLIENT_VERSION` | `0.0.0` | Oldest app version the server accepts. |

A change takes effect when the server restarts. No client release is needed.

## Google sign-in

Off by default (`TALA_FEATURE_GOOGLE_SIGNIN`). When on, `auth.google` accepts a Google ID token and checks
its RS256 signature against Google's published keys (fetched from Google and cached as long as Google says),
that it was issued by Google for one of our client ids, that it has not expired, and that Google has confirmed
the email. A new Google sign-in creates an account with a confirmed email. An existing Tala account is never
linked on Google's word alone; the linking rules (PRD §13.3) are at the top of
`src/modules/core/google-handlers.ts`. The only outside call is to Google's key endpoint; tests replace it.

With the switch off, `auth.google`, the three link routes, `auth.googleConnect`, `auth.removePassword` and a
merge proven by Google all answer `501 not_implemented` (`google_sign_in_not_available`) without contacting
Google. `auth.googleDisconnect` and a merge proven by email and password do not depend on the switch.

## Mail

Local and staging do not send mail. Messages go to the `core_mail_outbox` table, and
`pnpm --filter @hiraia/tala-server exec tsx src/modules/core/tools/outbox.ts` prints the newest ones (that is how
you get a verification or reset link while testing). Production needs a real transport, which is not chosen
yet: until one is passed to `createCoreModule({ mailTransport })`, production refuses to send rather than
store working sign-in links.

## Files

| File | What |
|---|---|
| `server.ts` | `createServer`, the request path above, service wiring, module start/stop |
| `router.ts` | Route matching from the `API` table |
| `http.ts` | Body reading with limits, JSON parsing, responses, client address |
| `auth.ts` | Credentials, cookies, the cross-site check, account deletion and merge hooks |
| `config.ts` | Environment → `TalaServerConfig` |
| `db.ts` | SQLite connection and the migration runner |
| `logger.ts` | The logger and its redaction rules |
| `services.ts` | Default services when no module provides one |
| `types.ts` | The contracts (owned by the orchestrator) |
