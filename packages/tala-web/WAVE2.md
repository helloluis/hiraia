# Wave 2 in `packages/tala-web` — built

Wave 1 shipped the planning core. Wave 2 (this document's original purpose) is now built inside this package:

| Feature | Routes | Code |
|---|---|---|
| Lesson generation (PRD §9) | `/generate?planId=…` (entered from `/lessons/new` "Draft with AI", which creates the plan first, or from the editor's **More** sheet); section rewrite inside the editor | `src/data/generation.ts` (request builder — counts only, never names; `applyGenerationJob` writes revisions → sections → plan in one `engine.batch`; `prefillPlan` fallback via `buildPrefilledDraft`; on-device queue), `src/features/generate/GenerateScreen.tsx`, `GenerationRunner.tsx` (mounted in the app shell: runs queued requests and polls backgrounded jobs), `src/features/editor/RegenSheet.tsx` |
| Roster import (PRD §12) | `/class/roster` (manual add/edit/remove/reorder), `/class/roster/import` (paste or file → flag or notice → columns → review → save) | `src/data/roster.ts`, `src/features/roster/RosterImportScreen.tsx`, `RosterScreen.tsx`; notices from `@hiraia/tala-core/roster` (`rosterNotices`) |
| Community (PRD §11) | `/community` (browse + filters + my posts, 20/page), `/community/[artifactId]` (detail, copy, report, remove), Post from the editor's **More** sheet (locked, non-sample), COM-3 panel on `/lessons/new` | `src/data/community.ts` (`prePostReview` = shared `stripForPublish` + `detectPersonalData` with roster names; `copyArtifact` through `engine.batch`), `src/features/community/*` |

## What still needs doing here

- Generation: `adapt` and `translate` kinds (LLM-5/6, P1) have no UI; the request builder already accepts `kind`.
- Roster: re-upload and diff against an existing roster (ROS-8, P1); `.pdf` input (ROS-2, P1) depends on the server reader.
- Community: version history browsing (`community.get` with `versionId`); region filter UI (the query supports it); private link sharing (COM-10, P1).
- A posted plan's artifact id is not kept on the plan, so "post a new version" relies on the server matching the same plan.

## Reuse (unchanged)

`useSession()`, `useRecords()` / `useWorkspace()`, `useTimeline()`, `usePacks()`, `withRetry()`, `errorKey()`; components in `src/components/ui.tsx`; strings in `src/i18n/en.ts` **and** `fil.ts` (parity test). One primary action per screen; placeholders not spinners; every wait has a Cancel; queue, don't refuse; 48 px targets; 320 px width; keep the first-screen JS under 300 KB compressed.
