"""Compile authored MATATAG coverage slots against the bundled card bank.
Run from repository root. --check validates that generated output is current.
"""
import json,re,pathlib,hashlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
GRADE=int(sys.argv[sys.argv.index('--grade')+1]) if '--grade' in sys.argv else 5
assert GRADE in (3,4,5,6,7,8,9,10),'Only audited grades may be compiled'
author=ROOT/f'rag/pipeline/grade{GRADE}-lessons.authoring.json'
a=json.loads(author.read_text());p=json.loads((ROOT/'rag/pipeline/cardsPool.app.json').read_text());tags=json.loads((ROOT/'packages/mobile/src/generated/curriculumTags.generated.json').read_text());idx=json.loads((ROOT/'packages/mobile/src/generated/cardsIndex.generated.json').read_text());questions=set(idx['questionFactIds']);cross=json.loads((ROOT/f'docs/grade{GRADE}-subcategory-crosswalk.json').read_text())['mapping'];excluded=json.loads((ROOT/'packages/mobile/src/data/curriculumTagExclusions.json').read_text())
guide_file='matatag-elementary-competencies.json' if GRADE <= 6 else 'matatag-jhs-competencies.json'
quarters=json.loads((ROOT/'rag/sources/curriculum-guides'/guide_file).read_text())['quarters']
code_quarter={c['code']:q['quarter'] for q in quarters if q['grade']==GRADE for c in q['competencies']}
expected=set(code_quarter)
supp=json.loads((ROOT/f'packages/mobile/src/data/grade{GRADE}LessonSupplement.json').read_text());p['cards']+=supp['cards'];questions.update(supp['questions']);tags.update({id:[codes[0],GRADE,code_quarter[codes[0]],1,[],codes] for id,codes in supp['competencies'].items()})
available={c['id'] for c in idx['cards']}|{c['id'] for c in supp['cards']}
cards={c['id']:c for c in p['cards']}
for lesson in a['lessons']:
 assert all(code_quarter[u['competency']]==lesson['quarter'] for u in lesson['units']), f"Wrong quarter: {lesson['key']}"
result=[];gaps=[];evidence=[]
enrichment={r['subcategory_id'] for r in cross if r['role']=='enrichment'}
for lesson in a['lessons']:
 out={k:v for k,v in lesson.items() if k!='units'};out['codes']=list(dict.fromkeys(u['competency'] for u in lesson['units']));out['subcategories']=[r['subcategory_id'] for r in cross if r['role']!='enrichment' and set(r['competencies'])&set(out['codes'])]
 units=[]
 for u in lesson['units']:
  match=re.compile(u['pattern'],re.I|re.S); candidates=[]
  for c in p['cards']:
   if c['id'] not in available:continue
   t=tags.get(c['id']);codes=(t[5] if len(t)>5 and t[5] else [t[0]]) if t else []
   if c['factId'] in excluded or not t or t[3]<.2 or u['competency'] not in codes:continue
   text=c.get('fact',{}).get('en','')
   if not match.search(text):continue
   # Author reviewed scoped exclusions can reject a misleading assignment without
   # deleting the card or its other discovery labels.
   if c['id'] in a.get('excludedCardIds',[]):continue
   if c.get('cats') and all(cat in enrichment for cat in c['cats']):continue
   candidates.append(c['id'])
  candidates.sort(key=lambda id:(cards[id]['factId'] not in questions, len(cards[id].get('fact',{}).get('en','')),id))
  # One fact can have more than one rendered card; avoid treating paraphrases as depth.
  seen=set();candidates=[id for id in candidates if not(cards[id]['factId'] in seen or seen.add(cards[id]['factId']))]
  quiz=[id for id in candidates if cards[id]['factId'] in questions]
  units.append(dict(id=u['id'],competency=u['competency'],focus=u['focus'],cardIds=candidates,quizCardIds=quiz))
  evidence.append(dict(lesson=lesson['key'],unit=u['id'],cards=len(candidates),quizzes=len(quiz),examples=[dict(id=id,text=cards[id]['fact']['en']) for id in candidates[:2]]))
  if not candidates:gaps.append(u['id']+' has no instructional card')
  if not quiz:gaps.append(u['id']+' has no quiz')
 out['units']=units
 out['coreCardIds']=list(dict.fromkeys(id for u in units for id in u['cardIds']))
 core_facts={cards[id]['factId'] for id in out['coreCardIds']}
 related=[];related_facts=set();groups={}
 for c in p['cards']:
  if c['id'] not in available or c['factId'] in excluded or c['id'] in a.get('excludedCardIds',[]):continue
  t=tags.get(c['id']);codes=(t[5] if len(t)>5 and t[5] else [t[0]]) if t else []
  # Additional examples still need a reviewed competency match at the normal confidence
  # floor. Category names alone do not establish grade or lesson relevance.
  if not t or t[3]<.2 or not set(codes)&set(out['codes']):continue
  if c.get('cats') and all(cat in enrichment for cat in c['cats']):continue
  if c['factId'] in core_facts or c['factId'] in related_facts:continue
  related_facts.add(c['factId']);related.append(c['id'])
  shelf='|'.join(sorted(c.get('cats') or [code for code in codes if code in out['codes']]))
  groups.setdefault(shelf,[]).append(c['id'])
 # Stable hashed ordering avoids privileging the oldest source/import batch forever.
 for ids in groups.values():ids.sort(key=lambda id:hashlib.sha256(cards[id]['factId'].encode()).hexdigest())
 out['relatedCardIds']=related
 out['relatedGroups']=[dict(key=key,cardIds=ids) for key,ids in sorted(groups.items())]
 out['cardIds']=out['coreCardIds']+related
 if len({cards[id]['factId'] for id in out['cardIds']})<3:gaps.append(lesson['key']+' has fewer than 3 distinct facts; Calendar would hide or underfill it')
 out['revision']=hashlib.sha256(json.dumps(out,sort_keys=True).encode()).hexdigest()[:16];result.append(out)
assert set(c for l in result for c in l['codes'])==expected
reachable_facts={cards[id]['factId'] for l in result for id in l['cardIds']}
fact_ids={c['id']:c['factId'] for c in p['cards'] if c['factId'] in reachable_facts}
output=dict(schema=1,grade=GRADE,source=a['reference'],lessons=result,factIds=fact_ids,enrichment=[r['subcategory_id'] for r in cross if r['role']=='enrichment'])
out=ROOT/f'packages/mobile/src/generated/grade{GRADE}Lessons.generated.json'
text=json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n'
if '--check' in sys.argv:
 assert out.exists() and out.read_text()==text,f'Grade {GRADE} manifest is stale; regenerate it'
else:
 if not gaps:out.write_text(text)
report=json.dumps(dict(competencies=len(expected),lessons=len(result),targetCards=sum(l['target'] for l in result),gaps=gaps,units=evidence),indent=2,ensure_ascii=False)+'\n'
report_path=ROOT/f'docs/grade{GRADE}-lesson-coverage.json'
if '--check' in sys.argv:
 assert not gaps, gaps
 assert report_path.read_text()==report,'Coverage report is stale'
else:report_path.write_text(report)
print('Lessons',len(result),'objectives',len(expected),'coverage slots',len(evidence),'unique candidates',len(set(id for l in result for id in l['cardIds'])))
for l in result:print(l['key'],l['target'],'target',len(l['cardIds']),'eligible')
print('GAPS',json.dumps(gaps))

if gaps:raise SystemExit(f'Required lesson coverage has gaps; see docs/grade{GRADE}-lesson-coverage.json')
