#!/usr/bin/env python3
"""Compile reviewed authoring snapshots for offline use; never promote review status."""
import argparse
import hashlib
import importlib.util
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'packages/mobile/src/assessment/bank.generated.json'
LANGS = ('en', 'tl', 'bis')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def latest_authored_at(values):
    """The native clock contract accepts at most millisecond precision."""
    return max(datetime.fromisoformat(value) for value in values).isoformat(timespec='milliseconds')


def teaching_candidates(item):
    """A current snapshot is necessary, but cannot override a claim-link hold."""
    primary = item['provenance']['primary']
    family = item['relationships']['knowledge_family_id']

    def held(source):
        if 'teaching_link_hold' not in source:
            return False
        hold = source['teaching_link_hold']
        assert isinstance(hold, dict) and all(
            isinstance(hold.get(key), str) and hold[key].strip()
            for key in ('reason', 'review_receipt')), 'Malformed teaching-link hold'
        return True

    candidates = [] if held(primary) else [
        (card_id, primary['fact'], list(LANGS)) for card_id in primary['card_ids']]
    for link in item['provenance'].get('additional_teaching_cards', []):
        if (not held(link) and link.get('review_status') == 'author_source_checked'
                and link.get('knowledge_family_id') == family):
            candidates.append((link['card_id'], link['fact'], link.get('reviewed_languages', [])))
    return candidates


def foundation_bundle(pool):
    path = ROOT / 'tools/assessment-evaluation/review-foundation.py'
    spec = importlib.util.spec_from_file_location('foundation_review', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    bundle = module.load_bundle(ROOT, cards=pool)
    report = module.check_bundle(bundle)
    assert not report['errors'], 'Foundation source gate failed:\n' + '\n'.join(report['errors'])
    return module, bundle


def compile_foundation(item, module, catalogue):
    curriculum = item['curriculum']
    anchor = next(anchor for anchor in catalogue['sources'][curriculum['source_id']]['anchors']
                  if anchor['code'] == curriculum['code'] and anchor['page'] == curriculum['page'])
    scope = dict(foundation_scope_id=module.SCOPE, student_grade=3, material_grade=0,
        domain=item['domain'], target_id=item['target_id'], knowledge_claim=item['knowledge_claim'],
        claim_limit=item['claim_limit'], curriculum_version=curriculum['source_id'],
        official_curriculum_anchor=dict(**curriculum, competency_text=anchor['competency_text']))
    links = [dict(cardId=card['card_id'], familyId=item['knowledge_family_id'],
                  hashes={lang:digest(card['fact'][lang].strip().encode('utf-8')) for lang in LANGS})
             for card in item['source_cards']]
    return dict(id=item['id'], revision=item['revision'], batchId='grade3-foundation-2016k',
        status=item['status'], productionReady=False, grade=0, domain=item['domain'], targetId=item['target_id'],
        claim=item['knowledge_claim'], claimLimit=item['claim_limit'], curriculumVersion=curriculum['source_id'],
        familyId=item['knowledge_family_id'], sourceFactIds=module.source_fact_ids(item), teachingLinks=links,
        content=item['content'], scope=scope, review=item['review'], demand=item['demand'],
        relationships=dict(knowledge_family_id=item['knowledge_family_id']),
        eligibility=dict(foundation_scope_id=module.SCOPE, benchmark_slot=item['benchmark_slot'],
            recent_learning=dict(source_card_ids=[card['card_id'] for card in item['source_cards']],
                                 requires_exact_reviewed_teaching_link=True)))


def compile_bank():
    paths = sorted(p for p in (ROOT / 'rag/assessment-authoring/batches').glob('*.json')
                   if not p.name.endswith('.validation.json'))
    blueprint_path = ROOT / 'rag/assessment-authoring/blueprints.json'
    pool_path = ROOT / 'rag/pipeline/cardsPool.app.json'
    inputs = paths + [blueprint_path, pool_path, Path(__file__).resolve()]
    hashes = {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in inputs}
    pool = {c['id']: c for c in json.loads(pool_path.read_text())['cards']}
    blueprint_doc = json.loads(blueprint_path.read_text())
    compiled, excluded, ids = [], [], set()
    count = 0
    authored_dates = []
    for path in paths:
        batch = json.loads(path.read_text())
        authored_dates.append(batch['created_at'])
        for item in batch['items']:
            count += 1
            assert item['id'] not in ids, f"Duplicate ID: {item['id']}"
            ids.add(item['id'])
            holds = item['review'].get('holds', [])
            if item['status'] in ('hold', 'retired') or holds:
                excluded.append(dict(id=item['id'], status=item['status'], holds=holds))
                continue
            assert item['status'] in ('source_checked', 'ready_for_pilot'), item['id']
            content = item['content']
            option_ids = [o['id'] for o in content['options']]
            assert len(option_ids) == len(set(option_ids)) == 3, item['id']
            assert content['correct_option_id'] in option_ids, item['id']
            for language in LANGS:
                assert content['stem'][language] and content['explanation'][language], item['id']
                assert len({o['text'][language] for o in content['options']}) == 3, item['id']
            primary = item['provenance']['primary']
            family = item['relationships']['knowledge_family_id']
            eligible_cards = set(item['eligibility']['recent_learning']['source_card_ids'])
            links = []
            candidates = teaching_candidates(item)
            for card_id, fact, reviewed_languages in candidates:
                if card_id not in eligible_cards:
                    continue
                assert card_id in pool, f"Missing teaching card {card_id} for {item['id']}"
                # A changed lesson cannot inherit an older reviewed claim link.
                checked_hashes = {}
                for language in LANGS:
                    if language in reviewed_languages and pool[card_id]['fact'].get(language) == fact.get(language):
                        # cardText() trims the visible body; hash exactly what the child sees.
                        checked_hashes[language] = digest(fact[language].strip().encode('utf-8'))
                    else:
                        checked_hashes[language] = ''
                if any(checked_hashes.values()):
                    links.append(dict(cardId=card_id, familyId=family, hashes=checked_hashes))
            scope = item['scope']
            compiled.append(dict(id=item['id'], revision=item['revision'], batchId=item['batch_id'],
                status=item['status'], productionReady=item['production_ready'], grade=scope['material_grade'],
                domain=scope['domain'], targetId=scope['target_id'], claim=scope['knowledge_claim'],
                claimLimit=scope['claim_limit'], curriculumVersion=scope['curriculum_version'], familyId=family,
                sourceFactIds=sorted({x for x in [primary['fact_id'], primary.get('bank_fact_id')] if x}),
                teachingLinks=links, content=content, scope=scope, review=item['review'],
                relationships=item['relationships'], eligibility=item['eligibility'], demand=item['demand']))
    blueprints = []
    for blueprint in blueprint_doc['blueprints']:
        if blueprint['status'] == 'superseded_draft_retained_for_failure_evidence':
            continue
        revision = digest(json.dumps(blueprint, ensure_ascii=False, sort_keys=True).encode())
        blueprints.append(dict(**blueprint, revision=revision))
    foundation, bundle = foundation_bundle(pool)
    for path in bundle['paths']:
        hashes[str(path.relative_to(ROOT))] = digest(path.read_bytes())
    for _, document in bundle['documents']:
        authored_dates.append(document['created_at'])
        for item in document['items']:
            count += 1
            assert item['id'] not in ids, f"Duplicate ID: {item['id']}"
            ids.add(item['id'])
            holds = item['review']['holds']
            if item['status'] == 'hold' or holds:
                excluded.append(dict(id=item['id'], status=item['status'], holds=holds))
                continue
            compiled.append(compile_foundation(item, foundation, bundle['catalogue']))
    blueprint = bundle['blueprint']
    revision = digest(json.dumps(blueprint, ensure_ascii=False, sort_keys=True).encode())
    blueprints.append(dict(**blueprint, revision=revision))
    assert len({b['student_grade'] for b in blueprints}) == len(blueprints), 'Ambiguous blueprint'
    authored_at = latest_authored_at(authored_dates)
    return dict(schemaVersion=1, inputHash=digest(json.dumps(hashes, sort_keys=True).encode()), authoredAt=authored_at,
        sourceHashes=hashes, productionEnabled=blueprint_doc['production_enabled'], authoringItemCount=count,
        excluded=excluded, items=sorted(compiled, key=lambda x:x['id']), blueprints=blueprints,
        reviewNotice='Local evaluation drafts only unless production content and cohort gates pass. Native-language, teacher, student-pilot and cohort reviews remain pending; no school exam or grade-placement claims.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='fail if bundled registry inputs changed')
    args = parser.parse_args()
    bank = compile_bank()
    data = json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if not OUT.exists() or OUT.read_text() != data:
            raise SystemExit('Assessment registry is stale: run python3 packages/mobile/scripts/build-assessment-bank.py')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(data)
    print(f"{bank['authoringItemCount']} authoring items; {len(bank['items'])} compiled; {len(bank['excluded'])} excluded; production_enabled={bank['productionEnabled']}; input_sha256={bank['inputHash']}")


if __name__ == '__main__':
    main()
