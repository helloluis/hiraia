#!/usr/bin/env python3
"""Summarize the reviewed draft pool without upgrading its approval status."""
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rag/assessment-authoring'
AUDIT = ROOT / 'tools/assessment-evaluation/reports/2026-09-28'


def main():
    paths = [p for p in sorted((OUT / 'batches').glob('*.json')) if not p.name.endswith('.validation.json')]
    batches = [json.loads(p.read_text()) for p in paths]
    items = [i for b in batches for i in b['items']]
    assert len(items) == len({i['id'] for i in items})
    validations = [json.loads(p.with_suffix('.validation.json').read_text()) for p in paths]
    for b, v in zip(batches, validations):
        assert not v['errors'], b['batch_id']
        assert len(v['controls']) == 25 and all(c['passed'] for c in v['controls'])
        assert v['origin_counts'] == dict(Counter(i['origin'] for i in b['items']))
        assert v['item_count'] == len(b['items'])
    pool = json.loads((OUT / 'pool-review.json').read_text())
    forms = json.loads((OUT / 'form-simulation.json').read_text())
    exposure = json.loads((OUT / 'exposure-link-audit.json').read_text())
    assert pool['items'] == exposure['draft_items'] == len(items)
    assert not any(pool['exact_content_duplicates'].values())
    for p in paths:
        assert exposure['source_files'][str(p.relative_to(ROOT))] == hashlib.sha256(p.read_bytes()).hexdigest()

    coverage = {}
    for label, key, scope_key in [('subcategories', 'id', 'subcategory_id'), ('competencies', 'code', 'internal_competency_code')]:
        with (AUDIT / f'{label}.csv').open() as f:
            raw = list(csv.DictReader(f))
        rows = []
        for r in raw:
            selected = [i for i in items if i['scope'][scope_key] == r[key]]
            nonheld = [i for i in selected if i['status'] not in ('hold', 'retired')]
            rows.append(dict(id=r[key], grade=r['grade'], domain=r['domain'], title=r.get('title', r.get('text')),
                draft_items=len(selected), nonheld_drafts=len(nonheld), held_items=len(selected)-len(nonheld),
                knowledge_families=len({i['relationships']['knowledge_family_id'] for i in nonheld}),
                coverage='narrow supporting recall sampled; not full mastery' if nonheld else 'not sampled by a non-held draft',
                item_ids='|'.join(i['id'] for i in selected)))
        with (OUT / f'authored-{label}.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
        coverage[label] = dict(total=len(rows), with_any_draft=sum(r['draft_items'] > 0 for r in rows),
            with_nonheld_draft=sum(r['nonheld_drafts'] > 0 for r in rows),
            unsampled=sum(r['nonheld_drafts'] == 0 for r in rows))

    report = dict(created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        status='selected blueprint authoring pass complete; human review, coverage expansion and app validation remain separate',
        batches=len(batches), items=len(items), language_versions=3*len(items),
        origins=dict(Counter(i['origin'] for i in items)), statuses=dict(Counter(i['status'] for i in items)),
        production_ready=sum(i['production_ready'] for i in items),
        knowledge_families=len({i['relationships']['knowledge_family_id'] for i in items}),
        target_records=len(json.loads((OUT/'targets.json').read_text())['targets']),
        coverage=coverage, grades=pool['coverage'], holds=pool['holds'],
        validation=dict(batch_controls_per_batch=25, batches_passed=len(validations), pool_controls=pool['controls_passed'],
            full_form_controls=forms['controls_passed'], exposure_count_controls=exposure['controls_passed'],
            exact_duplicate_groups=sum(len(x) for x in pool['exact_content_duplicates'].values()),
            simulated_student_grades=[b['student_grade'] for b in forms['blueprints']],
            synthetic_followups_per_grade=8, independent_model_review_items=100,
            native_speaker_review=False, teacher_review=False, student_pilot=False),
        exposure=dict(linked_core_cards=exposure['linked_core_cards'], total_core_cards=exposure['core_cards'],
            lesson_count=sum(g['lessons'] for g in exposure['grades']),
            single_lessons_with_six_family_upper_bound=sum(g['lesson_window_capacity']['1']['at_least_six_upper_bound'] for g in exposure['grades'])),
        source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
    (OUT/'authoring-summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    o=report['origins']; c=report['coverage']; e=report['exposure']
    lines = ['# Assessment authoring handover — 28 September 2026', '',
        f'**{len(items)} questions in {len(batches)} batches; {len(items)*3:,} English, Tagalog and Cebuano versions.** This completes the selected-blueprint drafting pass, not classroom validation or full curriculum coverage.', '',
        f'Origins: **{o["reuse"]} exact reuses, {o["revise"]} revisions, {o["alternate"]} alternate forms, {o["new"]} entirely new questions**. Five held questions are excluded. The other 633 remain `source_checked` drafts; zero are marked production-ready or pilot-approved.', '',
        'The earlier estimate of about 800 new questions was a provisional planning allowance. Existing questions supplied most selected targets after revision. This result does not establish a final generation requirement for all topics or ordinary recent-card coverage.', '',
        '| Material grade | Drafts | Held | Knowledge families |', '|---|---:|---:|---:|']
    for g in report['grades']:
        lines.append(f'| {g["material_grade"]} | {g["items"]} | {g["held"]} | {g["families"]} |')
    lines += ['', '## What the evidence supports', '',
        '- Every selected item has pinned teaching/bank provenance, one scored claim, three language versions, stable options and a review record. Existing source errors were narrowed away or held rather than copied into assessed claims.',
        '- All 33 batches pass 25 mechanical controls each. The combined pool passes nine controls with no exact content duplicates. These checks do not certify science, language fluency or item difficulty.',
        '- Seven incoming-grade blueprints (Grades 4–10) pass eight constructed fortnight follow-ups each, with twelve unique families/source identities, six benchmark and six recent items, no repeated whole paper, and at most two exact repeats from the preceding three forms. The old failing Grade 4 proposal is retained as negative evidence.',
        '- All 159 full-form scenario/link checks pass, including sparse exposure, missing or altered teaching-text hashes, language, date boundaries, holds, unknown curriculum and exhausted pools. Synthetic cohort confirmation is a test input, not a verified learner record.',
        '- Separate agents reviewed 100 Grade 9/10 items and primary teaching snapshots in all three languages. Twenty items were repaired during integration. This is independent model review, not native-speaker or teacher approval.', '',
        '## What remains unresolved', '',
        f'- Non-held drafts sample narrow recall in **{c["subcategories"]["with_nonheld_draft"]}/{c["subcategories"]["total"]} subcategories** and **{c["competencies"]["with_nonheld_draft"]}/{c["competencies"]["total"]} internal competency mappings**. These are supporting-knowledge links, not full performance-competency assessments. See the two authored-coverage CSVs.',
        f'- Only **{e["linked_core_cards"]:,}/{e["total_core_cards"]:,}** core cards have accepted non-held assessment links. Only **{e["single_lessons_with_six_family_upper_bound"]}/{e["lesson_count"]}** actual lesson shelves even reach a six-family upper bound if every card is encountered. Typical fortnight histories are unmeasured. Do not promise six recent questions after ordinary usage.',
        '- When fewer recent facts qualify, count the actual recent denominator and label prior-level supplements separately. Defer when twelve items cannot meet the rules. Extra question stems alone will not fix missing teaching-card links.',
        '- Incoming Grade 3 has no approved earlier-learning bridge. Keep its onboarding assessment unavailable; do not call Grade 3 material a Grade 2 exam.',
        '- Cohort-specific published curriculum matching, native/teacher review, student response calibration and broader exposure coverage remain pending. Source-card defects are documented separately and were not repaired in the shipping bank by this authoring pass.',
        '- Single 12-item scores and changing recent-content scores cannot prove a causal effect or justify changing the child’s enrolled grade. Keep benchmark, recent, supplementary and repeated-item evidence distinct.', '',
        '## Authorized app integration', '',
        'At 17:27 GMT+8 the user authorized a new 12-item assessment flow alongside existing mini-quizzes, based on the already merged 0.4.26 work, followed by a signed APK copy to the connected Redmi over USB. No card-mini-quiz replacement bank was produced.', '',
        'The first USB artifact is explicitly a **local assessment evaluation build**. Its opt-in flag may expose non-held source-checked drafts as a Hiraia prior-level practice baseline; records retain unverified cohort and review status. This does not change the production bank’s gates or claim formal MATATAG readiness. Production defaults remain gated. App implementation, runtime tests, signing and transfer have their own completion record.', '',
        '## Files and reproduction', '',
        '- [Question design plan](../../docs/ASSESSMENT-QUESTION-DESIGN-PLAN-20260928.md)',
        '- [Target ledger](targets.md) and [structured ledger](targets.json)',
        '- [Authored subcategory coverage](authored-subcategories.csv) and [competency coverage](authored-competencies.csv)',
        '- [Pool checks](pool-review.md), [full-form simulations](form-simulation.md), [lesson-link coverage](exposure-link-audit.md)',
        '- [Peer-review resolutions](reviews/peer-review-resolutions-20260928.md) and [source repair notes](source-repair-notes.md)',
        '- [Machine-readable summary and input hashes](authoring-summary.json)', '',
        'Run each batch through `review-authoring.py --batch <path> --render` sequentially, then `simulate-forms.py`, `review-pool.py`, `audit-exposure-links.py`, and `summarize-authoring.py` in `tools/assessment-evaluation/`.', '']
    (OUT/'authoring-summary.md').write_text('\n'.join(lines))
    readme=['# Hiraia assessment authoring', '',
        f'**{len(items)} trilingual draft questions across Grades 3–10.** Read the [authoring handover](authoring-summary.md) for scope, counts, holds, coverage and validation. The selected-blueprint drafting pass is complete; language/classroom approval and production enablement are not.', '',
        'Canonical question records live in `batches/*.json`; adjacent Markdown is generated for review. These records adapt the newer merged `quiz-bank-v2.jsonl`. They do not replace ordinary feed mini-quizzes.', '',
        '[Question design contract](../../docs/ASSESSMENT-QUESTION-DESIGN-PLAN-20260928.md) · [Current integration status](STATUS.md) · [Targets](targets.md) · [Full-form simulations](form-simulation.md) · [Actual lesson coverage](exposure-link-audit.md)', '',
        '| Batch | Grade | Items | Readable questions |', '|---|---:|---:|---|']
    for p,b in zip(paths,batches):
        readme.append(f'| {b["batch_id"].split("-")[0]} | {b["scope"]["material_grade"]} | {len(b["items"])} | [{b["title"]}](batches/{p.stem}.md) |')
    readme += ['', 'Five holds remain excluded; all native-speaker, teacher and student-pilot reviews are unperformed. The local evaluation APK is a separate, explicitly enabled preview. No public release authorization is implied.', '',
        'Authoring scripts attach source snapshots, render review records and check structural/selection invariants. They do not generate questions or call a hosted model. Requested authorship model: Astra; the runtime model identifier was not independently recorded.', '']
    (OUT/'README.md').write_text('\n'.join(readme))
    print(json.dumps({k:report[k] for k in ('items','origins','coverage','validation','exposure')},ensure_ascii=False))


if __name__ == '__main__':
    main()
