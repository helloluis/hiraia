# Wave 2 in `packages/tala-web`

Wave 1 (this package) ships the planning core: auth, setup, This Week / This Month, lessons, the editor,
lock/unlock, marks, no-class days + realignment, Class, Settings, PDF. Three features are **placeholders**
(route + nav entry + a plain "coming soon" state) for another worker to build inside this package.

## Where things plug in

| Feature | Route (placeholder today) | Entry points already wired | Build it with |
|---|---|---|---|
| Lesson generation (PRD §9) | `src/app/(app)/generate/page.tsx` — query `classId`, `assignmentId`, `date`, `planId` | "Draft with AI" on `/lessons/new` (`NewLessonScreen`), `wave2.*` strings | `getClient().call('generation.allowance' / 'generation.create' / 'generation.get' / 'generation.cancel')`; on `done` write sections with `applyGeneratedSections` from `@hiraia/tala-core/plan` **through the sync engine** (`useSession().engine`), persisting each returned `section_revision` before its replacement. Queue offline (RES-8): keep the request in the `KvCache` (`src/data/cache.ts`) and retry from the sync loop in `session.tsx`. Fallback: the blank template the teacher already has. |
| Roster import (PRD §12) | `src/app/(app)/class/roster/import/page.tsx` | "Import a list of learners" row on `/class` (`ClassScreen`) | `roster.import` → review screen → `roster.confirm`; write `student` records through the engine. Show the §12.4.1 flag when `config.rosterLlmRoute === 'cloud'` (`useSession().config`). Paste-as-text fallback. |
| Community (PRD §11) | `src/app/(app)/community/page.tsx` (bottom-nav destination #3) | Nav entry in `features/shell/AppShell.tsx`; "Find in the community" on `/lessons/new`; posting belongs in the editor's **More** sheet (`features/editor/MoreSheet.tsx`, only when `plan.state === 'locked'`, never for `cls.isSample`) | `community.search` (20 per page, filters only on slow links), `community.get`, `community.copy` → write the returned plan + sections through the engine with `lineage`; `community.post` with `stripForPublish` from `@hiraia/tala-core/plan`. |

## Reuse

- **Data:** `useSession()` (engine, cache, config, network rung), `useRecords(entity)` / `useRecord()` / `useWorkspace()`
  (`src/data/records.ts`), `useTimeline()` (`src/data/timeline.ts`), `usePacks()` / `useCurriculumIndex()`
  (`src/data/curriculum.ts`), `withRetry()` (`src/data/retry.ts`), `errorKey()` (`src/data/errors.ts`) for plain messages.
- **Components:** `Button`, `LinkButton`, `TextInput`, `TextArea`, `Select`, `Checkbox`, `Switch`, `Choice`, `List`, `ListRow`,
  `Badge`, `Banner`, `Placeholder`, `PageHeader`, `SectionTitle`, `EmptyState`, `Sheet`, `Toast`, `Waiting`
  (`src/components/ui.tsx`). `RichTextView` / `SectionEditor` with `readOnly` render any section content for previews.
- **Strings:** add keys to `src/i18n/en.ts` **and** `fil.ts` (the test `strings.test.ts` fails on a mismatch). No text in components.
- **Placeholder pattern:** `features/shell/ComingSoon.tsx`.

## Rules that carry over

One primary action per screen; placeholders not spinners; every wait has a Cancel; queue, don't refuse; 48 px targets;
320 px width; strings in both languages; no new UI libraries; keep the first-screen JS under 300 KB compressed
(check `next build` output — wave-2 code must stay on its own routes).
