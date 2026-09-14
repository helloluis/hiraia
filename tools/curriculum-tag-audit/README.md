# Curriculum-tag audit handoff

Use this as an in-session task. No paid model calls, API keys, subprocess agents, APK
builds, CDN uploads, or production changes are needed to perform the audit.
The audit agent reviews content; the integrator applies approved corrections later.

## Objective and unit of work

Determine whether each card actually teaches each assigned MATATAG competency.
One item = one card, its complete text, and **all** source/runtime competency tags.
A primary tag can be correct while secondary tags are wrong. Review them separately.
The batch exporter includes the complete local competency catalogue so alternatives
can be checked without guessing from a code or a topic name.

Known failure: `sleep-tiredness-builds-while-awake-g5` (`ffct-10018`) was assigned
`G6-L-2` (plant reproduction). Its tag confidence was 1.0. Confidence and agreement
between labelers are triage metadata, not evidence that a card teaches a competency.
The existing exclusion is a calibration case; don't replace it without evidence.

## Start here

Worktree: `/Users/luis/Code/hiraia-unified`, branch `unified`. Preserve other agents'
uncommitted work. Read relevant AGENTS.md if one exists. Use this workflow and
`batch.py`; do not regenerate card text or rewrite curriculum tags while auditing.

Start with the known bad cluster, Grade 6 plant reproduction (`G6-L-2`, then
`G6-L-3`). Next audit remaining Grade 6 topics, then other pilot grades. Later include
untagged/provenance-only cards to measure missing assignments; these are included
when no grade/code filter is used. Grade filters refer to assigned curriculum grade,
not the grade suffix in the card's stable ID.

```sh
python3 tools/curriculum-tag-audit/batch.py \
  --grade 6 --code G6-L-2 --limit 10 --offset 0 \
  --output /private/tmp/hiraia-audit/g6-l2-0000.packet.json
```

The packet reports `snapshot`, `next_offset`, and `total_in_filter`. For the next
batch, keep the same filter, use its `next_offset`, and pass the exact fingerprint:

```sh
python3 tools/curriculum-tag-audit/batch.py \
  --grade 6 --code G6-L-2 --limit 10 --offset NEXT_OFFSET \
  --expect-snapshot SNAPSHOT_FROM_PREVIOUS_PACKET \
  --output /private/tmp/hiraia-audit/g6-l2-NEXT_OFFSET.packet.json
```

Paths in `/private/tmp` are examples. For multi-window work use a persistent,
agent-owned directory outside source datasets, e.g. `tools/curriculum-tag-audit/runs/alex/`.
Never overwrite an existing packet. Do not commit generated packet dumps by default.
The exporter opens files read-only, fingerprints inputs, and refuses stale continuation.
A changed snapshot requires matching completed items by stable `fact_id` and checking
whether their text/tags/competencies changed. Never carry old offset coverage forward.

## Batch sizing and rate-limit windows

- Begin with 5–10 cards; use 3–5 for dense or multi-tag material. `--limit` accepts 1–100.
- After the first batch, record elapsed time and token usage **if exposed**. Do not
  invent remaining quota. With a known budget, reserve at least 25% for validation,
  recording progress, and handoff; size the next batch from observed cost per item.
- If quota is unknown, continue in small batches and checkpoint after each. Stop
  immediately on rate-limit signals; avoid repeated retries and save a next-step note.
- A packet is not a commitment to finish it in one window. Save each completed result.
  Resume remaining item hashes in the same packet; advance `next_offset` only when every
  item has a disposition, including `uncertain` where necessary.
- Divide multi-agent work by disjoint primary-owner assignments in a coordinator
  ledger. Grade/code filters can overlap because cards have multiple tags. They are
  not locks. Deduplicate by `(snapshot, fact_id, item_sha256)` and retain conflicting
  reviews for adjudication rather than overwriting them.

## Review rubric

Read the whole question and answer, then the actual competency wording and its
curriculum content heading. A shared word, broad domain, grade suffix, or related
organism is **not** enough. Ask: “Does this card give the student information needed
to perform the action described by this competency?” It need not teach the entire
competency, but must directly support a substantive part of it.

For each assigned code choose:

- `direct`: explicitly supports the stated skill/concept at this curriculum placement.
- `prerequisite_only`: useful background, but does not teach this competency directly.
- `related_only`: same broad subject or vocabulary; no direct instructional support.
- `wrong`: contradicts the intended subject or is unrelated to it.
- `uncertain`: text, source, grade fit, or interpretation is insufficient to judge.

Only `direct` tags are candidates for automatic curriculum-feed membership.
Don't turn prerequisite chains into an excuse to admit every biology card everywhere.
Check every secondary tag. Cross-grade tags require a separate explanation of direct
support for each grade's competency, not an inference from the primary tag.

Read English first, then check Tagalog/Cebuano if their wording changes the meaning.
Flag material translation differences and possible factual errors separately. Do not
silently edit prose or decide medical/scientific correctness from a tag audit alone.
Use local curriculum extracts as the reference. If an extract is ambiguous or appears
wrong, mark `uncertain` and record the original guide/page to check; do not assume
that the generated title or old labels settle the question. Consult the original
source when accessible, respecting tool/browser rules for external sources.

Replacement tags are optional. Search the supplied catalogue; propose only codes
whose exact wording is directly supported. “No suitable code found” is acceptable.
A good enrichment card may remain searchable/randomizable without a curriculum tag.
Never invent a code, force every card into a competency, or relabel just to fill gaps.

## Result format: one JSON object per line

Write `<packet-name>.review.jsonl`. Copy identity hashes from the packet. Example
shape (placeholders below must be replaced with actual values):

```json
{"snapshot":"...","fact_id":"...","id":"...","item_sha256":"...","reviewer":"agent-name","reviewed_at":"ISO-8601 UTC","disposition":"keep|correct|exclude|uncertain","assigned_reviews":[{"code":"G6-L-2","verdict":"wrong","card_evidence":"short exact excerpt","competency_evidence":"short exact excerpt","reason":"Explain the instructional mismatch."}],"proposed_codes":[],"replacement_evidence":[],"flags":[],"notes":"No supported replacement found."}
```

`replacement_evidence` contains `{code, card_evidence, competency_evidence, reason}`
for each proposed code not already reviewed as `direct`. `proposed_codes` is the
complete recommended set, primary first, not a list of additions. For `keep` it must
match the current valid assignment; for `exclude` it is empty. `uncertain` is a
review disposition, **not permission to clear tags**. Useful flags include
`translation_mismatch`, `possible_factual_error`, `source_ambiguous`, `grade_mismatch`,
`source_runtime_disagreement`, and `unknown_code`.

Every reason must be specific enough for someone to review without rerunning the
whole investigation. Quote short evidence from the actual card and competency;
“doesn't fit,” “biology,” or model confidence alone do not meet the bar.

## Completion and validation gate

Before calling a batch complete, check:

1. Exactly one first-pass result for every packet item, with matching snapshot,
   stable ID and item hash; no omitted or extra cards, duplicates, or invalid JSON.
2. Every assigned code has exactly one explicit verdict, including unknown and
   provenance-only codes (flag these; don't pretend they are MATATAG competencies).
3. Every proposed code exists in the supplied catalogue, is unique, and has direct
   evidence. Retained bad tags are not silently carried into a corrected set.
4. Disposition and proposed set agree. Check proposed primary code, grade/quarter,
   exclusions, and source/runtime discrepancies. Preserve raw first-pass findings.
5. Write `checkpoint.json` with packet paths, completed item hashes, unfinished IDs,
   next offset/filter/snapshot, counts by disposition, and exact next command.

Then write a brief batch summary: audited **unique cards**, code assignments reviewed,
keep/correct/exclude/uncertain counts, translation/factual flags, common failure modes,
and 2–3 representative evidence-backed examples. Count reviewed cards separately
from approved corrections. Do not infer a catalogue-wide error rate from this targeted
high-risk sample. Use a separately recorded random/stratified sample for that estimate.

## Second pass and integration (separate work)

Every proposed correction/exclusion and uncertain case gets an independent second
review. The integrator/coordinator can assign that as another in-session task; the
first-pass agent need not spawn anything. Also sample at least 10% of accepted cards,
stratified across grade/topic, with at least one per completed batch. Store second
reviews separately. Conflicts go to adjudication; unresolved cases remain unapproved.

The integration agent should:

- Recheck source fingerprints; resolve stale IDs by `fact_id`, never ordinal ID alone.
- Apply approved outcomes through versioned, stable-fact-ID overrides with evidence
  links and provenance. The existing `curriculumTagExclusions.json` supports removals;
  a general reviewed replacement override must be implemented and validated before
  applying relabels. Do not directly patch generated JSON as the only durable fix.
- Make regeneration respect reviewed overrides after automatic labels are assembled.
  Derive primary grade/quarter/domain, codes, cells, and normalization consistently.
  Ensure exclusions cannot reappear through the DepEd provenance fallback.
- Regenerate runtime tags and compare actual topic membership before/after. Add
  regression cases for approved bad tags; test retained/direct cases too. Check
  full-card text against the topic, not merely that IDs belong to a set.
- Report topic counts, newly empty/thin topics (the app hides topics below 3 cards),
  grade/quarter coverage changes, and existing saved-cursor behavior when topics vanish.
- Recheck automatic image-pack coverage if a correction adds a new grade association;
  the pack builder uses curriculum tags. Do not publish a manifest whose assets are absent.
- Keep APK build/deployment as a distinct requested task after the reviewable diff and
  validation pass. No audit result should change a student's app by itself.

## Copyable task prompt

> Audit curriculum tags using `tools/curriculum-tag-audit/README.md` in the unified
> worktree. Start with Grade 6 / G6-L-2, ten cards, unless the coordinator has assigned
> another disjoint scope. Choose subsequent batch sizes to fit your available window.
> Review every assigned tag against complete card text and exact competency wording.
> Produce JSONL findings, evidence, a summary, and a resumable checkpoint. Do not call
> paid model APIs, spawn agents, alter production tags, rebuild APKs, or deploy. Stop
> between batches with the exact resume command when your remaining budget is low.
