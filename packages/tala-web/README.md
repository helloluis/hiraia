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
  lessons/[planId] (+ /print), class, settings, setup, community*, generate*, class/roster/import* (*wave 2, see WAVE2.md);
  `api/v1/[...path]` mounts the server.
- `src/theme/css.ts` generates the CSS variables from the token file; `tailwind.config.ts` maps every colour to a variable.
- `src/i18n` strings (`fil.ts` default, `en.ts`), provider, date helpers.
- `src/data` client, IndexedDB store, cache, network rung monitor, session (engine + sync loop), record hooks,
  curriculum loaders, timeline assembly, plans, realignment, sample class, print, retry, errors.
- `src/components/ui.tsx` the whole design system; `src/features/*` screens.

## Filipino strings flagged for a fluent teacher's review

`week.state.assumed` ("Ipinapalagay na naituro"), `realign.option.absorb` / `realign.desc.absorb` (buffer wording),
`class.bufferRatio`, `class.pairingRule` and the two `class.pairing.*` values, `editor.mode.peer` ("Tulungan ng
magkaklase"), `editor.teacherNone`, `network.readOnlyTitle`, `settings.dataSaverHint`, `pdf.browserHint`
(the quoted "Save as PDF" is left in English because that is what the browser shows).
