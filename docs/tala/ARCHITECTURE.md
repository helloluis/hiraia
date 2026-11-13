# Tala V1.0 — build architecture and ownership

Spec: `docs/tala/tala-v1-prd.md` (Draft 4). Read it before writing code. Where this file and the PRD
disagree, the PRD wins on *what*, this file wins on *where code goes*.

Integration branch: `tala-v1` (worktree `/home/b11/code/tala-v1`). The orchestrator is the only one who
merges into it. Each worker has its own worktree and branch `tala-v1-<letter>` cut from `tala-v1`.

## Packages

| Package | Name | What |
|---|---|---|
| `packages/tala-core` | `@hiraia/tala-core` | Contracts (zod schemas, API table, typed client, sync protocol), brand tokens, and pure logic: pacing, sync engine, print templates, roster parsing, validators. No I/O, no platform APIs. Consumed as TypeScript source (no build step). |
| `packages/tala-server` | `@hiraia/tala-server` | API server. Framework-agnostic: `createTalaServer().handle(Request) → Response`. SQLite (`better-sqlite3`). Kernel + modules. |
| `packages/tala-web` | `@hiraia/tala-web` | Next.js 15 app for `tala.hiraia.org`. Mounts the server at `/api/v1/[...path]`. |
| `packages/tala-mobile` | `@hiraia/tala-mobile` | Expo / React Native Android app, offline-first. |
| `packages/tala` | — | The existing Kotlin Tala 0.4.x app. **Do not touch.** Its absorption (PRD §6.7) is a later wave. |

## Tala 0.4.x stays independent and shippable (Luis, 13 Nov 2026)

The 0.4.x release line keeps shipping fixes while V1.0 is demonstrated and improved. V1.0 work must never
block or entangle it.

- **0.4.x lives on `main`**: the Kotlin teacher app in `packages/tala/` (currently 0.4.4, version code 19,
  `com.hiraia.tala`, pilot signing key) and its student-side counterpart `packages/mobile/modules/hiraia-tala`.
  It is released from `main` with its existing process (`docs/RELEASE-*-TALA-*.md`, `packages/mobile/BUILD.md`).
- **V1.0 lives only on `tala-v1`** (and worker branches `tala-v1-*`), only in new paths:
  `packages/tala-core`, `packages/tala-server`, `packages/tala-web`, `packages/tala-mobile`, `docs/tala`.
  Nothing else in the repository is edited. `tala-v1` is not merged to `main` until Luis says so.
- **No V1.0 change to any file 0.4.x builds from**: not `packages/tala/**`, not `packages/mobile/**`, not
  `packages/shared/**`, not root config, CI workflows or the lockfile. If V1.0 needs code that lives there
  (e.g. the Nearby collection for PRD §6.7), **copy it into a V1-only package**; never modify the original.
  A strictly additive, behaviour-preserving change to a live 0.4.x file needs the orchestrator to flag it to
  Luis first.
- **Separate identity until cutover.** V1.0 builds use Android application id **`com.hiraia.tala.next`**,
  their own debug/demo signing key and no over-the-air update channel, so a V1.0 demo build installs beside
  0.4.x and can never replace or collide with it. The 0.4.x pilot signing key, version-code sequence and
  update manifest are not used by V1.0 builds. Switching to `com.hiraia.tala` with the pilot key and a higher
  version code (PRD ACT-2, in-place upgrade) is a single deliberate cutover step at V1.0 release, decided by Luis.
- **Hotfix path for 0.4.x while V1.0 is in flight:** branch from `main`, fix under `packages/tala/` (and the
  student module if needed), release as today, merge to `main`. No coordination with `tala-v1` is needed.
  The orchestrator periodically merges `main` into `tala-v1`; because the paths are disjoint this cannot conflict.

## Contracts come first

Everything hangs off `packages/tala-core/src/contracts/`:

- `common.ts` primitives, limits, `ApiError`
- `content.ts` lesson content model (simple formatted text; structured multi-grade / week grid), built-in templates
- `records.ts` every **synced record** type + `RECORD_SCHEMAS` registry + `RecordEnvelope`
- `curriculum.ts` competency / pack / calendar-preset types and the **`PacingEngine` interface**
- `sync.ts` push/pull protocol, conflict rules, and the **`SyncEngine` / `LocalStore` interfaces**
- `features.ts` generation, roster import, community, client config DTOs
- `api.ts` **the route table `API`** (method, path, auth, schemas, owner)
- `client.ts` `createTalaClient()` typed client
- `../tokens.ts` Hiraia brand tokens (Tala teal accent)
- `packages/tala-server/src/kernel/types.ts` `ServerModule`, `Handler`, `Ctx`, `Services` (`RecordStore`, `LlmGateway`, `CurriculumService`), `TalaServerConfig`

**Contracts are owned by the orchestrator.** Do not edit them in a worker branch. If a contract is wrong or
missing something you need: keep working against a local adapter, and put the exact change you need in a
`CONTRACT-REQUESTS.md` at the top of your own package/folder and in your final report. The orchestrator applies it.

## Data flow in one paragraph

Everything a teacher owns is a **synced record** (`records.ts`). Clients read and write records only through the
`SyncEngine` (local store first, outbox, push/pull). There is no REST CRUD for records. Online features
(generation, roster import, community copy) **return data and the client writes it into records** through the
sync engine; server modules read records through `ctx.services.records` and rarely write them. Curriculum is
read-only reference data delivered as packs. Pacing and the timeline are computed on the device by the pure
`PacingEngine` from records + packs.

## Ownership map (who may edit what)

| WS | Scope | Owns (only these paths) |
|---|---|---|
| **A** Backend foundation | Kernel runtime, DB, auth, sessions, config, sync push/pull, record store, plan lock rules + revisions, account export/delete, dev server | `packages/tala-server/src/kernel/**` except `types.ts`; `packages/tala-server/src/modules/core/**`; `packages/tala-server/src/index.ts`; `packages/tala-server/src/dev-server.ts`; `packages/tala-server/src/testing/**` |
| **B** Curriculum + pacing | Pacing engine, timeline, realignment, multi-grade pairing; curriculum data model + seed packs; calendar presets; curriculum server module | `packages/tala-core/src/pacing/**`; `packages/tala-core/src/curriculum/**`; `packages/tala-server/src/modules/curriculum/**`; `packages/tala-server/data/**`; `packages/tala-server/scripts/curriculum/**` |
| **C** LLM + generation | Model gateway (DeepSeek → Qwen → local), quotas/budget/cache, prompt registry, lesson generation jobs, multi-grade validators, eval set | `packages/tala-server/src/modules/llm/**`; `packages/tala-server/src/modules/generation/**`; `packages/tala-server/prompts/lesson/**`; `packages/tala-server/eval/**`; `packages/tala-core/src/generation/**` |
| **D** Web app | Next.js app, Hiraia branding, all web screens, API mount | `packages/tala-web/**` |
| **E** Mobile app | Expo app, SQLite `LocalStore`, all mobile screens, budgets | `packages/tala-mobile/**` |
| **F** Rosters | Deterministic parsing + normalisation, file readers, import pipeline, LLM-assisted cleaning with the flagged route | `packages/tala-core/src/roster/**`; `packages/tala-server/src/modules/roster/**`; `packages/tala-server/prompts/roster/**` |
| **G** Community | Artifacts, versions, lineage, search, copy, report, LLM moderation with loose guidelines, rule detectors | `packages/tala-core/src/moderation/**`; `packages/tala-server/src/modules/community/**`; `packages/tala-server/prompts/moderation/**` |
| **H** Sync engine + print | Client sync engine + in-memory store, plan helpers, HTML print templates, server PDF fallback | `packages/tala-core/src/sync/**`; `packages/tala-core/src/plan/**`; `packages/tala-core/src/print/**`; `packages/tala-server/src/modules/print/**` |
| Orchestrator | Contracts, tokens, module registry, root config, this file, integration | `packages/tala-core/src/contracts/**`, `src/tokens.ts`, `src/index.ts`, `package.json`s of core/server, `packages/tala-server/src/kernel/types.ts`, `src/modules/index.ts`, `docs/tala/**`, root files |

Rules:

- **Edit only your paths.** Need something in someone else's path? Code against the interface, stub locally
  inside your own folder, and report the dependency.
- **Dependencies:** adding a dependency to `tala-core` or `tala-server` `package.json` is allowed only by
  appending to `dependencies`/`devDependencies` (never reorder or reformat). Say which ones in your report.
  `tala-core` must stay dependency-light (zod only, unless justified). D and E own their own `package.json`.
- **Never commit `pnpm-lock.yaml`.** The orchestrator regenerates it at integration.
- **Do not touch** anything outside `packages/tala-*` and your listed paths: not `packages/web`, `packages/mobile`,
  `packages/shared`, `packages/tala`, root config, CI.

## Conventions

- TypeScript strict; `moduleResolution: bundler`; relative imports without file extensions.
- Tests: Node's built-in runner through tsx: `*.test.ts` next to the code; `pnpm --filter <pkg> test`.
  D and E may use their framework's usual test runner.
- Install only what you need: `pnpm install --filter "<your package>..."` from the worktree root
  (the worktree is a sparse checkout; a bare `pnpm install` would try to install the whole monorepo).
- Server: SQLite via `better-sqlite3`; one migration list per module (`'<module>:<nnn>_<name>'`); tables
  prefixed with the module name (`community_artifacts`). Throw `HttpError` with plain-language messages.
  Never log plan bodies, roster content, prompts or model output.
- Secrets: environment variable **names** only, in code and docs. `DEEPSEEK_API_KEY`,
  `DASHSCOPE_API_KEY` (fallback name `ALIBABACLOUD_API_KEY`), `TALA_LLM_PRIMARY_MODEL`, `TALA_LLM_FALLBACK_MODEL`,
  `TALA_LLM_LOCAL_ENDPOINT`, `TALA_LLM_LOCAL_MODEL`, `TALA_ROSTER_LLM_ROUTE`, `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `TALA_DB_PATH`. Never print, log or commit a value. Model providers are called
  on their **own direct APIs** only — never through OpenRouter or any aggregator. Tests use fake providers.
- Design (PRD §4.3): Hiraia tokens from `@hiraia/tala-core/tokens`, Tala teal is the single accent;
  simplest option that works; one primary action per screen; plain Filipino/English; 48 dp targets;
  every wait cancellable; every feature has its fallback (PRD §14.2.3).
- Machine: 4 cores shared by all workers. Do not run Android/Gradle builds, root-wide `turbo`, or
  long-running watchers. Run type-check and tests for your own package only.

## Commands

```bash
pnpm install --filter "@hiraia/tala-core..."      # or your package
pnpm --filter @hiraia/tala-core type-check
pnpm --filter @hiraia/tala-core test
```
