#!/usr/bin/env python3
"""Read-only assessment inventory. Writes reports, never app/bank inputs.

Uses the newer merged bank explicitly selected by the user. The generated question
file and local SQLite database are deliberately not treated as release evidence.
Counts describe candidates, not validated assessment items. Exact text comparisons
preserve operators, decimal points, case, and other meaningful distinctions.
"""
import argparse
import collections
import csv
import hashlib
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LANGS = ('en', 'tl', 'bis')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def structural_flags(q):
    flags = []
    opts, answer = q.get('options', []), q.get('answer')
    if not isinstance(opts, list) or len(opts) < 2:
        return ['invalid_options']
    if type(answer) is not int or not 0 <= answer < len(opts):
        flags.append('invalid_answer')
    for lang in LANGS:
        if not (q.get('q') or {}).get(lang, '').strip():
            flags.append('missing_stem_' + lang)
        values = [o.get(lang, '') for o in opts]
        if any(not v.strip() for v in values):
            flags.append('missing_option_' + lang)
        if len(set(values)) < len(values):
            flags.append('duplicate_option_' + lang)
        if not (q.get('explanation') or {}).get(lang, '').strip():
            flags.append('missing_explanation_' + lang)
    return flags


def stats(rows):
    rows = list(rows)
    valid = [r for r in rows if not structural_flags(r)]
    longest = {}
    for lang in LANGS:
        score = 0
        for r in valid:
            lengths = [len(o[lang]) for o in r['options']]
            winners = [i for i, n in enumerate(lengths) if n == max(lengths)]
            score += (1 / len(winners)) if r['answer'] in winners else 0
        longest[lang] = round(score / len(valid), 6) if valid else None
    stems = collections.Counter(r['q']['en'] for r in valid)
    return {
        'items': len(rows),
        'versions': dict(collections.Counter(str(r.get('v', 'supplement')) for r in rows)),
        'structurally_valid': len(valid),
        'flags': dict(collections.Counter(f for r in rows for f in structural_flags(r))),
        'option_counts': dict(collections.Counter(len(r.get('options', [])) for r in rows)),
        'types': dict(collections.Counter(r.get('type') or 'unspecified' for r in rows)),
        'difficulty_labels': dict(collections.Counter(str(r.get('difficulty')) for r in rows)),
        'missing_grades': sum(not r.get('grades') for r in rows),
        'missing_concept': sum(r.get('concept') is None for r in rows),
        'distinct_english_stems': len(stems),
        'repeated_english_stem_groups': sum(n > 1 for n in stems.values()),
        'items_beyond_first_identical_english_stem': sum(n - 1 for n in stems.values()),
        'uniform_guess_accuracy_valid_items': round(sum(1 / len(r['options']) for r in valid) / len(valid), 6) if valid else None,
        'longest_option_expected_accuracy_valid_items': longest,
    }


def write_csv(path, rows):
    if not rows:
        return
    with path.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    inputs = {}

    def read(name, lines=False):
        p = ROOT / name
        inputs[name] = {'sha256': digest(p), 'bytes': p.stat().st_size}
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if lines else json.loads(p.read_text())

    bank = read('rag/bank/quiz-bank-v2.jsonl', lines=True)
    by_fact = {q['factId']: q for q in bank}
    assert len(by_fact) == len(bank), 'Duplicate bank fact IDs must be investigated'
    pool = read('rag/pipeline/cardsPool.app.json')
    core = pool['cards']
    cards = list(core)
    tags = read('packages/mobile/src/generated/curriculumTags.generated.json')
    kinds = read('rag/bank/competency-kinds.json')['competencies']
    competencies = {}
    for path in ['rag/sources/curriculum-guides/matatag-elementary-competencies.json',
                 'rag/sources/curriculum-guides/matatag-jhs-competencies.json']:
        for quarter in read(path)['quarters']:
            for c in quarter['competencies']:
                competencies[c['code']] = {**c, 'grade': quarter['grade'], 'quarter': quarter['quarter'], 'domain': quarter['domain']}

    overlay, overlay_codes, lessons = {}, {}, []
    for g in range(3, 11):
        supplement = read(f'packages/mobile/src/data/grade{g}LessonSupplement.json')
        cards.extend(supplement['cards'])
        overlay_codes.update(supplement['competencies'])
        for fid, q in supplement['questions'].items():
            overlay[fid] = {'factId': fid, 'v': 'supplement', 'q': q['q'],
                            'options': q['o'], 'answer': q['a'], 'explanation': q['e'], 'difficulty': q['d']}
        manifest = read(f'packages/mobile/src/generated/grade{g}Lessons.generated.json')
        lessons.extend({**lesson, 'grade': g} for lesson in manifest['lessons'])
    prereqs = read('packages/mobile/src/data/subcategoryPrerequisites.json')['links']
    card_by_id = {c['id']: c for c in cards}
    assert len(card_by_id) == len(cards), 'Duplicate card IDs must be investigated'
    fact_cards = collections.defaultdict(list)
    for c in cards:
        fact_cards[c['factId']].append(c)
    core_facts = {c['factId'] for c in core}
    matching = {fid: q for fid, q in by_fact.items() if fid in core_facts}
    projected = {**{fid: q for fid, q in by_fact.items() if fid in fact_cards},
                 **{fid: q for fid, q in overlay.items() if fid in fact_cards}}
    valid3 = {fid for fid, q in projected.items() if len(q['options']) == 3 and not structural_flags(q)}

    def counts(fids):
        fids = set(fids)
        return {
            'bank_candidates': len(fids & matching.keys()),
            'v2_rewrite_candidates': sum(matching[f].get('v') == 2 for f in fids & matching.keys()),
            'projected_candidates': len(fids & projected.keys()),
            'projected_valid_3_option': len(fids & valid3),
            'distinct_en_stems_valid_3_option': len({projected[f]['q']['en'] for f in fids & valid3}),
            'supplement_questions': sum(f in overlay for f in fids & projected.keys()),
        }

    code_facts = collections.defaultdict(set)
    for c in cards:
        tag = tags.get(c['id'])
        codes = overlay_codes.get(c['id'])
        if codes is None:
            codes = (tag[5] if len(tag) > 5 and tag[5] else [tag[0]]) if tag and tag[3] >= .2 else []
        for code in codes:
            if code in competencies:
                code_facts[code].add(c['factId'])
    code_rows = []
    for code, c in sorted(competencies.items()):
        code_rows.append({'code': code, 'grade': c['grade'], 'quarter': c['quarter'],
                          'domain': c['domain'], 'text': c['text'], 'kind': kinds.get(code, {}).get('kind'),
                          **counts(code_facts[code])})
    cat_rows = []
    for cat in pool['taxonomy']:
        if not cat['id'].startswith('g') or not cat['id'][1:].split('-')[0].isdigit():
            continue
        fids = {c['factId'] for c in cards if cat['id'] in c.get('cats', [])}
        cat_rows.append({'id': cat['id'], 'grade': int(cat['id'][1:].split('-')[0]),
                         'domain': cat['parent'], 'title': cat['label_en'], 'facts': len(fids),
                         **counts(fids), 'prerequisites': '|'.join(prereqs.get(cat['id'], []))})
    unit_rows = []
    sample_groups = collections.defaultdict(dict)
    rotation_pools = collections.defaultdict(set)
    for lesson in lessons:
        for unit in lesson['units']:
            fids = {card_by_id[c]['factId'] for c in unit['cardIds'] if c in card_by_id}
            unit_rows.append({'grade': lesson['grade'], 'quarter': lesson['quarter'], 'lesson': lesson['key'],
                              'unit': unit['id'], 'competency': unit['competency'], **counts(fids)})
            for fid in fids & matching.keys():
                if matching[fid].get('v') == 2 and fid not in overlay and not structural_flags(matching[fid]):
                    sample_groups[(lesson['grade'], lesson['quarter'])].setdefault(fid, (lesson, unit))
                    rotation_pools[(lesson['grade'], competencies[unit['competency']]['domain'])].add(fid)

    samples = []
    for (grade, quarter), candidates in sorted(sample_groups.items()):
        fid = min(candidates, key=lambda f: hashlib.sha256(f'assessment-20260928:{grade}:{quarter}:{f}'.encode()).hexdigest())
        lesson, unit = candidates[fid]
        q = matching[fid]
        samples.append({'grade': grade, 'quarter': quarter, 'fact_id': fid,
                        'lesson': lesson['key'], 'unit': unit['id'],
                        'competency_text': competencies[unit['competency']]['text'],
                        'question_type': q.get('type'), 'question_en': q['q']['en'],
                        'options_en': [o['en'] for o in q['options']], 'correct_en': q['options'][q['answer']]['en'],
                        'source_facts_en': list(dict.fromkeys(c.get('fact', {}).get('en', '') for c in fact_cards[fid])),
                        'question_tl': q['q']['tl'], 'options_tl': [o['tl'] for o in q['options']],
                        'review': 'pending; exploratory source-consistency review, not a validation sample'})

    def coverage_summary(rows):
        return {str(g): {'total': len(sub := [r for r in rows if r['grade'] == g]),
                         'zero_bank_candidates': sum(r['bank_candidates'] == 0 for r in sub),
                         'zero_projected_3_option': sum(r['projected_valid_3_option'] == 0 for r in sub),
                         'under_6_distinct_stems_3_option': sum(r['distinct_en_stems_valid_3_option'] < 6 for r in sub),
                         'under_12_distinct_stems_3_option': sum(r['distinct_en_stems_valid_3_option'] < 12 for r in sub)}
                for g in range(3, 11)}

    # Optimistic capacity probe only: twelve 12-item forms, three per domain.
    # No repeated exact English stem across forms. This does NOT verify semantic
    # equivalence, recent-view eligibility, calendar eligibility, or item quality.
    rotations = []
    for grade in range(3, 11):
        domains = sorted(d for g, d in rotation_pools if g == grade)
        assert len(domains) == 4
        used_stems, forms = set(), []
        rng = random.Random(20260928 + grade)
        for form in range(12):
            selected = []
            for domain in domains:
                candidates = sorted(rotation_pools[(grade, domain)])
                rng.shuffle(candidates)
                count = 0
                for fid in candidates:
                    stem = matching[fid]['q']['en']
                    if stem in used_stems:
                        continue
                    selected.append(fid)
                    used_stems.add(stem)
                    count += 1
                    if count == 3:
                        break
            forms.append(selected)
        rotations.append({'grade': grade, 'candidate_counts_by_domain': {
            d: len(rotation_pools[(grade, d)]) for d in domains},
            'full_forms': sum(len(f) == 12 for f in forms), 'forms': forms})

    known_mapped = set().union(*code_facts.values())
    summary = {
        'schema': 1,
        'basis': 'User-designated newer bank; working-source projection, not released APK verification.',
        'limits': ['Card-level tags are candidate links, not reviewed question-level competency claims.',
                   'Three-option structural checks do not establish factual quality or calibrated difficulty.',
                   'Exact English stem counts do not establish independent concepts or equivalent forms.',
                   'Coverage across codes/grades is overlapping; do not sum it as unique item count.',
                   'Supplement overlay is reported separately from the newer bank.'],
        'inputs': inputs,
        'inventory': {'core_cards': len(core), 'core_facts': len(core_facts), 'all_cards': len(cards),
                      'all_facts': len(fact_cards), 'supplement_questions': len(overlay),
                      'supplement_overrides_matching_bank': len(overlay.keys() & matching.keys()),
                      'bank_candidates_with_known_code': len(matching.keys() & known_mapped),
                      'v2_candidates_with_known_code': sum(matching[f]['v'] == 2 for f in matching.keys() & known_mapped)},
        'bank_all': stats(bank),
        'bank_matching_core_cards': stats(matching.values()),
        'v2_rewrites_matching_core_cards': stats(q for q in matching.values() if q['v'] == 2),
        'projection_after_supplements': stats(projected.values()),
        'competency_coverage': coverage_summary(code_rows),
        'subcategory_coverage': coverage_summary(cat_rows),
        'lesson_unit_coverage': coverage_summary(unit_rows),
        'broad_rotation_probe': {str(r['grade']): r['full_forms'] for r in rotations},
    }
    flagged = [{'fact_id': f, 'version': q.get('v'), 'flags': '|'.join(structural_flags(q))}
               for f, q in projected.items() if structural_flags(q)]
    (args.out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    (args.out / 'sample.json').write_text(json.dumps(samples, ensure_ascii=False, indent=2) + '\n')
    (args.out / 'rotation-capacity.json').write_text(json.dumps(rotations, indent=2) + '\n')
    write_csv(args.out / 'competencies.csv', code_rows)
    write_csv(args.out / 'subcategories.csv', cat_rows)
    write_csv(args.out / 'lesson-units.csv', unit_rows)
    (args.out / 'structural-flags.json').write_text(json.dumps(flagged, indent=2) + '\n')
    # Fail if a parallel content update made this report an inconsistent snapshot.
    changed = [p for p, meta in inputs.items() if digest(ROOT / p) != meta['sha256']]
    assert not changed, f'Inputs changed during evaluation: {changed}'
    print(json.dumps({k: v for k, v in summary.items() if k != 'inputs'}, indent=2))


if __name__ == '__main__':
    main()
