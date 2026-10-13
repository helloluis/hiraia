# School pilot applications

`/pilot` is linked by the invitation immediately after the homepage Download section and before A Hiraia Archipelago. The footer also links to it.

The form asks for contact name, position, email, optional mobile, institution name/type, Philippine city/municipality and a province/Metro Manila selection, and one or more classes. Each class has a name, grade and estimated student count. Device/access details and preferred timing are optional. Two written answers cover school needs and why AI-assisted tutoring would help. Contact consent is required. The page asks applicants not to name individual students.

Province choices use the [PSA PSGC province directory](https://psa.gov.ph/classification/psgc/provinces), checked on 13 October 2026 (30 September 2026 edition). The list includes 82 provinces and a separate Metro Manila choice. The same list validates browser and server submissions. Barangay is not collected or included in new saved payloads or notifications; existing saved records are not rewritten.

## Submission and delivery

- `POST /api/pilot-applications` independently validates every field. A shared validator provides matching browser errors. The endpoint has no public GET/list operation.
- Applications persist in `pilot_applications` within the existing private `HIRAIA_DB_PATH` SQLite database. `getDb()` creates the additive table on first use. Production already keeps the database outside the deployment checkout, at `/var/lib/hiraia/hiraia.db`.
- A random request UUID and normalized-payload digest make retries idempotent. Reusing a UUID for different content is a conflict. The browser reuses the same UUID after uncertain network outcomes, but creates a new one if the applicant edits their submission.
- After persistence, a plain-text team notification uses the existing `RESEND_API_KEY` and `feedback@hiraia.org` sender. `PILOT_APPLICATION_TO` optionally overrides the destination; otherwise the existing feedback destination is used. The applicant's email is the reply-to, not an automatic recipient. Public UI contains no internal inbox address.
- Delivery is recorded as `pending`, `sent`, `failed` or `unconfigured`. Email failure never discards a saved application. There is no automatic notification retry job; private database review is the recovery path. If delivery fails, the team can inspect the saved application and follow up. The success page confirms receipt, not email delivery or pilot acceptance.
- Rejected input, off-site browser origins, non-JSON requests, bodies over 32 KiB, honeypot fills, and excessive attempts are rejected with explicit errors. The current single-process deployment allows 10 attempts/IP/hour using the last proxy-appended forwarded address. Rate state resets with the process. A multi-process deployment should move the limiter to shared storage.
- No raw IP, user agent, child identifiers or application contents are added to analytics. Applicant-entered text is stored as data and sent only as plain text; it must never be rendered as raw HTML by a future admin view. Treat this table as private contact data, separate from public deployment pins and telemetry exports.

## Deployment check

This change needs the website's normal build/deploy, not an APK build or version bump. Preserve the existing private database and email environment settings. If desired, set `PILOT_APPLICATION_TO` before deployment. Do not print or commit email credentials.

Check that the homepage invitation opens `/pilot`, class rows work on a phone, and a deliberate authorized test submission is saved. Verify notification status privately; do not claim production delivery based on the mocked tests below.

An administrator can inspect delivery health without exposing application contents:

```sql
SELECT notification_status, COUNT(*) FROM pilot_applications GROUP BY notification_status;
SELECT id, created_at, school_name, notification_status
FROM pilot_applications ORDER BY id DESC LIMIT 25;
```

For a particular application, privately read `payload_json` by ID from that same database. No new admin dashboard, public application listing, mail subscription or automated applicant email is included.

## Verification

From `packages/web`:

```sh
node --import tsx src/lib/pilot-application.test.ts
node --conditions=react-server --import tsx src/app/api/pilot-applications/route.test.ts
pnpm type-check
pnpm build
```

The route test uses a temporary database and mocked email. It checks required fields, multiple classes, malformed payloads, consent, bounds, retries, conflicts, origin and content-type rejection, body size, trusted forwarded-IP rate limiting, notification success/failure, and storage failure. The validator tests cover normalization and exact narrative preservation.

On 13 October 2026, the five validator/route tests and TypeScript check passed, and the production build completed. The build still reports the existing root ESLint configuration error: `@typescript-eslint/await-thenable` requires parser type information that `.eslintrc.js` does not supply (first reported in the unchanged app-manifest route). This is not a clean lint result; the shared lint configuration was left unchanged.

For browser verification, start a **local-only** server with a throwaway database and explicitly empty email key:

```sh
HIRAIA_DB_PATH=/tmp/hiraia-pilot-preview.db RESEND_API_KEY= pnpm dev --hostname 127.0.0.1 --port 3109
```

Then, from the repository root:

```sh
node packages/web/scripts/check-pilot-application.cjs
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if the installed Chromium differs from Playwright's default. The script rejects non-local destinations. It exercises actual persistence, simulates a lost success response and retries, checks class removal/retention and mobile focus, verifies that disabled JavaScript cannot send private fields through a GET URL, and captures desktop/mobile screenshots in gitignored `build/pilot-application-preview/`. Its application is clearly marked Example Pilot School with `preview@example.test`. Do not run it against a real database or a server with email enabled.
