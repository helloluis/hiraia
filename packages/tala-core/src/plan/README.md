# Plan helper integration

Import from `@hiraia/tala-core/plan`. These helpers are pure; they never write storage.

- `blankSections(template, planId, gradeGroups, newId)` creates validated section records.
- `validatePlanForLock(plan, sections, template, classRecord)` checks DOC-1.
- `lockPlan({plan, sections, template, class, teacherName, at, revision})` returns a locked plan with actor, timestamp and deterministic short content fingerprint. The UI must show the lock confirmation; server revision remains authoritative.
- `applyGeneratedSections({plan, sections, generated, gen, newId, confirmedSectionIds})` validates replacements, requires confirmation for teacher-written sections, and returns `{plan, sections, revisions}`. Submit the returned `section_revision` records, replacement sections and plan together through `engine.batch([...revisionPuts, ...sectionPuts, planPut])`. The batch is one durable local operation; do not acknowledge generation until it resolves.
- `sectionRevision(section, {id, savedAt, reason})` snapshots a section before a manual edit, restore or conflict choice. `restoreSectionRevision(revision)` rebuilds the section with the original section ID and marks the teacher's restore as an edit. Save the replaced current section as another revision first.
- `boundSectionHistory(newestFirst, limit=20)` returns keep/remove lists per section. Input order must come from server ordering, never device timestamps. Never prune unsent history. Retain the AI baseline separately when needed for provenance.
- `planProvenance({plan, sections, revisions, rewriteThreshold})` consumes newest-first history and conservatively retains AI attribution when it lacks evidence. `substantiallyRewritten` exposes the lexical heuristic separately.
- `stripForPublish(plan, sections, options)` emits artifact content, remaps local grade-group IDs, removes reflection/outside-lock sections, week dates and signature blocks, and replaces known school/class names and session dates in prose. Options include `template`, `schoolName`, `schoolNames`, `classNames`, `sectionNames`, `teacherName`, `dates`, and `includeSchoolName`. Plan placement dates are included automatically. Generic class names such as "Grade 4" and unrelated historical dates stay. Learner names in arbitrary prose still require community moderation.
- `sectionPlainText` / `richTextPlainText` cover every content variant.

History persistence/retention and confirmation screens are client integration tasks;
no browser/SQLite/React Native calls are hidden in these helpers.

## Shared server/device publication preview

Pass identical privacy context on both platforms. For the server, collect the
profile/school-year school names, placement class names, teacher display name and
placement dates. Pass `includeSchoolName: body.showSchool`. `teacherName` helps
remove a title-case name immediately after a signature label; it is not globally
removed from educational prose or attribution.

`createPublishCleaner(plan.language, options)` exposes `text()` for the posted
title/summary, `content()` for structured content, and `items()` for objective
lists. Pass placement dates explicitly to this standalone cleaner. The shared
helper contains the former community text rules, including English/Filipino
placeholders and date formats; server G should remove its duplicate transforms.
Names spanning rich-text formatting boundaries are redacted too (the replacement
uses the first span's formatting when it crosses spans). Original input is never
mutated. The school opt-in only retains school names; sections, dates and
signatures are still stripped.
