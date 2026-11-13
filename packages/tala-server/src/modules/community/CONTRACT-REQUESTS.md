# Worker G (community) — contract requests

Status after wave 2 (orchestrator): **1, 2, 4, 5, 7 applied and implemented.** 6 in progress (worker H
moves the text-stripping into `stripForPublish`; G switches when told). 8 and 10 are not in V1.0.
3 and 9 remain open.

1. **`ArtifactSummary.moderation?: ModerationDecision | null`** (`contracts/features.ts`), filled only when
   `mine` is true. After a report check or a background recheck returns a post, the author currently sees
   `status: 'returned'` but not *why*. The module already stores the latest decision per artifact
   (`community_artifacts.last_decision_json`) and would return it here.

2. **`community.get` query `{ versionId?: Id }`** (`contracts/api.ts`). PRD §11.2 says older versions stay
   reachable; today they can be copied (`community.copy` takes `versionId`) but not viewed. The handler
   would serve any `allowed` version of a visible artifact (and any version to its author).

3. **Search response `interpreted`** — `Page(ArtifactSummary).extend({ interpreted: { grade, termIndex,
   learningAreaId, keywords } })` for `community.search`. §9.8 says parsed filters "are shown and editable";
   the server parses free text (`parseQuery` in `search.ts`) but cannot tell the client what it understood.

4. **Custom templates in a version.** `ArtifactVersion` has `templateId` only. For a custom template
   (`tags.templateKind === 'custom'`) a copier does not have that template. Suggest
   `ArtifactVersion.template?: Template` (present only for custom templates). Meanwhile the copy keeps the
   original `templateId`.

5. **Document the "returned at posting" response.** When `moderation.decision === 'return'`, nothing is
   stored (the post may hold a learner's data), and `artifact` is a preview with `status: 'returned'`. Its
   `id` is the existing artifact's id when a version was being added (that artifact is unchanged), otherwise
   an id that does not exist. Suggest saying so on `community.post` in `api.ts`.

6. **One stripper for device and server.** The pre-post screen must show exactly what will be public
   (§11.2). The server uses worker H's `stripForPublish` (structure: reflection/outside-lock sections, week
   dates, grade-group ids) plus its own text-level pass in `publish.ts` (school name unless opted in, the
   class/section name, the plan's own dates in the forms teachers write them, signature blocks). Suggest
   moving that text pass into `tala-core/src/plan` (worker H) with options
   `{ schoolNames, classNames, dates, includeSchoolName }`, so the device preview and the server agree.
   Optionally a `community.preview` route (same body as `community.post`, returns the stripped version and
   the rule findings) for the web app.

7. **Finer reason codes in `ModerationDecision.reasons`:** add optional `kind?: 'name_list' | 'roster_name'
   | 'lrn' | 'phone' | 'email' | 'address' | null` so clients can localise "remove the phone number" vs
   "remove the class list". Messages are plain English today (server convention); clients can localise by
   `category` meanwhile.

8. **Prompt folder for search query understanding.** §9.8 has DeepSeek handle what the deterministic
   parser leaves. That needs a prompt under `prompts/community/` (not in G's ownership; G owns
   `prompts/moderation/`). The module does not call a model for search in V1.0; keyword search covers the
   rest. Grant the folder if the model step is wanted.

9. **`onAccountDeleted`.** The module sets the hook on the module (contract) *and* on `kernel` (where the
   kernel reads it today). Once the kernel reads the module field, drop the `kernel` copy; the clean-up is
   idempotent, so running twice is harmless.

10. **Attachments / photos.** The guidelines cover "photos of identifiable children" and textbook scans, but
    V1.0 contracts have no attachments on plans or versions. When attachments are added, moderation must
    cover them (at least: posting with photos goes to `pending` until a vision-capable check runs).
