#!/usr/bin/env python3
"""Simulate draft content capacity against explicit synthetic coverage/exposure.

Not an app selector. Never treats draft questions or synthetic cohorts as approved.
"""
import copy
import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rag/assessment-authoring'
NOW = datetime(2026, 9, 28, 4, 0, tzinfo=timezone.utc)


def parse_time(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError('Exposure timestamps must carry a timezone')
    return parsed


def recent_exposure(item, profile, now):
    """Require linked, versioned teaching text in the presented language."""
    for event in profile.get('exposures', []):
        if event.get('card_id') not in item['eligibility']['recent_learning']['source_card_ids']:
            continue
        fact = teaching_fact(item, event['card_id'])
        language = event.get('language')
        if not fact or language not in ('en', 'tl', 'bis'):
            continue
        digest = hashlib.sha256(fact[language].encode('utf-8')).hexdigest()
        if (event.get('knowledge_presented') is True
                and event.get('knowledge_family_id') == item['relationships']['knowledge_family_id']
                and event.get('presented_text_sha256') == digest
                and now - timedelta(days=14) <= parse_time(event['at']) <= now):
            return True
    return False


def teaching_fact(item, card_id):
    primary = item['provenance']['primary']
    if card_id in primary['card_ids']:
        return primary['fact']
    for link in item['provenance'].get('additional_teaching_cards', []):
        if link['card_id'] == card_id and link.get('review_status') == 'author_source_checked':
            return link['fact']
    return None


def available(item, profile, now, *, draft_mode=False):
    if item['status'] in ('hold', 'retired'):
        return False
    if not draft_mode and not (item['status'] == 'ready_for_pilot' and item['production_ready']):
        return False
    grade = item['scope']['material_grade']
    if grade > profile['student_grade']:
        return False
    if recent_exposure(item, profile, now):
        return True
    if item['scope']['target_id'] in profile.get('teacher_covered_targets', []):
        return True
    return (grade == profile['student_grade'] - 1
            and (grade, item['scope']['curriculum_version']) in profile.get('confirmed_prior_curricula', set()))


def source_ids(item):
    """Include source-bank links to prevent reusing one question under another card ID."""
    p = item['provenance']['primary']
    return {f for f in (p['fact_id'], p.get('bank_fact_id')) if f}


def choose(slots, history, *, max_repeats=2):
    """Jointly select all blocks; no greedy benchmark choice may strand recent slots."""
    recent_ids = {x for session in history[-3:] for x in session}
    # Stable order of equivalent slots avoids permutations of the same recent block.
    ordered = sorted(slots, key=lambda s: (len(s['candidates']), s['role'] != 'benchmark', s['id']))
    full_sets = {frozenset(form) for form in history}

    def visit(pos, chosen, families, facts, repeats, previous_by_role):
        if pos == len(ordered):
            return None if frozenset(x['item_id'] for x in chosen) in full_sets else chosen
        slot = ordered[pos]
        rows = sorted(slot['candidates'], key=lambda i: (i['id'] in recent_ids, i['id']))
        for item in rows:
            fid = item['relationships']['knowledge_family_id']
            identities = source_ids(item)
            repeated = int(item['id'] in recent_ids)
            key = (item['id'] in recent_ids, item['id'])
            if slot['role'] != 'benchmark' and key <= previous_by_role.get(slot['role'], (-1, '')):
                continue
            if fid in families or identities & facts or repeats + repeated > max_repeats:
                continue
            last = dict(previous_by_role)
            if slot['role'] != 'benchmark':
                last[slot['role']] = key
            selected = dict(slot_id=slot['id'], role=slot['role'], item_id=item['id'], exact_repeat=bool(repeated))
            found = visit(pos + 1, chosen + [selected], families | {fid}, facts | identities,
                          repeats + repeated, last)
            if found is not None:
                return found
        return None
    return visit(0, [], set(), set(), 0, {})


def assemble(items, blueprint, profile, now, history, *, draft_mode=False):
    eligible = {k: i for k, i in items.items() if available(i, profile, now, draft_mode=draft_mode)}
    slots = [dict(id=s['id'], role='benchmark', candidates=[eligible[x] for x in s['candidate_item_ids'] if x in eligible])
             for s in blueprint['benchmark_slots']]
    if any(not s['candidates'] for s in slots):
        return dict(status='defer', reason='At least one fixed benchmark slot lacks an eligible candidate.')
    recent = [i for i in eligible.values() if recent_exposure(i, profile, now)]
    # Supplements require prior-grade scope even if some current-grade targets are teacher-covered.
    supplements = [i for i in eligible.values() if i['scope']['material_grade'] == profile['student_grade'] - 1
                   and not recent_exposure(i, profile, now)]
    for count in range(6, -1, -1):
        trial = slots + [dict(id=f'recent-{n}', role='recent', candidates=recent) for n in range(count)]
        trial += [dict(id=f'supplement-{n}', role='readiness_supplement', candidates=supplements) for n in range(6-count)]
        if any(not s['candidates'] for s in trial):
            continue
        chosen = choose(trial, history)
        if chosen is not None:
            return dict(status='assembled', selected=chosen, roles=dict(Counter(s['role'] for s in chosen)),
                        exact_repeats=sum(s['exact_repeat'] for s in chosen),
                        current_grade_items=sum(items[s['item_id']]['scope']['material_grade'] == profile['student_grade'] for s in chosen),
                        retention_denominator=sum(s['role'] == 'recent' for s in chosen),
                        note='Readiness supplements are not recent-learning retention observations.')
    return dict(status='defer', reason='Twelve eligible distinct items cannot satisfy all blocks and repeat limits along this history.')


def exposure(item, when, *, card_id=None, language='en'):
    card_id = card_id or item['eligibility']['recent_learning']['source_card_ids'][0]
    fact = teaching_fact(item, card_id)
    assert fact is not None, 'Fixture card lacks reviewed teaching provenance'
    return dict(card_id=card_id, language=language,
                presented_text_sha256=hashlib.sha256(fact[language].encode('utf-8')).hexdigest(),
                knowledge_family_id=item['relationships']['knowledge_family_id'],
                knowledge_presented=True, at=when.isoformat())


def profile_for(items, blueprint, confirmed=True):
    version = items[blueprint['baseline_example_item_ids'][0]]['scope']['curriculum_version']
    return dict(student_grade=blueprint['student_grade'],
                confirmed_prior_curricula={(blueprint['material_grade'], version)} if confirmed else set(),
                teacher_covered_targets=[], exposures=[])


def audit_form(result, items, profile, now, history):
    assert result['status'] == 'assembled'
    rows = [items[s['item_id']] for s in result['selected']]
    assert len(rows) == 12 and len({r['id'] for r in rows}) == 12
    assert len({r['relationships']['knowledge_family_id'] for r in rows}) == 12
    seen = set()
    for row in rows:
        assert not source_ids(row) & seen
        seen |= source_ids(row)
        assert available(row, profile, now, draft_mode=True)
    old = {x for form in history[-3:] for x in form}
    assert sum(r['id'] in old for r in rows) <= 2
    assert {r['id'] for r in rows} not in [set(form) for form in history]
    for selected in result['selected']:
        if selected['role'] == 'recent':
            assert recent_exposure(items[selected['item_id']], profile, now)
        elif selected['role'] == 'readiness_supplement':
            assert items[selected['item_id']]['scope']['material_grade'] == profile['student_grade'] - 1


def run_fixture(items, blueprint, fixture):
    baseline = blueprint['baseline_example_item_ids']
    prior_example = items[baseline[0]]
    exposure_groups = fixture['exposure_groups']
    example = items[exposure_groups[0][0]]
    assert example['scope']['material_grade'] == blueprint['student_grade']
    make_profile = lambda confirmed=True: profile_for(items, blueprint, confirmed)
    passed = []

    def check(name, condition):
        assert condition, name
        passed.append(name)

    p = make_profile()
    check('drafts never become live eligible', not available(prior_example, p, NOW))
    check('September alone does not permit current-grade material', not available(example, p, NOW, draft_mode=True))
    check('prior-grade label alone does not verify cohort', not available(prior_example, make_profile(False), NOW, draft_mode=True))
    p['exposures'] = [exposure(example, NOW - timedelta(days=14))]
    check('fourteen-day boundary included', recent_exposure(example, p, NOW))
    p['exposures'][0]['at'] = (NOW-timedelta(days=14, seconds=1)).isoformat()
    check('older exposure excluded', not recent_exposure(example, p, NOW))
    p['exposures'][0]['at'] = (NOW+timedelta(seconds=1)).isoformat()
    check('future exposure excluded', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW)]
    p['exposures'][0]['knowledge_family_id'] = 'another-fact-on-same-card'
    check('wrong knowledge link excluded', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW)]
    p['exposures'][0]['knowledge_presented'] = False
    check('card-ID event alone insufficient', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW)]
    p['exposures'][0].pop('presented_text_sha256')
    check('missing teaching version excluded', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW)]
    p['exposures'][0]['presented_text_sha256'] = 'obsolete-source-version'
    check('obsolete teaching text excluded', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW)]
    p['exposures'][0]['language'] = 'unknown'
    check('unknown presented language excluded', not recent_exposure(example, p, NOW))
    p['exposures'] = [exposure(example, NOW, language='bis')]
    check('matching Cebuano teaching version accepted', recent_exposure(example, p, NOW))
    p['exposures'] = []
    p['teacher_covered_targets'] = [example['scope']['target_id']]
    check('specific teacher coverage permits current-grade candidate', available(example, p, NOW, draft_mode=True))
    check('teacher coverage is not a recent Hiraia exposure', not recent_exposure(example, p, NOW))
    held = copy.deepcopy(example); held['status'] = 'hold'
    check('explicit hold overrides coverage', not available(held, p, NOW, draft_mode=True))
    p['student_grade'] = blueprint['material_grade']
    check('higher-grade item rejected despite teacher target', not available(example, p, NOW, draft_mode=True))

    # Explicit card knowledge fixtures, never real learner data or random exposure.
    rich = []
    history = [baseline]
    for session in range(fixture['sessions']):
        now = NOW + timedelta(days=14*(session+1))
        p = make_profile()
        exposed = [items[item_id] for item_id in exposure_groups[session % len(exposure_groups)]]
        p['exposures'] = [exposure(i, now - timedelta(days=n+1)) for n,i in enumerate(exposed)]
        result = assemble(items, blueprint, p, now, history, draft_mode=True)
        audit_form(result, items, p, now, history)
        assert result['roles'] == {'benchmark':6, 'recent':6}
        rich.append(dict(session=session+1, at=now.isoformat(), exposure_fixture=p['exposures'], **result))
        history.append([x['item_id'] for x in result['selected']])
    check('all complete fortnights satisfy all form invariants', len(rich) == fixture['sessions'])

    p = make_profile()
    p['exposures'] = [exposure(example, NOW-timedelta(days=1)) for _ in range(8)]
    sparse = assemble(items, blueprint, p, NOW, [baseline], draft_mode=True)
    audit_form(sparse, items, p, NOW, [baseline])
    check('eight views of one family count as one recent item', sparse['roles'] == {'benchmark':6, 'recent':1, 'readiness_supplement':5})
    empty_profile = make_profile()
    empty = assemble(items, blueprint, empty_profile, NOW, [baseline], draft_mode=True)
    audit_form(empty, items, empty_profile, NOW, [baseline])
    check('zero exposure yields no retention claims or current-grade questions', empty['retention_denominator'] == 0 and empty['current_grade_items'] == 0)
    unknown = assemble(items, blueprint, make_profile(False), NOW, [baseline], draft_mode=True)
    check('unknown cohort with no coverage defers', unknown['status'] == 'defer')
    live = assemble(items, blueprint, make_profile(), NOW, [baseline], draft_mode=False)
    check('all live-mode draft attempts defer', live['status'] == 'defer')
    # A complete prior form cannot be recycled when no alternative candidates exist.
    exhausted_items = {k:items[k] for k in baseline}
    exhausted = assemble(exhausted_items, blueprint, make_profile(), NOW, [baseline], draft_mode=True)
    check('exhausted pool defers instead of reusing paper', exhausted['status'] == 'defer')

    return dict(blueprint=blueprint['id'], student_grade=blueprint['student_grade'],
        synthetic_prior_curriculum_confirmation=True, baseline_item_ids=baseline,
        initial_baseline_eligibility_checked=all(available(items[x], make_profile(), NOW, draft_mode=True) for x in baseline),
        controls=passed, controls_passed=len(passed), rich_exposure_sessions=rich,
        sparse_exposure=sparse, no_exposure=empty, unknown_cohort=unknown, live_mode=live, exhausted_pool=exhausted,
        limits=['Scenario exposure and cohort confirmation are synthetic, not observations of a learner.',
                'Success proves this constructed schedule can be assembled; it does not prove all possible learner histories can.',
                'A failed sequential search is not proof that no alternative earlier schedule could work.',
                'Languages, science quality, practical skills and equivalent form difficulty are not certified.',
                'Readiness supplements must not enter the recent-retention denominator.',
                'Any fixed exact-repeat anchors can benefit from familiarity; report that exposure.',
                'See exposure-link-audit.md: curated card histories do not establish six recent questions are normally available.'])


def main():
    items = {i['id']:i for p in sorted((OUT/'batches').glob('*.json')) if not p.name.endswith('.validation.json')
             for i in json.loads(p.read_text())['items']}
    config = json.loads((OUT/'blueprints.json').read_text())
    fixtures = json.loads((OUT/'exposure-fixtures.json').read_text())['blueprints']
    blueprints = {b['id']: b for b in config['blueprints']}
    reports = [run_fixture(items, blueprints[key], fixture) for key, fixture in fixtures.items()]
    # Exercise a real reviewed additional-card route, not a synthetic provenance
    # approval. Removing the review must revoke eligibility even if the ID stays.
    linked = next(i for i in items.values() if i['provenance'].get('additional_teaching_cards'))
    linked_card = linked['provenance']['additional_teaching_cards'][0]['card_id']
    link_controls = []
    for language in ('en', 'tl', 'bis'):
        p = dict(exposures=[exposure(linked, NOW, card_id=linked_card, language=language)])
        assert recent_exposure(linked, p, NOW)
        link_controls.append(f'reviewed additional card accepted in {language}')
    changed = copy.deepcopy(linked)
    changed['provenance']['additional_teaching_cards'] = []
    assert not recent_exposure(changed, p, NOW)
    link_controls.append('additional card ID without reviewed provenance rejected')
    changed = copy.deepcopy(linked)
    changed['provenance']['additional_teaching_cards'][0]['review_status'] = 'unreviewed'
    assert not recent_exposure(changed, p, NOW)
    link_controls.append('unreviewed additional card rejected')
    report = dict(created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                  mode='synthetic draft content-capacity simulation only', production_enabled=False,
                  blueprints=reports, additional_teaching_link_controls=link_controls,
                  controls_passed=sum(r['controls_passed'] for r in reports)+len(link_controls),
                  not_yet_simulated=[key for key,b in blueprints.items() if key not in fixtures and b['status']=='draft_content_blueprint'])
    (OUT/'form-simulation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    lines = ['# Full-form content simulation', '', f'Generated: {report["created_at"]}', '',
             '**Synthetic draft check only. No questions are approved for a child.**', '',
             'Each named fixture starts with a prior-grade baseline and constructs subsequent 12-item forms. A fortnight fixture explicitly exposes eight current-grade card knowledge links; six are selected. Four exposure groups repeat after eight weeks. These are deliberately sufficient histories, not a model of typical use.', '']
    for r in reports:
        lines += [f'## {r["blueprint"]}', '', '| Session | Benchmark | Recent | Readiness supplement | Exact repeats in last three forms |',
                  '|---|---:|---:|---:|---:|']
        for s in r['rich_exposure_sessions']:
            lines.append(f'| {s["session"]} | {s["roles"].get("benchmark",0)} | {s["roles"].get("recent",0)} | {s["roles"].get("readiness_supplement",0)} | {s["exact_repeats"]} |')
        lines += ['', f'{r["controls_passed"]} adversarial/scenario checks pass for this blueprint.', '']
    lines += ['', 'Every assembled form has twelve distinct item IDs, knowledge families and source-question/fact identities. No whole paper repeats. The incoming-Grade-4 proposal’s two repeated anchors use the entire repeat allowance.', '',
              'Eight encounters with the same card knowledge yield **one** recent item plus five labelled readiness supplements. With no recent encounters, all six non-benchmark items are readiness supplements and there is **no retention score**. Unknown prior curriculum with no other coverage, an exhausted pool, and live mode with these drafts all defer.', '',
              'Exposure requires a reviewed card-to-claim link, the presented language and the SHA-256 of that language’s teaching body. A matching card ID alone cannot establish exposure to the reviewed wording. Additional-card routes are checked in all three languages; removing their review revokes eligibility.', '',
              f'{report["controls_passed"]} total scenario checks passed. The complete fixtures and chosen item IDs are in [form-simulation.json](form-simulation.json).', '',
              'Not yet simulated: '+', '.join(report['not_yet_simulated'])+'.', '',
              'This result covers only the named blueprints and synthetic histories. It does not clear remaining grades, confirm a cohort curriculum, validate translations, or establish form equivalence. The [actual lesson-link audit](exposure-link-audit.md) measures the substantial coverage gap omitted by curated exposure fixtures.', '',
              'See [rotation design decisions](ROTATION-DESIGN.md), [pool review](pool-review.md) and [work status](STATUS.md).', '']
    (OUT/'form-simulation.md').write_text('\n'.join(lines))
    print(json.dumps(dict(controls=report['controls_passed'], blueprints=[dict(id=r['blueprint'], full_sessions=len(r['rich_exposure_sessions']), sparse_roles=r['sparse_exposure']['roles'], live_status=r['live_mode']['status']) for r in reports])))


if __name__ == '__main__':
    main()
