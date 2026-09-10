"""Validate manual recovery decisions. Dry run by default; --apply updates reviewed tags only."""
import argparse,hashlib,json,re
from pathlib import Path
r=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('review',type=Path);p.add_argument('--apply',action='store_true');args=p.parse_args();args.review=args.review.resolve()
rows=[json.loads(x) for x in args.review.read_text().splitlines()]
assert len({x['factId'] for x in rows})==len(rows),'Duplicate decisions'
pool=json.loads((r/'rag/pipeline/cardsPool.app.json').read_text())['cards'];by={c['factId']:c for c in pool}
ex_path=r/'packages/mobile/src/data/curriculumTagExclusions.json';ov_path=r/'packages/mobile/src/data/curriculumTagOverrides.json'
ex=json.loads(ex_path.read_text());ov=json.loads(ov_path.read_text());prior=[]
for x in rows:
 if x['disposition']!='recover_core':continue
 c=by[x['factId']];assert c['id']==x['id'];assert hashlib.sha256(json.dumps(c['fact'],sort_keys=True,ensure_ascii=False).encode()).hexdigest()==x['textHash'],'Card changed since review'
 assert x['translationsChecked'] and all(c['fact'].get(k) for k in ['en','tl','bis'])
 assert x['factId'] in ex and ex[x['factId']]==x['previousExclusion'],'Exclusion changed since review; inspect instead of overwriting'
 assert x['codes'] and len(x['codes'])==len(set(x['codes']))
 for code in x['codes']:
  g=int(code.split('-')[0][1:]);a=json.loads((r/f'rag/pipeline/grade{g}-lessons.authoring.json').read_text());cross=json.loads((r/f'docs/grade{g}-subcategory-crosswalk.json').read_text())['mapping'];enrichment={v['subcategory_id'] for v in cross if v['role']=='enrichment'}
  assert c['id'] not in a['excludedCardIds'],'Grade-scoped exclusion requires separate review'
  assert not c.get('cats') or not all(cat in enrichment for cat in c['cats'])
  matches=[u for l in a['lessons'] for u in l['units'] if u['competency']==code and re.search(u['pattern'],c['fact']['en'],re.I|re.S)]
  assert matches,'Approved fact would not enter a core facet'
  assert any(e['unit'] in {u['id'] for u in matches} and e['quote'] in c['fact']['en'] for e in x['evidence'])
 prior.append(dict(factId=x['factId'],exclusion=ex[x['factId']],override=ov['factoids'].get(x['factId'])))
 del ex[x['factId']]
 ov['factoids'][x['factId']]=dict(id=c['id'],codes=x['codes'],disposition='correct',reviewer=x['reviewer'],reviewed_at=x['reviewedAt'],notes=x['reason']+' Evidence: '+str(args.review.relative_to(r)))
print(f'{len(rows)} decisions; {len(prior)} validated core recoveries')
if args.apply:
 rollback=args.review.with_suffix('.prior.json');assert not rollback.exists(),'Already applied or prior snapshot exists'
 rollback.write_text(json.dumps(prior,indent=2,ensure_ascii=False)+'\n')
 ex_path.write_text(json.dumps(ex,indent=2,ensure_ascii=False)+'\n');ov_path.write_text(json.dumps(ov,indent=2,ensure_ascii=False)+'\n')
 print('Applied. Regenerate tags, all lesson manifests, and content reach; run real-feed tests.')
