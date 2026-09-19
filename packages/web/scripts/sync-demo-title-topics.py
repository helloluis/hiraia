from pathlib import Path
import json, sys
repo=Path(sys.argv[1]).resolve()
root=repo/'packages/mobile/src'
leaves={x['id']:x for x in json.loads((root/'generated/cardsIndex.generated.json').read_text())['taxonomy']}
rows=[]
for grade in range(3,11):
 for l in json.loads((root/f'generated/grade{grade}Lessons.generated.json').read_text())['lessons']:
  category=next((leaves[x]['parent'] for x in l['subcategories'] if x in leaves),'Science')
  rows.append(dict(key=l['key'],grade=grade,quarter=l['quarter'],title=l['title'],category=category,codes=l['codes'],cardIds=l['cardIds']))
p=Path(__file__).resolve().parents[1]/'src/data/demo-title-topics.json'
# Only retain demo card ids; metadata follows the same authored lessons as Android.
ids=set(); tags={}
for f in p.parent.glob('demo-q1-*.json'):
 pack=json.loads(f.read_text()); ids.update(c['id'] for c in pack['cards']); tags.update(pack.get('tags',{}))
for r in rows:
 r['cardIds']=list(dict.fromkeys([x for x in r['cardIds'] if x in ids]+[x for x,t in tags.items() if t[0] in r['codes']]))
 del r['codes']
p.write_text(json.dumps([r for r in rows if r['cardIds']],ensure_ascii=False,separators=(',',':'))+'\n')
