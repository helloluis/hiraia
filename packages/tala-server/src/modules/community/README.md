# Community module (workstream G) — PRD §11

One shared community area: teachers post locked lessons, others copy and modify them. No comments, ratings
or messages. Code: this folder; pure detectors in `packages/tala-core/src/moderation`; prompts in
`packages/tala-server/prompts/moderation`.

| File | What |
|---|---|
| `index.ts` | Module + handlers (`community.search/get/post/copy/remove/report`), background recheck timer, `onAccountDeleted` |
| `migrations.ts` | `community:001_init` — artifacts, term index, immutable versions, lineage, copies, reports, decision log |
| `publish.ts` | Locked plan → public version: stripping, tags, provenance |
| `moderate.ts` | Rules + model moderation against loose guidelines |
| `service.ts` | Post, recheck, report, remove, staff takedown/restore, account deletion |
| `search.ts` | Filters, free-text parser, ranking, 20/page, 200 cap |
| `copy.ts` | Version → new private draft plan + sections, grade groups remapped |
| `staff-cli.ts` | Staff switch (no admin HTTP route in V1.0) |
| `testing.ts` | Test helpers: scriptable fake `LlmGateway`, builders that write through the real record store |

## Posting (COM-1, DOC-7, §11.2–11.4)

- Email confirmed (AUTH-1); per-teacher daily limit `abuse.postPerUserPerDay`.
- The plan is read from the **server's own copy** (`records.planSnapshot`): must be the caller's, `locked`,
  and not placed in a sample class.
- Public content = worker H's shared `stripForPublish` (tala-core/plan, the same code as the device preview),
  given the template, the teacher's school names, class names, display name and `includeSchoolName:
  showSchool`: reflection and outside-lock sections, week-grid dates, local grade-group ids, signature
  blocks, school name, distinctive class/section names, the plan's own dates. Title, summary and custom
  template labels go through `createPublishCleaner(...).text()` with the placement dates. Learner names typed into the body are **not** silently edited:
  they are a moderation finding the author fixes (PRIV-9).
- Tags from the plan; quarter from the placement date when not given; multigrade combination from grades.
- Provenance from H's `planProvenance` over the server's `section_revision` history (AI-drafted unless
  substantially rewritten; missing history keeps the AI label). `adapted` = plan has lineage.
- Licence is always CC BY-NC 4.0.
- A custom template is published with the version (`version.template`, labels stripped and moderated);
  copiers save it under the same id. Built-in templates are never included.
- Size: the `community.get` body a post would produce (uncompressed JSON, stricter than the compressed
  budget) must fit `LIMITS.maxApiResponseBytes` minus 16 KB of headroom for the author-only decision;
  otherwise `invalid_input` with `details { reason: 'too_large', bytes, limit }`, before any model call.
- Posting again from the same plan adds a version (a newer locked revision); the same revision again is an
  idempotent no-op (offline-queued retries).

## Moderation (§11.6)

```
rule detectors (tala-core) ──high──▶ return  (no model call; student data is strict)
        │ low hints only
        ▼
moderation off / route rules|off ──▶ allow
        ▼
model (prompt moderation/moderate.v<guidelineVersion>, feature community.moderate)
   ok      ──▶ allow, or return (non-personal-data reasons the model is not clear about are dropped)
   down/invalid ──▶ pending; background recheck every 5 min decides later
```

- Returned at posting: **nothing stored** but a log row. Unlimited re-posting, no penalty.
- `moderate.v1.md` embeds `guidelines.v1.md` verbatim (a test checks it). The guideline version in config
  selects the prompt version. Model excerpts are kept only if they are really in the lesson.
- The author's display name (or pseudonym) is checked with the lesson, as section key `displayName`.
- Rule reasons carry `kind` (`class_list`, `roster_name`, `lrn`, `phone`, `email`, `address`) for client
  wording. The latest decision is on `ArtifactSummary.moderation` for the author only.
- Every decision → `community_moderation_log` with trigger, decision, categories, rule kinds, guideline
  version, provider, model, prompt version. Never content; structured logs carry ids only.

## Reports (COM-8)

A flag with a reason; the note is never shown and is used only for the check and staff escalation.
`personal_data` hides the artifact at once (config `moderation.autoHideOnPersonalDataReport`) while a fresh
check (with the reason) runs; nothing found → restored; model down → stays hidden until the background
check. `inaccurate` never calls the model (accuracy is not moderated). One open report per reporter,
artifact and reason; daily limit `abuse.reportPerUserPerDay`.

## Statuses

| Artifact | Seen by others | Meaning |
|---|---|---|
| `visible` | yes | current version allowed |
| `pending_check` | no | first version waiting for a model check |
| `returned` | no | a recheck or report check returned the current version |
| `hidden` | no | `hidden_by = report` (check running) or `staff` |
| `removed` | no (not even the author) | removed by the author; copies elsewhere unaffected; derived artifacts show the source as unavailable |

Versions are `allowed`, `pending` or `returned`; only `allowed` versions are served to others.

## Viewing older versions

`community.get?versionId=` serves any `allowed` version of a visible artifact; the author can see all their
versions (pending and returned included).

## Account deletion (PRIV-6)

The deleted author's artifacts, versions, tags, lineage rows, reports and copy records are removed, so they
leave search and `get`. Copies other teachers made are their own records and keep `plan.lineage` (the
credit line). Derived artifacts keep the credit in their own version metadata and show the source with
`available: false`. Decision-log rows keep the decision and lose the author id.

## Search (COM-2, COM-3, COM-7, §14.1)

Visible artifacts plus the caller's own. All contract filters; free text lifts grade, quarter and
Science/Mathematics out of the query, the rest is keyword search. Order: competency focus (with
`competencyId`), keyword relevance, copy count, then recency as a tie-break. 20 per page (config), 200 per
query; opaque offset cursor.

## Staff switch

```bash
TALA_DB_PATH=/path/to/tala.db pnpm --filter @hiraia/tala-server exec tsx src/modules/community/staff-cli.ts show <artifactId>
… takedown <artifactId> | restore <artifactId> | pending
```

## Not done in V1.0 here

- Model step for search query understanding (orchestrator: not in V1.0).
- No image moderation (orchestrator: not in V1.0); no private share links (COM-10, not in V1.0).
