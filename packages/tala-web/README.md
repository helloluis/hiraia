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
- `src/components/ui.tsx` the base design system; `src/components/icons.tsx` the one icon family;
  `src/components/editorial.tsx` the reading-page blocks (kicker, section head, Big Idea, callout, disclosure, tabs);
  `src/features/*` screens.
- Teacher-portal rework (Library as a magazine, pack reading pages, slide carousel and "My copy" editor, This Week):
  design decisions, demo path and how to check it are in `docs/tala/teacher-portal/README.md`. Evidence tooling:
  `scripts/ui-seed.mjs` (fictional teacher), `scripts/ui-capture.mjs` (screenshots), `scripts/decks-acceptance.mjs`
  (two teachers: private copies, unchanged original, export, new library snapshot).

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

- `/` — public homepage in hiraia.org's proportions: the photograph is the hero (near-full-viewport, headline card
  laid over it), then what Tala does in three pictures (`src/features/landing/Showcase.tsx`: one lesson plan for a
  multi-grade room, slides she can edit, the DepEd Science curriculum by week), "Our Promise", one get-started card,
  and hiraia.org's footer (QVAC mark + the same disclaimer). Server-rendered; the client state is the "Open my week"
  swap for a signed-in visitor and the library's answer about packs. Copy is Taglish in the Filipino locale. Design
  notes, claims and how to check it: `docs/tala/homepage/README.md`.
  - Hero art: `assets-src/tala-hero-teacher-master.jpg` is the one master (as generated, no edits);
    `scripts/hero-build.cjs` rebuilds `public/brand/tala-hero-teacher{,-wide,-mobile}.{webp,jpg}` (1.2 % rim trim,
    3:4 phone crop around the teacher).
  - Product pictures: `scripts/home-capture.mjs` seeds a fictional teacher per language through the real API and
    sync engine and photographs the real lesson editor and slide editor into `public/screens/home/` (wide and phone
    layout, English and Filipino, WebP + JPEG, with `manifest.json`). Run it against a local production server
    (`TALA_ENV=local`, temp `TALA_DB_PATH`, the Science pack library); it calls no model. After a run, copy the sizes
    from the manifest into `src/features/landing/shots.ts` (`showcase.test.ts` checks them and the byte budgets).
  - Curriculum map: its numbers are generated from the shipped Science curriculum packs by
    `scripts/home-coverage.mjs` into `src/features/landing/science-coverage.generated.ts` (`coverage.test.ts` fails
    when the file and the packs disagree). Which weeks have a teaching pack is asked from `/api/v1/packs/index` when
    the page is opened; no count is written into the copy.
  - The earlier screenshot carousel and its `public/screens/*` files are retired; `scripts/demo-seed.mjs` and
    `scripts/demo-capture.mjs` (which made them) no longer feed any page.
  - Hero is capped at 80 svh (min 520 px) with a quiet scroll cue; the footer is dark forest like hiraia.org's.
- `/download` also shows an **experimental** "Tala with on-device AI (QVAC)" card when
  `${TALA_DOWNLOAD_DIR}/tala-with-qvac-apk.json` exists (same schema plus optional `note` and `requires`).
- `/download` — reads `${TALA_DOWNLOAD_DIR}/tala-apk.json` at request time (schema in `src/app/download/page.tsx`);
  the APK is served by nginx. Without a manifest it says the app is not published yet.
- `config.features.emailDelivery === false` hides every "verify your email" prompt and says plainly on the
  reset-password screen that reset by email is not available yet.

## Lesson planner (editor) notes

- Topic labels come from `src/data/topics.ts` (`shortTitle` + `weekFrom/weekTo` when a pack has them, else the
  domain trimmed to four words / "Term N"); the full competency text always stays underneath.
- Multi-grade content is one tinted row per grade (`groupTint` in `src/features/editor/blocks.ts`); the same tint
  for the same grade across objectives, materials, time blocks and assessment. Text is always forest.
- `transitionMinutes` is kept in the data but is not a teacher-facing field; new blocks take the engine default.
- Post-class sections (`outsideLock`: Assessment results, Reflection) stay writable on a locked plan under an
  "After class" heading; a missing `results` record is created on first edit through the sync engine.
- Session Flow timeline bar: `src/features/editor/flow-timeline.ts` (pure model) + `FlowTimeline.tsx` (sticky inside
  its section; `--header-h` is measured from the phone header by the app shell).
- Review evidence: `docs/editor-review/`.
