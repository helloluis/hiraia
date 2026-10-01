#!/usr/bin/env python3
"""Review combined draft coverage and benchmark repetition capacity, never pilot approval."""
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rag/assessment-authoring'
DOMAINS = ('MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE')


def choose_benchmark(slots, candidates, previous, max_repeats=2):
    """Backtrack over the small six-slot block; do not mistake greedy failure for capacity."""
    recent_ids = {x for form in previous[-3:] for x in form}

    def visit(position, selected, families, facts, repeats):
        if position == len(slots):
            return selected
        slot = slots[position]
        available = sorted(candidates.get(slot, []), key=lambda i: (i['id'] in recent_ids, i['id']))
        for item in available:
            family = item.get('relationships', {}).get('knowledge_family_id', slot)
            p = item['provenance']['primary']
            identities = {x for x in (p['fact_id'], p.get('bank_fact_id')) if x}
            repeated = int(item['id'] in recent_ids)
            if family in families or identities & facts or repeats + repeated > max_repeats:
                continue
            found = visit(position + 1, selected + [item['id']], families | {family},
                          facts | identities, repeats + repeated)
            if found is not None:
                return found
        return None

    return visit(0, [], set(), set(), 0)


def rotation(slots, candidates, sessions=8):
    forms = []
    for n in range(sessions):
        form = choose_benchmark(slots, candidates, forms)
        if form is None:
            return dict(passes=False, failed_session=n + 1, forms=forms)
        forms.append(form)
    return dict(passes=True, failed_session=None, forms=forms)


def controls():
    def fake(family, n):
        return dict(id=f'{family}-{n}', provenance=dict(primary=dict(fact_id=f'{family}-{n}')))
    families = [f'f{i}' for i in range(6)]
    one = {f: [fake(f, 0)] for f in families}
    four = {f: [fake(f, n) for n in range(4)] for f in families}
    assert rotation(families, one)['failed_session'] == 2
    assert rotation(families, four)['passes']
    assert choose_benchmark(['f0', 'f0'], four, []) is None
    shared = {f: [fake(f, 0)] for f in families}
    for rows in shared.values():
        rows[0]['provenance']['primary']['fact_id'] = 'shared-source-fact'
    assert choose_benchmark(families, shared, []) is None
    # Two repeated IDs are permitted, including repeats from the third most recent form.
    previous = [[f'f0-0', 'f1-0'], [], []]
    assert choose_benchmark(families, one, previous) is not None
    previous[0].append('f2-0')
    assert choose_benchmark(families, one, previous) is None
    # A history older than the three-session window must not block a candidate.
    assert choose_benchmark(families, one, [[f'{f}-0' for f in families], [], [], []]) is not None
    overlapping = {f: [dict(fake(f, 0), relationships=dict(knowledge_family_id='same'))] for f in families}
    assert choose_benchmark(families, overlapping, []) is None
    for rows in four.values():
        for row in rows:
            row['provenance']['primary']['bank_fact_id'] = 'same-bank-question'
    assert choose_benchmark(families, four, []) is None
    return 9


def main():
    checks = controls()
    items = []
    for path in sorted((OUT / 'batches').glob('*.json')):
        if not path.name.endswith('.validation.json'):
            items.extend(json.loads(path.read_text())['items'])
    by_id = {i['id']: i for i in items}
    assert len(by_id) == len(items), 'Assessment IDs must be globally unique'
    exact = {lang: defaultdict(list) for lang in ('en', 'tl', 'bis')}
    for item in items:
        for lang in exact:
            key = (item['content']['stem'][lang], tuple(o['text'][lang] for o in item['content']['options']))
            exact[lang][key].append(item['id'])
    duplicates = {lang: [ids for ids in groups.values() if len(ids) > 1] for lang, groups in exact.items()}
    assert not any(duplicates.values()), f'Exact duplicate assessment content: {duplicates}'
    candidates = defaultdict(list)
    for item in items:
        if item['status'] not in ('hold', 'retired'):
            candidates[item['relationships']['knowledge_family_id']].append(item)
    coverage = []
    for grade in range(3, 11):
        selected = [i for i in items if i['scope']['material_grade'] == grade]
        coverage.append(dict(material_grade=grade, items=len(selected),
            held=sum(i['status'] == 'hold' for i in selected),
            families=len({i['relationships']['knowledge_family_id'] for i in selected}),
            domains={d: sum(i['scope']['domain'] == d for i in selected) for d in DOMAINS}))
    config = json.loads((OUT / 'blueprints.json').read_text())
    simulation_path = OUT / 'form-simulation.json'
    simulations = {r['blueprint']:r for r in json.loads(simulation_path.read_text()).get('blueprints', [])} if simulation_path.exists() else {}
    blueprints = []
    for blueprint in config['blueprints']:
        baseline = [by_id[x] for x in blueprint['baseline_example_item_ids']]
        assert len(baseline) == 12 and all(i['status'] not in ('hold', 'retired') for i in baseline)
        assert len({i['relationships']['knowledge_family_id'] for i in baseline}) == 12
        assert len({i['provenance']['primary']['fact_id'] for i in baseline}) == 12
        assert dict(Counter(i['scope']['domain'] for i in baseline)) == blueprint['baseline_domain_counts']
        assert all(i['scope']['material_grade'] == blueprint['material_grade'] for i in baseline)
        baseline_roles = blueprint['baseline_benchmark_item_ids']
        assert len(baseline_roles) == 6 and len(set(baseline_roles.values())) == 6
        assert set(baseline_roles.values()) | set(blueprint['baseline_readiness_probe_ids']) == set(blueprint['baseline_example_item_ids'])
        assert not set(baseline_roles.values()) & set(blueprint['baseline_readiness_probe_ids'])
        slots = [s['id'] for s in blueprint['benchmark_slots']]
        assert len(slots) == 6
        grade_candidates = {}
        for slot in blueprint['benchmark_slots']:
            source = ([by_id[x] for x in slot['candidate_item_ids']] if 'candidate_item_ids' in slot
                      else candidates[slot['knowledge_family_id']])
            grade_candidates[slot['id']] = [i for i in source if i['scope']['material_grade'] == blueprint['material_grade'] and i['status'] not in ('hold', 'retired')]
            assert baseline_roles[slot['id']] in {i['id'] for i in grade_candidates[slot['id']]}
        blueprints.append(dict(id=blueprint['id'], baseline_structural_coverage_passes=True,
            benchmark_only_rotation=rotation(slots, grade_candidates),
            family_forms=[dict(family=f, selected=len(grade_candidates[f]),
                               knowledge_families=sorted({i['relationships']['knowledge_family_id'] for i in grade_candidates[f]}),
                               short_of_four_form_screen=max(0, 4-len(grade_candidates[f]))) for f in slots],
            full_form_rotation=('See form-simulation.md for synthetic exposure scenarios; no real learner eligibility is established.'
                                if blueprint['id'] in simulations
                                else 'Not yet simulated for this blueprint.'),
            language_teacher_curriculum_gate='not passed; no production or pilot eligibility'))
    report = dict(created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        items=len(items), language_versions=3*len(items), origins=dict(Counter(i['origin'] for i in items)),
        pilot_ready=sum(i['status'] == 'ready_for_pilot' for i in items),
        holds=[dict(id=i['id'], reasons=i['review']['holds']) for i in items if i['status'] == 'hold'],
        coverage=coverage, blueprints=blueprints, exact_content_duplicates=duplicates, controls_passed=checks,
        unresolved_student_grades=config['unresolved_student_grades'],
        limits='Draft content-capacity check. Does not approve translations, comparable difficulty, curriculum cohorts, date eligibility or app behavior.')
    (OUT / 'pool-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    lines = ['# Combined draft pool review', '', f'Generated: {report["created_at"]}', '',
             f'{len(items)} items / {len(items)*3} language versions. Origins: {report["origins"]}. **Pilot-ready: {report["pilot_ready"]}.**', '',
             '| Material grade | Items | Knowledge families | Explicit holds | Matter | Living things | Physical | Earth/space |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    for row in coverage:
        lines.append('| '+ ' | '.join(map(str, [row['material_grade'],row['items'],row['families'],row['held']]+[row['domains'][d] for d in DOMAINS]))+' |')
    for result in blueprints:
        r=result['benchmark_only_rotation']
        lines += ['', f'## {result["id"]}', '', 'The draft baseline has twelve distinct families and source facts, with three items per domain. This is structural coverage only.', '',
                  f'Benchmark-only eight-session capacity check: **{"PASS" if r["passes"] else "FAIL"}**'+(f'; first unavailable session: {r["failed_session"]}.' if not r['passes'] else '.'), '',
                  '| Benchmark slot | Selected non-held draft forms | Additional forms for a zero-repeat four-form screen |', '|---|---:|---:|']
        for family in result['family_forms']:
            lines.append(f'| {family["family"]} | {family["selected"]} | {family["short_of_four_form_screen"]} |')
        lines += ['', 'The four-form screen is sufficient for zero benchmark repeats over the previous three sessions; it is not a minimum generation quota. Cosmetic rewrites do not establish distinct forms. Meaningful forms need review and later calibration.', '']
        if result['id'].endswith('grade3-proposal-v2'):
            lines += ['The two repeat-permitted anchors in this revision can remain singletons for a structural rotation test. This does not establish educational adequacy.', '',
                      'See [full-form simulation](form-simulation.md) for synthetic exposure and sparse-pool checks. Real learner eligibility and empirical form equivalence remain unverified.']
        elif result['id'] in simulations:
            lines += ['See the [full twelve-item simulation](form-simulation.md) for the explicitly named synthetic histories. The [lesson-link audit](exposure-link-audit.md) separately reports actual shelf coverage.']
        else:
            lines += ['Full twelve-item follow-up simulation has not been completed for this blueprint.']
    lines += ['', f'Controls: {checks}/9. Exact content duplicate groups: {sum(len(x) for x in duplicates.values())}.', '', report['limits'], '',
              'See [blueprints.json](blueprints.json), [target ledger](targets.md) and [current work queue](STATUS.md).', '']
    (OUT / 'pool-review.md').write_text('\n'.join(lines))
    print(json.dumps(dict(items=len(items), controls_passed=checks, blueprint_rotation=[dict(id=b['id'], **b['benchmark_only_rotation']) for b in blueprints])))


if __name__ == '__main__':
    main()
