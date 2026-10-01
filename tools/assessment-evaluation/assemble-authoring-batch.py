#!/usr/bin/env python3
"""Attach provenance to manually authored JSON drafts. No model calls or question generation."""
import argparse
import copy
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rag/assessment-authoring'
LANGS = ('en', 'tl', 'bis')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('drafts', type=Path)
    args = parser.parse_args()
    draft = json.loads(args.drafts.read_text())
    batch_id, grade = draft['batch_id'], draft['material_grade']
    output = OUT / 'batches' / f'{batch_id}.json'
    if output.exists():
        raise SystemExit('Refusing to overwrite an existing batch. Edit its canonical JSON and increment revisions.')
    paths = dict(bank='rag/bank/quiz-bank-v2.jsonl', cards='rag/pipeline/cardsPool.app.json',
                 curriculum=f'rag/sources/curriculum-guides/matatag-{"elementary" if grade <= 6 else "jhs"}-competencies.json',
                 subcategory_inventory='tools/assessment-evaluation/reports/2026-09-28/subcategories.csv')
    raw = {k:(ROOT/v).read_bytes() for k,v in paths.items()}
    bank_rows = [json.loads(line) for line in raw['bank'].splitlines() if line.strip()]
    bank = {q['factId']:q for q in bank_rows}
    cards = json.loads(raw['cards'])['cards']
    card_ids = {c['id']:c for c in cards}
    by_fact = {}
    for card in cards:
        by_fact.setdefault(card['factId'], []).append(card)
    curriculum = json.loads(raw['curriculum'])
    codes = {c['code']:dict(c,grade=q['grade'],domain=q['domain']) for q in curriculum['quarters'] for c in q['competencies']}
    subcats = {r['id']:r for r in csv.DictReader(raw['subcategory_inventory'].decode().splitlines())}
    ledger = json.loads((OUT/'targets.json').read_text())
    targets = {t['id']:t for t in ledger['targets']}
    existing_ids = {i['id'] for p in (OUT/'batches').glob('*.json') if not p.name.endswith('.validation.json')
                    for i in json.loads(p.read_text())['items']}

    def snapshot(fact_id, question_id=None, card_id=None):
        card = card_ids[card_id] if card_id else by_fact[fact_id][0]
        assert card['factId'] == fact_id
        question_id = question_id or fact_id
        return dict(fact_id=fact_id, card_ids=[card['id']], fact=copy.deepcopy(card['fact']),
                    bank_fact_id=question_id if question_id in bank else None,
                    bank_question=copy.deepcopy(bank.get(question_id)))

    items = []
    for spec in draft['items']:
        item_id = spec['id']
        assert item_id not in existing_ids, f'Duplicate assessment ID: {item_id}'
        existing_ids.add(item_id)
        primary = snapshot(spec['source_fact_id'],spec.get('source_question_fact_id'),spec.get('source_card_id'))
        q = primary['bank_question']
        if spec['origin'] == 'reuse':
            assert q and len(q['options']) == 3
            content = dict(stem=copy.deepcopy(q['q']), options=[dict(id=f'o{n+1}',text=copy.deepcopy(o)) for n,o in enumerate(q['options'])],
                           correct_option_id=f'o{q["answer"]+1}', explanation=copy.deepcopy(q['explanation']))
        else:
            content = copy.deepcopy(spec['content'])
        code = codes[spec['code']]
        assert code['grade'] == grade
        subcat = subcats[spec['subcategory_id']]
        holds = spec.get('holds',[])
        candidates = list(dict.fromkeys(([primary['bank_fact_id']] if q else []) + spec.get('related_bank_fact_ids',[])))
        for other in bank_rows:
            if other['q']['en'] == content['stem']['en'] and other['factId'] not in candidates:
                candidates.append(other['factId'])
        family = spec['knowledge_family_id']
        item = dict(id=item_id,revision=1,batch_id=batch_id,origin=spec['origin'],status='hold' if holds else 'source_checked',production_ready=False,
            scope=dict(material_grade=grade,domain=code['domain'],internal_competency_code=spec['code'],internal_competency_text=code['text'],
                       subcategory_id=spec['subcategory_id'],target_id=spec['target_id'],knowledge_claim=spec['knowledge_claim'],
                       curriculum_version=curriculum['source'],mapping_status='author-reviewed supporting-knowledge mapping; cohort/version and teacher confirmation pending',
                       claim_limit=spec['claim_limit'],source_grade_tags=q.get('grades') if q else None,
                       grade_note='Source grade tags are not assessment eligibility. The narrow claim has its own mapping.'),
            eligibility=dict(prior_grade_readiness=dict(intended_student_grade=grade+1 if grade<10 else None,material_grade=grade,
                         coverage_basis='expected prerequisite, not verified teaching',enabled_after_review=grade<10,requires_school_year_curriculum_match=True,
                         curriculum_match_status='unverified for a specific learner cohort; review required before eligibility is enabled'),
                         current_grade=dict(allowed_routes=['verified Hiraia knowledge exposure','teacher-reported coverage of this target'],calendar_alone_sufficient=False),
                         recent_learning=dict(window_days=14,source_card_ids=primary['card_ids'],condition='Source-card exposure must include the tested knowledge; a broad topic match is insufficient.'),
                         incoming_grade3='not eligible as a Grade 2-readiness item without separate foundational review'),
            uses=dict(readiness='prior-grade candidate after coverage review' if grade<10 else 'outside current readiness grade range',
                      recent_learning='candidate after specific knowledge exposure',benchmark='candidate; calibration and form equivalence untested',
                      reinforcement='one supporting observation; require repeated evidence before changing support level'),
            relationships=dict(knowledge_family_id=family,form_family_id=spec.get('form_family_id',family+'-foundations'),form_equivalence='unvalidated hypothesis',
                               prerequisite_target_id=spec.get('prerequisite_target_id'),prerequisite_review='Earlier-grade prerequisite edges need review.',
                               supersedes_assessment_item_id=None,proposed_bank_replacement_fact_id=primary['bank_fact_id'] if spec['origin']=='revise' else None),
            provenance=dict(primary=primary,related=[snapshot(f) for f in spec.get('related_source_fact_ids',[])],
                            supporting_statement=spec['evidence'],external_reference_ids=spec.get('external_reference_ids',[])),
            content=content,rationale=dict(correct=spec['evidence'],distractors=spec['distractor_rationale']),
            demand=dict(type=spec.get('demand','recall'),conceptual_demand='one familiar fact or relationship',
                        reading_demand=spec.get('reading_demand','author estimate: foundational; not measured with students'),image_required=False,
                        read_aloud='permitted if presented consistently; record language and assistance'),
            review=dict(reviewer=dict(agent='Codex',method='in-session author self-review',independent=False),
                        source_check=spec.get('source_check','Source statement read; answer and relevant conditions reviewed. Not independent validation.'),
                        selection_decision=spec['decision'],ambiguity_and_distractors='Author self-review; see option-specific rationales and remaining limitations.',
                        exact_bank_stem_matches={lang:[other['factId'] for other in bank_rows if other['q'][lang]==content['stem'][lang]] for lang in LANGS},
                        semantic_duplicate_review=dict(status=spec.get('duplicate_review','targeted source/stem/answer search; not exhaustive'),related_bank_fact_ids=candidates,
                                                       rule='Related forms are not independent knowledge targets; preserve equivalent-family exposure history.'),
                        languages={lang:dict(status='draft_pending_language_review',evidence=spec['language_evidence']) for lang in LANGS},
                        language_evidence_cards=[dict(card_id=cid,fact=card_ids[cid]['fact']) for cid in spec.get('language_evidence_card_ids',[])],
                        holds=holds,remaining_limitations=spec.get('limitations',[]),empirical_difficulty=None,native_speaker_review=None,teacher_review=None,student_pilot=None))
        items.append(item)
        target = targets.get(spec['target_id'])
        if target:
            assert target['knowledge_claim'] == spec['knowledge_claim'], 'Existing target claim changed'
            target['selected_draft_item_ids'].append(item_id)
        else:
            target=dict(id=spec['target_id'],knowledge_claim=spec['knowledge_claim'],material_grade=grade,domain=code['domain'],
                        internal_competency_code=spec['code'],subcategory_id=spec['subcategory_id'],selected_draft_item_ids=[item_id],pilot_ready_item_ids=[],
                        related_bank_candidates=[],candidate_search='Targeted cross-fact-ID stem and keyed-answer search; not an exhaustive semantic inventory.',
                        subcategory_inventory=dict(distinct_3_option_english_stems=int(subcat['distinct_en_stems_valid_3_option']),note='Broad-subcategory count, not suitable forms of this precise claim.'),
                        rotation_demand='Quantify through blueprint/exposure/repetition simulations before setting a generation quota.',
                        remaining_gap='Language/teacher review and form calibration; no pilot-ready forms yet.',
                        next_action='Resolve explicit holds and inspect remaining bank variants before adding forms.')
            ledger['targets'].append(target); targets[spec['target_id']]=target
        for f in candidates:
            if f not in [c['fact_id'] for c in target['related_bank_candidates']]:
                target['related_bank_candidates'].append(dict(fact_id=f,bank_version=bank[f].get('v',1),question_en=bank[f]['q']['en']))
    now=datetime.now(timezone.utc).isoformat(timespec='seconds')
    batch=dict(schema_version=1,batch_id=batch_id,title=draft['title'],created_at=now,
               author=dict(agent='Codex',method='direct in-session authorship; script attaches provenance only',requested_model='Astra',runtime_model_id=None),
               purpose='Reviewable Hiraia-scoped assessment item candidates; not an assembled student examination or formal grade placement.',
               scope=dict(material_grade=grade,intended_readiness_student_grade=grade+1 if grade<10 else None,
                          domain_distribution=dict(Counter(i['scope']['domain'] for i in items)),
                          curriculum_review='Local curriculum extract; check applicable published guide, cohort and school year before production eligibility.'),
               review_notes=draft.get('review_notes',[]),references=draft.get('references',{}),
               source_files={k:dict(path=paths[k],sha256=hashlib.sha256(v).hexdigest()) for k,v in raw.items()},items=items)
    # Recheck inputs before writing to avoid snapshotting a changing shared checkout.
    for key,path in paths.items():
        assert (ROOT/path).read_bytes()==raw[key], f'Input changed during assembly: {path}'
    output.write_text(json.dumps(batch,ensure_ascii=False,indent=2)+'\n')
    ledger['updated_at']=now
    ledger['coverage']=f'{len(ledger["targets"])} selected microtargets. This is an expanding authoring ledger, not a complete inventory of all 335 subcategories.'
    (OUT/'targets.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(batch=batch_id,items=len(items),origins=dict(Counter(i['origin'] for i in items)),path=str(output))))


if __name__ == '__main__':
    main()
