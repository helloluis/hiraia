"""Export the next manual-review packet; never retag cards or call an external model."""
import argparse,datetime,hashlib,json
from pathlib import Path
r=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--grade',type=int,choices=range(3,11));p.add_argument('--limit',type=int,default=24);p.add_argument('--offset',type=int,default=0);p.add_argument('--out',required=True,type=Path);args=p.parse_args();assert args.limit>0 and args.offset>=0;assert not args.out.exists(),'Do not overwrite a packet'
out=r/'tools/curriculum-recovery';rows=[json.loads(x) for x in (out/'screening.jsonl').read_text().splitlines()];pool={c['factId']:c for c in json.loads((r/'rag/pipeline/cardsPool.app.json').read_text())['cards']};ex=json.loads((r/'packages/mobile/src/data/curriculumTagExclusions.json').read_text());done=set()
for file in out.glob('batch-*.review.jsonl'):
 done.update(json.loads(line)['factId'] for line in file.read_text().splitlines())
# Exported packets reserve their IDs, including work assigned to active reviewers.
for file in out.glob('batch-*.packet.json'):
 done.update(row['factId'] for row in json.loads(file.read_text()))
rows=[x for x in rows if x['factId'] in ex and x['factId'] not in done and x['screen'] in ['format_rejection_with_core_match','core_text_match_needs_review'] and (args.grade is None or any(m['code'].startswith(f'G{args.grade}-') for m in x['candidateUnits']))]
rows.sort(key=lambda x:(x['screen']!='format_rejection_with_core_match',x['factId']))
packet=[]
for x in rows[args.offset:args.offset+args.limit]:
 c=pool[x['factId']];x=dict(x,copy=c['fact'],exportedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());x['textHash']=hashlib.sha256(json.dumps(c['fact'],sort_keys=True,ensure_ascii=False).encode()).hexdigest();packet.append(x)
args.out.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n');print(f'Exported {len(packet)} of {len(rows)} remaining candidates. Keyword matches are review leads, not approval.')
