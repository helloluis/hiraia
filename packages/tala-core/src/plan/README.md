# Plan helper integration

Import from `@hiraia/tala-core/plan`. These helpers are pure; they never write storage.

- `blankSections(template, planId, gradeGroups, newId)` creates validated section records.
- `validatePlanForLock(plan, sections, template, classRecord)` checks DOC-1.
- `lockPlan({plan, sections, template, class, teacherName, at, revision})` returns a locked plan with actor, timestamp and deterministic short content fingerprint. The UI must show the lock confirmation; server revision remains authoritative.
- `applyGeneratedSections({plan, sections, generated, gen, newId, confirmedSectionIds})` validates replacements, requires confirmation for teacher-written sections, and returns `{plan, sections, revisions}`. Persist each returned `section_revision` **before** its replacement, then the returned plan. Do not acknowledge generation until all writes resolve. Prefer a store transaction when the platform integration supports one.
- `sectionRevision(section, {id, savedAt, reason})` snapshots a section before a manual edit, restore or conflict choice. `restoreSectionRevision(revision)` rebuilds the section with the original section ID and marks the teacher's restore as an edit. Save the replaced current section as another revision first.
- `boundSectionHistory(newestFirst, limit=20)` returns keep/remove lists per section. Input order must come from server ordering, never device timestamps. Never prune unsent history. Retain the AI baseline separately when needed for provenance.
- `planProvenance({plan, sections, revisions, rewriteThreshold})` consumes newest-first history and conservatively retains AI attribution when it lacks evidence. `substantiallyRewritten` exposes the lexical heuristic separately.
- `stripForPublish(plan, sections, {template, includeSchoolName, schoolName})` emits only artifact content, remaps local grade-group IDs, removes reflection/outside-lock sections and week dates. It does not detect names typed into lesson prose; the community pre-post review/moderation still applies.
- `sectionPlainText` / `richTextPlainText` cover every content variant.

History persistence/retention and confirmation screens are client integration tasks;
no browser/SQLite/React Native calls are hidden in these helpers.
