"""Export reserved second-pass facts with cross-competency leads, never approvals."""
import argparse,datetime,hashlib,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[2];base=root/'tools/curriculum-recovery'
p=argparse.ArgumentParser();p.add_argument('--owner',choices=['local','external_a','external_b','external_c'],default='local');p.add_argument('--limit',type=int,default=96);p.add_argument('--out',required=True,type=Path);a=p.parse_args();assert a.limit>0 and not a.out.exists()
inv=json.loads((base/'second-pass-inventory.json').read_text()); allowed=set(inv['factIds']);reserved=set()
partition_path=base/'second-pass-partitions.json'
if partition_path.exists():
 partitions=json.loads(partition_path.read_text());allowed &= set(partitions[a.owner])
 number=int(a.out.name.split('.')[0].split('-')[1]);lo,hi=partitions['batchRanges'][a.owner];assert lo<=number<=hi,'Wrong batch range for partition'
elif a.owner!='local':raise ValueError('External partition has not been allocated')
for f in base.glob('batch-*.packet.json'):reserved.update(r['factId'] for r in json.loads(f.read_text()))
for f in base.glob('batch-*.review.jsonl'):reserved.update(json.loads(l)['factId'] for l in f.read_text().splitlines())
rows=[json.loads(l) for l in (base/'screening.jsonl').read_text().splitlines() if json.loads(l)['factId'] in allowed-reserved]
rows.sort(key=lambda r:(not(bool(r['assignedReviews']) and all(v['verdict']=='wrong' for v in r['assignedReviews'])),r['factId']))
pool={c['factId']:c for c in json.loads((root/'rag/pipeline/cardsPool.app.json').read_text())['cards']};units=[]
for g in range(3,11):
 for lesson in json.loads((root/f'rag/pipeline/grade{g}-lessons.authoring.json').read_text())['lessons']:
  for u in lesson['units']:units.append({'code':u['competency'],'lesson':lesson['key'],'unit':u['id'],'pattern':u['pattern']})
packet=[]
for row in rows[:a.limit]:
 c=pool[row['factId']];r=dict(row);r['originalCandidateUnits']=r['candidateUnits'];r['candidateUnits']=[u for u in units if re.search(u['pattern'],c['fact']['en'],re.I|re.S)];r.update(copy=c['fact'],exportedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),reviewPass=2,textHash=hashlib.sha256(json.dumps(c['fact'],sort_keys=True,ensure_ascii=False).encode()).hexdigest());packet.append(r)
a.out.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n');print(f'Exported {len(packet)} of {len(rows)} unreserved second-pass candidates. Global matches are noisy leads only.')
