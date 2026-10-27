# Hiraia — STURDY public; SPEED private tools

Public Hiraia.org, student/teacher apps, learning content and published models are STURDY: run relevant tests and verification, then obtain explicit deploy/publication confirmation. Purely private admin dashboards and internal tools are SPEED: verify quickly and deploy authorized changes by default without another question. Shared/public effects follow STURDY. Follow [/home/b11/code/AGENTS.md](/home/b11/code/AGENTS.md).

## Add a feature
- Read `CLAUDE.md`; factual science accuracy outranks Tagalog/Cebuano fluency. Use existing trilingual shared types and grade-level conventions.
- pnpm/Turbo monorepo: Expo/React Native student app `packages/mobile/src/`; Kotlin teacher app `packages/tala/android/`; Next.js 15 website/API `packages/web/src/{app,components,server}`; Electron desktop `packages/desktop/`; shared types `packages/shared/`.
- Content originates in `rag/pipeline/` and `rag/bank/`; images in `packages/images/`; model training/evaluation in `finetuning/`; private monitoring in `deploy/vps-monitor/`.
- Read `packages/mobile/BUILD.md` before native/OTA work, `docs/COUNTRY-BOOTSTRAP.md` before country expansion, and the relevant `tools/*/PLAN.md` before audits.
- The previous detailed AGENTS guidance, including its uncommitted edits, is preserved in `docs/AGENTS-reference-20261027.md`. Use its content/evidence guidance; this file supersedes historical branch/deployment claims.

## Fix and verify
- Use pnpm 9.15.9 as declared in `package.json` (host shim was 12.11.2). Run `pnpm --filter @hiraia/web type-check`, `pnpm --filter @hiraia/web lint`, and `pnpm --filter @hiraia/web build` for web changes; build checks competencies.
- Mobile: `pnpm --filter @hiraia/mobile type-check`, plus the relevant existing `qa:voice`, `qa:exam`, `qa:tala`, `qa:semantic`, `qa:images` or `qa:platforms` script. Desktop: `pnpm --filter @hiraia/desktop test`. Images: `pnpm --filter @hiraia/images test`.
- Run `bash finetuning/eval/harness/run-harness.sh` for model/content regression gates; inspect its model/runtime requirements and costs first. A website-only edit does not prove the model passed evaluation.
- Rebuild content with `python3 rag/pipeline/build-cards-db.py` when source banks/pool change. Preserve append-only Tala catalog IDs. Never hand-edit generated databases/indexes.
- Student APK: `pnpm --filter @hiraia/mobile apk` and the signing workflow in BUILD.md; do not publish a debug-signed student APK. Tala's established pilot signing key is intentionally different. Android destructive instrumentation tests run only on an emulator.

## Deploy and roll back
- Read `/home/b11/PRODUCTION-ACCESS.md` and `deploy/README.md`; use `sudo ssh b11-apps`. Web source/runtime is `/root/hiraia/packages/web`, port 3005; preserve `/var/lib/hiraia/` and production environment.
- **Live drift at inspection:** `ovh-hiraia-web.service` was inactive; the serving Next process belonged to root's PM2 daemon. Inspect the actual `hiraia-web` process/PM2 home before activating checked web artifacts. Do not start a second web service.
- Historical `/root/hiraia/deploy/update.sh` hard-resets to origin/main and can restart both web and LLM through PM2. Do not run it blindly. Stage a web-only build, retain prior code/`.next`, then target the verified web process only; restore that code/build and process configuration for rollback.
- Inference actually runs as `ovh-hiraia-llm.service` and `ovh-hiraia-embed.service`, guarded by `/usr/local/libexec/hiraia-migration-runtime.py` and `/etc/hiraia/migration-runtime.json`. Changing pinned launchers/models requires a coherent guarded release and rollback; do not bypass its hashes.
- Private services: `hiraia-admin.service` loads `/opt/hiraia-monitor/admin_app.py`; telemetry is separate `hiraia-telemetry.service` at `/opt/hiraia-telemetry/server.cjs`. Deploy collector compatibility before clients that emit new telemetry; web update does not update it.
- Asset publication: `deploy/publish-release-assets.py` with its documented arguments; OTA: `deploy/publish-ota.py` canary/promote workflow. Preserve signing material; use versioned assets, prior manifest pointers and OTA rollback procedures from BUILD.md.
- Verify https://hiraia.org/api/app/manifest, served web/asset hashes, applicable health endpoints and real client behavior. Nginx can serve PDF aliases from `/var/www/hiraia-publications/`, independently of Next public assets.

## Pitfalls
- The checkout is dirty on `codex/apk-footprint-refactor`; do not reset it, assume main matches it, or deploy other agents' files.
- Never `git add -A`: multi-GB models, corpora and private artifacts coexist here. Preserve offload markers and image originals; see `tools/reference-archive/OFFLOAD.md`.
- Keep asset catalog version bounds/image baselines aligned with the APK; version bumps require the documented prebuild/sign steps.
- Corpus rarity is not a language defect. Verify edits against English meaning, corpus/dictionary evidence and exact emphasis spans; retain unresolved native-review cases.
- Old Vultr addresses and Mac-only JDK/SDK paths in historical notes are not this host's deployment setup. Never restart inference, telemetry or private reviewer/narrator services to fix a web-only issue.

Inspected 2026-10-27. Release commands were inspected, not executed.
