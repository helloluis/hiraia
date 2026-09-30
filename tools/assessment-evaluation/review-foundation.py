#!/usr/bin/env python3
"""Validate the explicit incoming-Grade-3 foundation scope; never promote it.

This gate is separate from the Grade 3–10 authoring ledger. Official Kindergarten
codes are checked against a pinned source, not relabelled as Grade 2 Science.
"""
import argparse
import copy
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
FOLDER = Path('rag/assessment-authoring/foundation')
SCOPE = 'incoming-grade3-foundations-2016k-v1'
LANGS = ('en', 'tl', 'bis')
DOMAINS = ('MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE')
SOURCE_NAMES = ('living-materials.json', 'movement-surroundings.json')
RELATIONS = ('above', 'below', 'left', 'right', 'inside', 'on')
SLOT_DOMAINS = {
    'foundation-body-functions': 'LIVING_THINGS',
    'foundation-living-needs': 'LIVING_THINGS',
    'foundation-object-properties': 'MATTER',
    'foundation-push-pull-motion': 'FORCE_MOTION_ENERGY',
    'foundation-relative-position': 'FORCE_MOTION_ENERGY',
    'foundation-weather': 'EARTH_SPACE',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def text(value):
    return isinstance(value, str) and bool(value.strip())


def source_fact_ids(item):
    actual = {card.get('fact_id') for card in item.get('source_cards', []) if card.get('fact_id')}
    return sorted(actual or {'foundation-claim-' + item['knowledge_family_id']})


def load_bundle(root=ROOT, cards=None):
    folder = root / FOLDER
    catalogue_path, blueprint_path = folder/'catalogue.json', folder/'blueprint.json'
    catalogue, blueprint = json.loads(catalogue_path.read_text()), json.loads(blueprint_path.read_text())
    paths = [catalogue_path, blueprint_path, root/'tools/assessment-evaluation/review-foundation.py']
    documents = []
    for name in SOURCE_NAMES:
        path = folder/name
        documents.append((name, json.loads(path.read_text())))
        paths.append(path)
    raw = {}
    for source_id, source in catalogue['sources'].items():
        raw[source_id] = {}
        for kind in ('pdf', 'text'):
            path = (root/source[kind+'_path']).resolve()
            path.relative_to(root.resolve())
            raw[source_id][kind] = path.read_bytes(); paths.append(path)
    card_path, bank_path = root/'rag/pipeline/cardsPool.app.json', root/'rag/bank/quiz-bank-v2.jsonl'
    if cards is None:
        cards = {card['id']: card for card in json.loads(card_path.read_text())['cards']}
    with bank_path.open() as source:
        bank_ids = {json.loads(line)['factId'] for line in source if line.strip()}
    paths.extend([card_path, bank_path])
    return dict(catalogue=catalogue, blueprint=blueprint, documents=documents,
                context=dict(raw=raw, cards=cards, bank_ids=bank_ids), paths=paths)


def diagram_labels(relation, subject):
    other = 'box' if subject == 'ball' else 'ball'
    phrases = {'above': ['Above', 'Over'], 'below': ['Below', 'Under'],
               'left': ['To the left of', 'Left of'], 'right': ['To the right of', 'Right of'],
               'inside': ['Inside', 'In'], 'on': ['On', 'On top of']}
    return {f'{phrase} the {other}' for phrase in phrases[relation]}


def validate(catalogue, blueprint, documents, ctx):
    errors, warnings = [], []

    def require(condition, message):
        if not condition: errors.append(message)

    require(catalogue.get('schema_version') == 1 and catalogue.get('scope_id') == SCOPE, 'invalid foundation catalogue scope')
    require(catalogue.get('student_grade') == 3 and catalogue.get('material_grade') == 0, 'foundation must separate student Grade 3 from Kindergarten material grade 0')
    require(catalogue.get('curriculum_cohort_verified') is False and catalogue.get('production_enabled') is False,
            'foundation catalogue cannot claim cohort or production approval')
    require(text(catalogue.get('scope_statement')) and text(catalogue.get('claim_limit')), 'missing foundation scope limits')
    require(catalogue.get('item_sources') == list(SOURCE_NAMES), 'unexpected foundation source file list')
    review = catalogue.get('review', {})
    require(review.get('independent') is False and all(review.get(key) is None for key in ('native_speaker_review', 'teacher_review', 'student_pilot')),
            'foundation catalogue review promotion is unsupported')
    anchors = {}
    for source_id, source in catalogue.get('sources', {}).items():
        raw = ctx['raw'].get(source_id, {})
        require(source_id == 'deped-kindergarten-2016', 'unverified foundation curriculum source')
        for kind in ('pdf', 'text'):
            require(kind in raw and sha(raw[kind]) == source.get(kind+'_sha256'), 'changed foundation curriculum '+kind+' source hash')
        pages = raw.get('text', b'').decode('utf-8').split('\f')
        for anchor in source.get('anchors', []):
            code, page = anchor.get('code'), anchor.get('page')
            key = (source_id, code, page)
            require(key not in anchors, 'duplicate foundation curriculum anchor')
            require(isinstance(page, int) and 1 <= page <= len(pages), 'invalid foundation curriculum page')
            actual = pages[page-1] if isinstance(page, int) and 1 <= page <= len(pages) else ''
            require(text(code) and code in actual, 'foundation curriculum code not on its pinned page: '+str(code))
            require(text(anchor.get('competency_text')), 'missing official foundation competency text')
            fragments = anchor.get('source_fragments', [])
            require(bool(fragments) and all(text(part) and part in actual for part in fragments), 'unsupported foundation source fragment: '+str(code))
            require(bool(anchor.get('allowed_domains')) and set(anchor['allowed_domains']) <= set(DOMAINS), 'invalid foundation anchor domain')
            anchors[key] = anchor
    require(bool(anchors), 'foundation source catalogue is empty')
    constructs = catalogue.get('benchmark_constructs', [])
    require({slot.get('id'): slot.get('domain') for slot in constructs} == SLOT_DOMAINS and len(constructs) == 6,
            'foundation benchmark constructs differ from the reviewed six-slot design')
    require(all(text(slot.get('construct')) for slot in constructs), 'empty foundation benchmark construct')
    targets = {}
    for target in catalogue.get('targets', []):
        tid = target.get('id')
        require(tid not in targets, 'duplicate foundation target ledger ID')
        targets[tid] = target
    items, by_id, signatures = [], {}, {}
    for name, document in documents:
        require(document.get('schema_version') == 1 and document.get('scope_id') == SCOPE, name+': wrong foundation source scope')
        try: datetime.fromisoformat(document.get('created_at', '').replace('Z', '+00:00'))
        except (ValueError, TypeError): require(False, name+': invalid creation timestamp')
        rows = document.get('items', [])
        require(isinstance(rows, list) and len(rows) == 36, name+': expected 36 authored records')
        for item in rows:
            iid = item.get('id', '<missing-id>'); prefix = iid+': '
            match = re.fullmatch(r'ha-f3-(\d{4})', iid) if isinstance(iid, str) else None
            number = int(match.group(1)) if match else 0
            lower, upper = (1, 36) if name == SOURCE_NAMES[0] else (37, 72)
            require(match is not None and lower <= number <= upper, prefix+'ID outside assigned foundation range')
            require(iid not in by_id, prefix+'duplicate foundation item ID'); by_id[iid] = item; items.append(item)
            require(type(item.get('revision')) is int and item['revision'] >= 1, prefix+'invalid revision')
            require(item.get('status') in ('source_checked', 'hold') and item.get('production_ready') is False,
                    prefix+'unsupported production/status promotion')
            require(item.get('material_grade', 0) == 0 and item.get('student_grade', 3) == 3, prefix+'false material/student grade')
            domain, target_id, family = item.get('domain'), item.get('target_id'), item.get('knowledge_family_id')
            require(domain in DOMAINS, prefix+'unknown domain')
            expected_domain = 'LIVING_THINGS' if number <= 18 else 'MATTER' if number <= 36 else 'FORCE_MOTION_ENERGY' if number <= 54 else 'EARTH_SPACE'
            require(domain == expected_domain, prefix+'domain differs from assigned content range')
            require(isinstance(target_id, str) and len(target_id) <= 100 and re.fullmatch(r'g3-foundation-[a-z0-9-]+', target_id), prefix+'invalid wire-compatible foundation target ID')
            require(isinstance(family, str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,159}', family), prefix+'missing/invalid knowledge family')
            require(text(item.get('knowledge_claim')) and text(item.get('claim_limit')), prefix+'missing claim or claim limit')
            curriculum = item.get('curriculum', {})
            anchor = anchors.get((curriculum.get('source_id'), curriculum.get('code'), curriculum.get('page')))
            require(anchor is not None, prefix+'unknown official foundation curriculum code/page')
            if anchor: require(domain in anchor['allowed_domains'], prefix+'curriculum/domain mismatch')
            require(text(curriculum.get('mapping_note')), prefix+'missing narrow curriculum mapping note')
            target = targets.get(target_id)
            require(target is not None, prefix+'target absent from standalone foundation ledger')
            if target:
                for key in ('domain', 'knowledge_claim', 'knowledge_family_id'):
                    require(item.get(key) == target.get(key), prefix+'foundation target ledger mismatch: '+key)
                require(curriculum == target.get('curriculum'), prefix+'foundation target curriculum ledger mismatch')
                require(iid in target.get('selected_item_ids', []), prefix+'item absent from standalone target membership')
            content, rationale = item.get('content', {}), item.get('rationale', {})
            options = content.get('options', []); option_ids = [option.get('id') for option in options]
            require(len(options) == 3 and set(option_ids) == {'o1', 'o2', 'o3'}, prefix+'expected three unique option IDs')
            answer = content.get('correct_option_id')
            require(answer in option_ids, prefix+'invalid answer key')
            require(set(rationale.get('distractors', {})) == set(option_ids)-{answer}, prefix+'distractor rationale IDs do not match wrong options')
            require(text(rationale.get('correct')) and all(text(reason) for reason in rationale.get('distractors', {}).values()), prefix+'empty correct/distractor rationale')
            for lang in LANGS:
                texts = [content.get('stem', {}).get(lang), content.get('explanation', {}).get(lang)] + [option.get('text', {}).get(lang) for option in options]
                require(all(text(value) for value in texts), prefix+'missing/empty '+lang+' text')
                values = [option.get('text', {}).get(lang) for option in options]
                require(len(values) == len(set(values)), prefix+'duplicate '+lang+' options')
            signature = json.dumps(content, ensure_ascii=False, sort_keys=True)
            require(signature not in signatures, prefix+'exact duplicate full question: '+signatures.get(signature, ''))
            signatures[signature] = iid
            demand, reviewed = item.get('demand', {}), item.get('review', {})
            require(demand.get('type') == 'recall' and text(demand.get('reading_demand')) and text(demand.get('read_aloud')), prefix+'missing recall/accessibility demand review')
            diagram = content.get('diagram')
            require(demand.get('image_required') is (diagram is not None), prefix+'diagram/image dependency mismatch')
            if diagram is not None:
                valid = isinstance(diagram, dict) and set(diagram) == {'kind', 'relation'} and diagram.get('kind') == 'ball_box' and diagram.get('relation') in RELATIONS
                require(valid, prefix+'unsupported diagram schema')
                subject, scored = reviewed.get('diagram_question_subject'), reviewed.get('diagram_answer_relation')
                require(subject in ('ball', 'box'), prefix+'missing explicit diagram question subject')
                if valid:
                    relation = diagram['relation']
                    require(relation in ('above', 'below', 'inside', 'on'), prefix+'diagram relation outside pinned Kindergarten position anchor')
                    expected = relation if subject == 'ball' else {'above': 'below', 'below': 'above', 'on': 'below', 'left': 'right', 'right': 'left'}.get(relation)
                    require(expected is not None and scored == expected, prefix+'diagram scored relation contradicts the scene/subject')
                    correct = next((option.get('text', {}).get('en') for option in options if option.get('id') == answer), None)
                    if scored in RELATIONS and subject in ('ball', 'box'):
                        require(correct in diagram_labels(scored, subject), prefix+'diagram English answer contradicts scored relation')
                        valid_labels = diagram_labels(scored, subject)
                        if relation == 'on' and subject == 'ball':
                            valid_labels |= diagram_labels('above', subject)
                        require(sum(option.get('text', {}).get('en') in valid_labels for option in options) == 1,
                                prefix+'diagram has multiple semantically valid English options')
                    require(curriculum.get('code') == 'MKSC-00-12' and curriculum.get('page') == 21, prefix+'diagram lacks the reviewed position anchor')
            require(text(reviewed.get('source_check')) and text(reviewed.get('language_evidence')), prefix+'missing source/language evidence')
            require(all(reviewed.get(key) is None for key in ('native_speaker_review', 'teacher_review', 'student_pilot')) and reviewed.get('independent', False) is False,
                    prefix+'unsubstantiated independent/teacher/native approval')
            holds = reviewed.get('holds')
            require(isinstance(holds, list), prefix+'missing explicit holds list')
            require(bool(holds) == (item.get('status') == 'hold'), prefix+'hold/status mismatch')
            if holds: warnings.append(dict(item_id=iid, kind='hold', detail=holds))
            cards = item.get('source_cards')
            require(isinstance(cards, list), prefix+'source_cards must be explicit, including an empty list when unlinked')
            seen_cards = set()
            for source in cards or []:
                card_id = source.get('card_id'); card = ctx['cards'].get(card_id)
                require(card_id not in seen_cards, prefix+'duplicate teaching card'); seen_cards.add(card_id)
                require(card is not None and source.get('fact_id') == card.get('factId'), prefix+'unknown source card/fact')
                require(card is not None and source.get('fact') == card.get('fact'), prefix+'stale teaching-card snapshot')
                require(source.get('reviewed_languages') == list(LANGS), prefix+'teaching link lacks three-language review')
                for lang in LANGS:
                    excerpt = source.get('support', {}).get(lang)
                    require(text(excerpt) and card is not None and excerpt in card['fact'].get(lang, ''), prefix+'unsupported '+lang+' teaching excerpt')
            for bank_id in item.get('source_bank_fact_ids', []):
                require(bank_id in ctx['bank_ids'], prefix+'unknown shipping quiz-bank fact ID')
            slot = item.get('benchmark_slot')
            require('benchmark_slot' in item and (slot is None or SLOT_DOMAINS.get(slot) == domain), prefix+'invalid benchmark slot/domain')
    expected_ids = {f'ha-f3-{number:04d}' for number in range(1, 73)}
    require(set(by_id) == expected_ids and len(items) == 72, 'foundation pool must explicitly contain the 72 assigned records')
    require(Counter(item.get('domain') for item in items) == Counter({domain:18 for domain in DOMAINS}), 'foundation pool domain counts must be 18 each')
    require(set(targets) == {item.get('target_id') for item in items}, 'foundation target ledger has missing or unused targets')
    for tid, target in targets.items():
        require(set(target.get('selected_item_ids', [])) == {item['id'] for item in items if item.get('target_id') == tid}, 'foundation target membership differs from actual items: '+str(tid))
    require(blueprint.get('foundation_scope_id') == SCOPE and blueprint.get('student_grade') == 3 and blueprint.get('material_grade') == 0,
            'invalid Grade 3 foundation blueprint scope')
    require(blueprint.get('curriculum_cohort_verified') is False and blueprint.get('production_ready') is False and blueprint.get('status') == 'draft_content_blueprint',
            'foundation blueprint cannot promote production/cohort approval')
    admitted = {item['id'] for item in items if item.get('status') == 'source_checked' and not item.get('review', {}).get('holds')}
    allowlist = blueprint.get('foundation_item_ids', [])
    require(len(allowlist) == len(set(allowlist)) and set(allowlist) == admitted, 'foundation blueprint allowlist must name only and all unheld foundation items')
    require(blueprint.get('baseline_domain_counts') == {domain:3 for domain in DOMAINS}, 'foundation baseline domain allocation must be three each')
    slots = blueprint.get('benchmark_slots', [])
    require(len(slots) == 6 and {slot.get('id') for slot in slots} == set(SLOT_DOMAINS), 'foundation blueprint must retain six distinct benchmark slots')
    first = blueprint.get('baseline_benchmark_item_ids', {})
    require(set(first) == set(SLOT_DOMAINS), 'foundation baseline must name one item for each benchmark slot')
    for slot in slots:
        sid = slot.get('id'); candidate_ids = slot.get('candidate_item_ids', [])
        require(len(candidate_ids) >= 6 and len(candidate_ids) == len(set(candidate_ids)), 'foundation slot needs six distinct candidates: '+str(sid))
        require(set(candidate_ids) <= admitted, 'foundation slot includes a held or unknown item: '+str(sid))
        require(set(candidate_ids) == {item['id'] for item in items if item.get('benchmark_slot') == sid and item['id'] in admitted}, 'foundation slot membership mismatch: '+str(sid))
        require(first.get(sid) in candidate_ids, 'foundation baseline anchor missing from slot: '+str(sid))
        construct = next((row['construct'] for row in constructs if row.get('id') == sid), None)
        require(slot.get('construct') == construct, 'foundation benchmark construct changed without catalogue review: '+str(sid))
    probes = blueprint.get('baseline_readiness_probe_ids', [])
    baseline = blueprint.get('baseline_example_item_ids', [])
    require(len(probes) == len(set(probes)) == 6, 'foundation baseline needs six distinct probes')
    require(len(baseline) == len(set(baseline)) == 12 and set(baseline) == set(first.values()) | set(probes), 'foundation baseline must comprise the six benchmarks and six probes')
    require(set(baseline) <= admitted, 'foundation baseline contains held or unknown content')
    selected = [by_id[iid] for iid in baseline if iid in by_id]
    require(Counter(item.get('domain') for item in selected) == Counter({domain:3 for domain in DOMAINS}), 'foundation baseline actual domain distribution differs from declared allocation')
    families = [item.get('knowledge_family_id') for item in selected]
    require(len(families) == len(set(families)), 'duplicate knowledge family in foundation baseline')
    facts = [fact for item in selected for fact in source_fact_ids(item)]
    require(len(facts) == len(set(facts)), 'overlapping source facts in foundation baseline')
    return errors, warnings


def control_checks(catalogue, blueprint, documents, ctx):
    def item(docs): return docs[0][1]['items'][0]
    def diagram(docs): return next(row for _, doc in docs for row in doc['items'] if row.get('content', {}).get('diagram'))
    def linked(docs): return next(row for _, doc in docs for row in doc['items'] if row.get('source_cards'))
    def baseline_pair(blueprint, docs):
        rows = {row['id']:row for _, doc in docs for row in doc['items']}
        return [rows[iid] for iid in blueprint['baseline_example_item_ids'][:2]]
    def overlap_family(c,b,d):
        first, second = baseline_pair(b,d)
        second['knowledge_family_id'] = first['knowledge_family_id']
    def overlap_fact(c,b,d):
        first, second = baseline_pair(b,d)
        second['source_cards'] = copy.deepcopy(first['source_cards'])
    def ambiguous_diagram(c,b,d):
        row = diagram(d)
        valid = diagram_labels(row['review']['diagram_answer_relation'], row['review']['diagram_question_subject'])
        correct = next(option for option in row['content']['options'] if option['id'] == row['content']['correct_option_id'])
        alternate = next((label for label in sorted(valid) if label != correct['text']['en']), correct['text']['en'])
        next(option for option in row['content']['options'] if option['id'] != row['content']['correct_option_id'])['text']['en'] = alternate
    cases = [
        ('missing translation', lambda c,b,d: item(d)['content']['stem'].pop('bis'), 'missing/empty bis text'),
        ('duplicate option', lambda c,b,d: item(d)['content']['options'][1]['text'].__setitem__('en', item(d)['content']['options'][0]['text']['en']), 'duplicate en options'),
        ('wrong answer ID', lambda c,b,d: item(d)['content'].__setitem__('correct_option_id', 'missing'), 'invalid answer key'),
        ('fake Grade 2 material', lambda c,b,d: item(d).__setitem__('material_grade', 2), 'false material/student grade'),
        ('invented Grade 2 code', lambda c,b,d: item(d)['curriculum'].__setitem__('code', 'G2-SCIENCE-1'), 'unknown official foundation curriculum'),
        ('wrong source page', lambda c,b,d: item(d)['curriculum'].__setitem__('page', 1), 'unknown official foundation curriculum'),
        ('changed source PDF', lambda c,b,d: c['sources']['deped-kindergarten-2016'].__setitem__('pdf_sha256', '0'*64), 'source hash'),
        ('fabricated source fragment', lambda c,b,d: c['sources']['deped-kindergarten-2016']['anchors'][0].__setitem__('source_fragments', ['FABRICATED CONTROL EXCERPT']), 'unsupported foundation source fragment'),
        ('false production approval', lambda c,b,d: item(d).__setitem__('production_ready', True), 'unsupported production/status promotion'),
        ('false cohort approval', lambda c,b,d: b.__setitem__('curriculum_cohort_verified', True), 'cannot promote production/cohort'),
        ('false native approval', lambda c,b,d: item(d)['review'].__setitem__('native_speaker_review', {'approved':True}), 'unsubstantiated independent/teacher/native'),
        ('unacknowledged hold', lambda c,b,d: item(d)['review']['holds'].append('known-bad control'), 'hold/status mismatch'),
        ('foreign item allowlist', lambda c,b,d: b['foundation_item_ids'].append('ha-g3-0001'), 'blueprint allowlist'),
        ('missing foundation target', lambda c,b,d: item(d).__setitem__('target_id', 'g3-foundation-unknown-control'), 'target absent from standalone'),
        ('unknown source card', lambda c,b,d: linked(d)['source_cards'][0].__setitem__('card_id', 'unknown-control'), 'unknown source card/fact'),
        ('changed teaching snapshot', lambda c,b,d: linked(d)['source_cards'][0]['fact'].__setitem__('tl', 'Changed control'), 'stale teaching-card snapshot'),
        ('unreviewed teaching language', lambda c,b,d: linked(d)['source_cards'][0].__setitem__('reviewed_languages', ['en','tl']), 'teaching link lacks three-language'),
        ('invented teaching excerpt', lambda c,b,d: linked(d)['source_cards'][0]['support'].__setitem__('bis', 'INVENTED CONTROL EXCERPT'), 'unsupported bis teaching excerpt'),
        ('missing required diagram', lambda c,b,d: diagram(d)['content'].pop('diagram'), 'diagram/image dependency mismatch'),
        ('wrong diagram relation', lambda c,b,d: diagram(d)['content']['diagram'].__setitem__('relation', 'sideways'), 'unsupported diagram schema'),
        ('false diagram answer relation', lambda c,b,d: diagram(d)['review'].__setitem__('diagram_answer_relation', 'wrong'), 'diagram scored relation contradicts'),
        ('wrong keyed diagram text', lambda c,b,d: next(option for option in diagram(d)['content']['options'] if option['id'] == diagram(d)['content']['correct_option_id'])['text'].__setitem__('en','A wrong direction'), 'diagram English answer contradicts'),
        ('second valid diagram answer', ambiguous_diagram, 'diagram has multiple semantically valid'),
        ('baseline wrong domain allocation', lambda c,b,d: b['baseline_domain_counts'].__setitem__('MATTER', 4), 'baseline domain allocation'),
        ('repeated baseline item', lambda c,b,d: b['baseline_example_item_ids'].__setitem__(1,b['baseline_example_item_ids'][0]), 'baseline must comprise'),
        ('repeated baseline knowledge family', overlap_family, 'duplicate knowledge family in foundation baseline'),
        ('overlapping baseline source facts', overlap_fact, 'overlapping source facts in foundation baseline'),
    ]
    results = []
    for label, mutation, expected in cases:
        changed = copy.deepcopy((catalogue, blueprint, documents))
        try:
            mutation(*changed)
            errors, _ = validate(*changed, ctx)
            passed = any(expected in error for error in errors)
        except (KeyError, StopIteration, TypeError, ValueError): passed = False
        results.append(dict(control=label, passed=passed))
    return results


def check_bundle(bundle, controls=True):
    c,b,d,ctx = (bundle[key] for key in ('catalogue','blueprint','documents','context'))
    errors, warnings = validate(c,b,d,ctx)
    checks = control_checks(c,b,d,ctx) if controls and not errors else []
    errors += ['negative control failed: '+check['control'] for check in checks if not check['passed']]
    items = [item for _,document in d for item in document['items']]
    return dict(checked_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), scope_id=SCOPE,
        items=len(items), domains=dict(Counter(item['domain'] for item in items)),
        status_counts=dict(Counter(item['status'] for item in items)), targets=len(c['targets']),
        knowledge_families=len({item['knowledge_family_id'] for item in items}),
        errors=errors, warnings=warnings, controls=checks,
        limitations=['Mechanical checks do not prove scientific validity, source-to-claim entailment, fluent translations, classroom coverage or calibrated form equivalence.',
                    'Diagram metadata and English-key agreement are author checks; independent trilingual meaning review remains pending.',
                    'No teacher, native-language, student-pilot or individual curriculum-cohort approval is asserted.'])


def render(bundle, report):
    lines = ['# Incoming Grade 3 foundation content review', '',
             'Hiraia earlier-learning evaluation drafts; not a school readiness test or a complete Grade 2 curriculum crosswalk.', '',
             f"Items: {report['items']}; targets: {report['targets']}; knowledge families: {report['knowledge_families']}; mechanical errors: {len(report['errors'])}.",
             f"Known-bad mutation controls: {sum(row['passed'] for row in report['controls'])}/{len(report['controls'])} caught.", '',
             'Production and individual-cohort admission remain disabled. Independent teacher, native-language and learner review remains pending.', '',
             '| Item | Scope | Claim | English question | Key |', '|---|---|---|---|---|']
    for _,document in bundle['documents']:
        for item in document['items']:
            content = item['content']; answer = next(option['text']['en'] for option in content['options'] if option['id'] == content['correct_option_id'])
            cells = [item['id'], item['curriculum']['code']+' p.'+str(item['curriculum']['page']), item['knowledge_claim'], content['stem']['en'], answer]
            lines.append('| '+' | '.join(value.replace('|','\\|').replace('\n',' ') for value in cells)+' |')
    lines += ['', '## Limits', ''] + ['- '+limit for limit in report['limitations']]
    lines += ['', 'Structured sources, their explicit source-card excerpts and distractor rationales remain the editable authority. Existing Grade 3–10 batches and their target ledger are unchanged.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    try: bundle = load_bundle()
    except (OSError, ValueError, KeyError) as error: raise SystemExit('Foundation inputs unavailable or malformed: '+str(error))
    report = check_bundle(bundle)
    if args.render and not report['errors']:
        (ROOT/FOLDER/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        (ROOT/FOLDER/'REVIEW.md').write_text(render(bundle,report))
    print(json.dumps({key:report[key] for key in ('items','domains','status_counts','targets','knowledge_families','errors','warnings','controls')},ensure_ascii=False,indent=2))
    raise SystemExit(1 if report['errors'] else 0)


if __name__ == '__main__': main()
