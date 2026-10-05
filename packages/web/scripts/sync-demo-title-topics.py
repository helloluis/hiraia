from pathlib import Path
import json, sys
repo=Path(sys.argv[1]).resolve()
root=repo/'packages/mobile/src'
leaves={x['id']:x for x in json.loads((root/'generated/cardsIndex.generated.json').read_text())['taxonomy']}
rows=[]
alltags=json.loads((root/'generated/curriculumTags.generated.json').read_text())
schedule=json.loads((repo/'packages/shared/src/curriculum/three-term-2026.json').read_text())['competencies']
for grade in range(3,11):
 for l in json.loads((root/f'generated/grade{grade}Lessons.generated.json').read_text())['lessons']:
  category=next((leaves[x]['parent'] for x in l['subcategories'] if x in leaves),'Science')
  terms=sorted({schedule[c]['term'] for c in l['codes']})
  for i,term in enumerate(terms):
   codes=[c for c in l['codes'] if schedule[c]['term']==term]
   ids=l['cardIds'] if len(terms)==1 else list(dict.fromkeys([x for u in l['units'] if u['competency'] in codes for x in u['cardIds']]+[x for x in l['relatedCardIds'] if any(c in codes for c in (alltags.get(x,[[]]*6)[5] if len(alltags.get(x,[]))>5 else alltags.get(x,[])[:1]))]))
   rows.append(dict(key=l['key'] if i==0 else f"{l['key']}:term{term}",grade=grade,term=term,title=l['title'],category=category,codes=codes,cardIds=ids))
p=Path(__file__).resolve().parents[1]/'src/data/demo-title-topics.json'
# Only retain demo card ids; metadata follows the same authored lessons as Android.
ids=set(); tags={}
for f in p.parent.glob('demo-q1-*.json'):
 pack=json.loads(f.read_text()); ids.update(c['id'] for c in pack['cards']); tags.update(pack.get('tags',{}))
for r in rows:
 r['cardIds']=list(dict.fromkeys([x for x in r['cardIds'] if x in ids]+[x for x,t in tags.items() if t[0] in r['codes']]))
 del r['codes']
p.write_text(json.dumps([r for r in rows if r['cardIds']],ensure_ascii=False,separators=(',',':'))+'\n')
