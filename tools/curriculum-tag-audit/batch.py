#!/usr/bin/env python3
"""Export bounded, source-fingerprinted audit packets; never modifies curriculum tags."""
import argparse, hashlib, json, sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--grade',type=int,choices=range(3,11))
ap.add_argument('--code',help='Filter by any currently assigned competency')
ap.add_argument('--offset',type=int,default=0)
ap.add_argument('--limit',type=int,default=10)
ap.add_argument('--expect-snapshot',help='Required fingerprint when continuing an existing audit')
ap.add_argument('--output',type=Path,required=True)
a=ap.parse_args()
if a.limit<1 or a.limit>100 or a.offset<0: ap.error('limit must be 1–100; offset must be nonnegative')
paths={
 'index':'packages/mobile/src/generated/cardsIndex.generated.json',
 'text':'packages/mobile/assets/data/cards.db',
 'source_tags':'rag/bank/curriculum-tags.json',
 'runtime_tags':'packages/mobile/src/generated/curriculumTags.generated.json',
 'exclusions':'packages/mobile/src/data/curriculumTagExclusions.json',
 'elementary':'rag/sources/curriculum-guides/matatag-elementary-competencies.json',
 'jhs':'rag/sources/curriculum-guides/matatag-jhs-competencies.json',
 'outline':'packages/mobile/src/generated/curriculumOutline.generated.json',
}
def read(key):return json.loads((ROOT/paths[key]).read_text())
hashes={key:hashlib.file_digest((ROOT/path).open('rb'),'sha256').hexdigest() for key,path in paths.items()}
snapshot=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()
if a.expect_snapshot and a.expect_snapshot!=snapshot:ap.error('Source snapshot changed. Rebase the audit; do not continue by old offsets.')
catalog={}
for key in ('elementary','jhs'):
 doc=read(key)
 for quarter in doc['quarters']:
  for c in quarter['competencies']:
   catalog[c['code']]={**c,'grade':quarter['grade'],'quarter':quarter['quarter'],'domain':quarter['domain'],'content':quarter.get('content'),'source_file':paths[key],'source':doc.get('source')}
if a.code and a.code not in catalog:ap.error('Unknown competency code')
raw=read('source_tags')['factoids'];runtime=read('runtime_tags');exclusions=read('exclusions')
cards=read('index')['cards'];queue=[]
for card in cards:
 source=raw.get(card['id'],{});live=runtime.get(card['id'])
 codes=list(dict.fromkeys([*(source.get('codes') or ([source['competency']] if source.get('competency') else [])),*((live[5] if len(live)>5 else [live[0]]) if live else [])]))
 if a.code and a.code not in codes:continue
 if a.grade and not any(catalog.get(c,{}).get('grade')==a.grade for c in codes):continue
 queue.append((card,codes,source,live))
# Stable IDs, with explicitly excluded cards first as calibration cases.
queue.sort(key=lambda row:(row[0]['factId'] not in exclusions,row[0]['factId'],row[0]['id']))
selected=queue[a.offset:a.offset+a.limit]
with sqlite3.connect(f'file:{ROOT/paths["text"]}?mode=ro',uri=True) as db:
 db.row_factory=sqlite3.Row;items=[]
 for card,codes,source,live in selected:
  text=db.execute('SELECT * FROM card_text WHERE id=?',(card['id'],)).fetchone()
  if text is None:raise SystemExit('Missing card text: '+card['id'])
  item={'id':card['id'],'fact_id':card['factId'],'topic':card['topic'],'categories':card.get('cats',[]),'copy':dict(text),'assigned_codes':codes,'source_tag':source,'runtime_tag':live,'existing_exclusion':exclusions.get(card['factId'])}
  item['item_sha256']=hashlib.sha256(json.dumps(item,sort_keys=True,ensure_ascii=False).encode()).hexdigest();items.append(item)
packet={'schema_version':1,'snapshot':snapshot,'source_sha256':hashes,'source_paths':paths,'filter':{'grade':a.grade,'code':a.code},'offset':a.offset,'next_offset':a.offset+len(items),'total_in_filter':len(queue),'items':items,'competency_catalog':catalog,'outline':read('outline')}
a.output.parent.mkdir(parents=True,exist_ok=True)
with a.output.open('x') as f:json.dump(packet,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'output':str(a.output),'snapshot':snapshot,'items':len(items),'next_offset':packet['next_offset'],'total_in_filter':len(queue)}))
