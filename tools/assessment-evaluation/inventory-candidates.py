#!/usr/bin/env python3
"""Retrieve cross-mapping assessment candidates. Retrieval leads are never approved coverage."""
import csv
import hashlib
import json
import re
import runpy
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'rag/assessment-authoring'
structural_flags = runpy.run_path(str(Path(__file__).with_name('audit-bank.py')))['structural_flags']

# These are retrieval aliases, not curriculum mappings or assertions of equivalence.
ALIASES = {
 'animal-diets': ['herbivore','carnivore','omnivore'],
 'waste-materials': ['waste','reuse','reusing','recycling','compost'],
 'waste-management': ['waste','reuse','reusing','recycling','compost'],
 'safe-use-of-materials': ['flammable','warning','label','glass','disposal'],
 'metals-and-their-uses': ['copper','iron','gold','silver'],
 'air-components': ['nitrogen','oxygen','carbon dioxide','argon'],
 'conservation-of-mass': ['mass','closed container','closed system'],
 'endothermic-and-exothermic-reactions': ['endothermic','exothermic','absorbs heat','releases heat'],
 'landforms-and-water-bodies': ['mountain','valley','plain','river','lake','ocean'],
 'soil-and-plant-growth': ['soil','root','nutrients','humus'],
 'shadows-and-eclipses': ['eclipse','shadow','umbra'],
 'plant-reproduction': ['pollination','seed','spore','cutting','grafting'],
 'digestive-systems': ['digestion','stomach','intestine','esophagus'],
 'nervous-systems': ['brain','spinal cord','nerve','neuron'],
 'magnetic-separation-methods': ['magnet','iron filings','magnetic separation'],
 'decantation-methods': ['decantation','decanting','sediment'],
 'evaporation-methods': ['evaporation','saltwater','salt solution'],
 'filtering-and-sieving': ['filtration','filter','sieve','sieving'],
 'food-webs-and-roles': ['producer','consumer','decomposer','food web'],
 'circulatory-and-respiratory-systems': ['heart','blood','lung','respiration'],
 'major-organs': ['heart','brain','lung','stomach','kidney'],
 'energy-travel': ['conduction','convection','radiation','light','sound'],
 'balanced-and-unbalanced-forces': ['balanced','unbalanced','net force'],
 'phase-changes': ['melting','freezing','evaporation','condensation','sublimation'],
 'chemical-changes': ['rust','burning','new substance','chemical change'],
 'physical-and-chemical-changes': ['physical change','chemical change','rust','melting'],
 'crust-and-lithospheric-plates': ['crust','lithosphere','tectonic plate'],
 'divergent-and-transform-boundaries': ['divergent','transform','mid-ocean ridge'],
 'earthquake-seismic-waves': ['p-wave','s-wave','seismic','surface wave'],
}
STOP = {'and','of','the','their','in','to','for','with','uses','methods','parts','processes','practices','components','types','characteristics','properties'}


def words(text):
    # Used only for retrieval, never to compare or deduplicate question text.
    return set(re.findall(r'[a-z]+',text.lower()))


def main():
    paths={'bank':'rag/bank/quiz-bank-v2.jsonl','cards':'rag/pipeline/cardsPool.app.json',
           'baseline':'tools/assessment-evaluation/reports/2026-09-28/subcategories.csv'}
    raw={k:(ROOT/v).read_bytes() for k,v in paths.items()}
    pool=json.loads(raw['cards']);bank={q['factId']:q for q in map(json.loads,raw['bank'].splitlines())}
    cards_by_fact=defaultdict(list);facts_by_cat=defaultdict(set)
    for card in pool['cards']:
        cards_by_fact[card['factId']].append(card)
        for cat in card.get('cats',[]): facts_by_cat[cat].add(card['factId'])
    baseline=list(csv.DictReader(raw['baseline'].decode().splitlines()))
    cats={r['id']:r for r in baseline}
    same_topic=defaultdict(set)
    for cat in cats:
        same_topic[cat.split('-',1)[1]].update(facts_by_cat[cat])
    valid={fid:q for fid,q in bank.items() if fid in cards_by_fact and not structural_flags(q)}
    index=defaultdict(set)
    for fid,q in valid.items():
        text=' '.join([fid,q['q']['en'],q['options'][q['answer']]['en']])
        for word in words(text):index[word].add(fid)
    rows=[];details=[]
    for baseline_row in baseline:
        cat_id=baseline_row['id'];domain_topic=cat_id.split('-',1)[1];topic=domain_topic.split('-',1)[1]
        direct=set(valid)&facts_by_cat[cat_id]
        sibling=(same_topic[domain_topic]&valid.keys())-direct
        terms=ALIASES.get(topic,sorted(words(topic)-STOP))
        lexical=Counter()
        for term in terms:
            hits=None
            for word in words(term):hits=set(index[word]) if hits is None else hits & index[word]
            for fid in hits or ():lexical[fid]+=1
        additional=(sibling|set(lexical))-direct
        ranked=sorted(additional,key=lambda f:(f not in sibling,-lexical[f],valid[f].get('v')!=2,len(valid[f]['q']['en'].split()),f))
        # Keep a reviewable shortlist rather than flooding the author with every lexical match.
        shortlist=ranked[:24]
        direct3={f for f in direct if len(valid[f]['options'])==3}
        direct_stems={valid[f]['q']['en'] for f in direct3}
        more3={valid[f]['q']['en'] for f in additional if len(valid[f]['options'])==3}-direct_stems
        row=dict(id=cat_id,grade=int(baseline_row['grade']),domain=baseline_row['domain'],
                 baseline_projected_distinct_3_option=int(baseline_row['distinct_en_stems_valid_3_option']),
                 direct_bank_questions=len(direct),direct_bank_distinct_3_option=len(direct_stems),
                 additional_unreviewed_candidates=len(additional),additional_unreviewed_distinct_3_option=len(more3),
                 same_topic_other_grade_candidates=len(sibling),shortlisted_additional_candidates=len(shortlist),
                 disposition='inventory only; curriculum and question-level review required',
                 new_item_requirement='undetermined; do not subtract unreviewed retrieval leads from the authoring budget')
        rows.append(row)
        def lead(fid):
            q=valid[fid]
            return dict(fact_id=fid,card_ids=[c['id'] for c in cards_by_fact[fid]],bank_version=q.get('v',1),grades=q.get('grades'),
                        question_en=q['q']['en'],options_en=[o['en'] for o in q['options']],answer_index=q['answer'],
                        routing='same topic in another grade' if fid in sibling else 'lexical retrieval only')
        details.append(dict(**row,direct_bank_fact_ids=sorted(direct),search_terms=terms,additional_review_shortlist=[lead(f) for f in shortlist]))
    assert len(rows)==335
    assert 'iron' not in words('environment'), 'Retrieval must use whole words, not substring matches'
    assert any(r['id']=='g4-living_things-animal-diets' and any('herbivore' in c['question_en'].lower() for c in r['additional_review_shortlist']) for r in details), 'Known mapping-gap control not retrieved'
    for key,path in paths.items():assert raw[key]==(ROOT/path).read_bytes(),f'Input changed during inventory: {path}'
    data=dict(created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
              basis='Newer merged bank matched to core current-feed cards. Lesson-supplement projection is retained only as a labelled baseline column.',
              limitations=['All additional rows are retrieval leads, not accepted mappings, equivalent forms, or validated coverage.',
                           'Grades and broad taxonomy labels can be wrong; review the actual knowledge against the curriculum and exposure route.',
                           'A question can appear in multiple subcategories; do not sum overlapping candidate counts as unique questions.',
                           'Only exact original English stems are deduplicated; semantic duplicates require review.',
                           'Four-option bank candidates remain visible for possible reuse or revision.'],
              source_files={k:dict(path=paths[k],sha256=hashlib.sha256(v).hexdigest()) for k,v in raw.items()},subcategories=details)
    (OUT/'inventory.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    with (OUT/'inventory.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    thin=[r for r in rows if r['baseline_projected_distinct_3_option']<12]
    summary=dict(subcategories=len(rows),baseline_thin_subcategories=len(thin),
                 thin_with_additional_candidates=sum(r['additional_unreviewed_candidates']>0 for r in thin),
                 accepted_mapping_changes=0,new_generation_requirement='not yet established')
    (OUT/'inventory-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
