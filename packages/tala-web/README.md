# @hiraia/tala-web

Next.js 15 (App Router) web app for `tala.hiraia.org`. Hiraia branding from `@hiraia/tala-core/tokens`,
Filipino-first strings, saved-data-first screens on an IndexedDB `LocalStore` behind the shared sync engine.

```bash
pnpm install --filter "@hiraia/tala-web..."
pnpm --filter @hiraia/tala-web dev          # http://localhost:3100 (API mounted at /api/v1 from @hiraia/tala-server)
pnpm --filter @hiraia/tala-web type-check
pnpm --filter @hiraia/tala-web test         # node:test via tsx; sync tests run against the real server kernel
pnpm --filter @hiraia/tala-web build
```

Server configuration is by environment variable **names** (see `packages/tala-server/src/kernel/README.md`):
`TALA_ENV`, `TALA_DB_PATH`, `TALA_PUBLIC_ORIGIN`, `TALA_SESSION_COOKIE`, …

## Layout

- `src/app` routes: `(auth)` sign-in / register / verify-email / reset-password; `(app)` week, lessons, lessons/new,
  lessons/[planId] (+ /print), class, class/roster (+ /import), settings, setup, generate, community (+ /[artifactId]);
  `api/v1/[...path]` mounts the server. Wave-2 notes: WAVE2.md.
- `src/theme/css.ts` generates the CSS variables from the token file; `tailwind.config.ts` maps every colour to a variable.
- `src/i18n` strings (`fil.ts` default, `en.ts`), provider, date helpers.
- `src/data` client, IndexedDB store, cache, network rung monitor, session (engine + sync loop), record hooks,
  curriculum loaders, timeline assembly, plans, realignment, sample class, print, retry, errors, generation
  (request builder, job apply, on-device queue), roster (import helpers), community (pre-post review, copy).
- `src/components/ui.tsx` the whole design system; `src/features/*` screens.

## Filipino strings flagged for a fluent teacher's review

`week.state.assumed` ("Ipinapalagay na naituro"), `week.state.beforeTala`, `realign.option.absorb` / `realign.desc.absorb` (buffer wording),
`class.bufferRatio`, `class.pairingRule` and the two `class.pairing.*` values, `editor.mode.peer` ("Tulungan ng
magkaklase"), `editor.teacherNone`, `network.readOnlyTitle`, `settings.dataSaverHint`, `pdf.browserHint`
(the quoted "Save as PDF" is left in English because that is what the browser shows).
Wave 2 additions to review: `gen.*` (especially `gen.intro`, `gen.notice`, `gen.regenEdited`, `gen.allowance`),
`roster.flag.*`, `roster.act.keep_original`, `roster.counts`, `com.license`, `com.checkNotice`, `com.removeBody`,
`com.affirm`, `com.status.*`, `com.adapted` / `com.adaptedFrom` ("hinango").

## Google sign-in (PRD §13.3)

Shown only when the server's `config.features.googleSignIn` is true. The Google Identity Services script is loaded
lazily, only where a Google button is rendered, and the client id is the public `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`
(build/runtime value, never a secret). Flows: "Continue with Google" on sign-in and register; `link_required` →
password once (`auth.googleLink`) or "email me a link" (`auth.googleLinkRequest`) → `/link-google` reads `#token=` and
posts to `auth.googleLinkConfirm`; `verify_email_first`; Settings → Account: connect / disconnect Google, remove the
password, join another account (`account.merge`, both proofs). Every server reason code is localised in
`src/data/errors.ts`.

## Journey check

`docs/journey/` holds the scripted full-stack walk against the production build (fallback and live runs).

## Public pages

- `/` — public homepage in the hiraia.org pattern (eyebrow, serif headline, benefit blocks, promises band, get-started
  card). Server-rendered; the only client state is the "Open my week" swap for a signed-in visitor. Hero art in
  `public/brand/tala-hero-teacher*.{webp,jpg}` (desktop 1600 px, mobile 720 px variants).
- `/download` — reads `${TALA_DOWNLOAD_DIR}/tala-apk.json` at request time (schema in `src/app/download/page.tsx`);
  the APK is served by nginx. Without a manifest it says the app is not published yet.
- `config.features.emailDelivery === false` hides every "verify your email" prompt and says plainly on the
  reset-password screen that reset by email is not available yet.
