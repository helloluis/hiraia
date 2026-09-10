from pathlib import Path
import json,collections,re,hashlib,argparse
r=Path(__file__).resolve().parents[2];cli=argparse.ArgumentParser();cli.add_argument('--out',required=True,type=Path);args=cli.parse_args();out=args.out;out.mkdir(parents=True,exist_ok=True);assert not (out/'screening.jsonl').exists(),'Use a fresh output directory to preserve the original screening snapshot'
pool=json.loads((r/'rag/pipeline/cardsPool.app.json').read_text())['cards'];by={c['factId']:c for c in pool};exc=json.loads((r/'packages/mobile/src/data/curriculumTagExclusions.json').read_text());reviews=collections.defaultdict(list)
for p in sorted((r/'tools/curriculum-tag-audit/runs').glob('*/*.review.jsonl')):
 for line in p.read_text().splitlines():
  try:x=json.loads(line)
  except ValueError:continue
  if x.get('fact_id') in exc and x.get('disposition')=='exclude':reviews[x['fact_id']].append(x)
lessons={}
for g in range(3,11):
 for l in json.loads((r/f'rag/pipeline/grade{g}-lessons.authoring.json').read_text())['lessons']:
  for u in l['units']:lessons.setdefault(u['competency'],[]).append(dict(lesson=l['key'],unit=u['id'],pattern=u['pattern']))
rows=[];ct=collections.Counter();codes=collections.Counter()
for f in sorted(set(exc)&set(by)):
 c=by[f];rs=reviews.get(f,[]);flags=sorted({flag for x in rs for flag in x.get('flags',[])})
 assignments={a['code']:a for x in rs for a in x.get('assigned_reviews',[]) if a['code'] in lessons}
 matches=[dict(code=code,**u) for code in assignments for u in lessons[code] if re.search(u['pattern'],c['fact']['en'],re.I|re.S)]
 format_reasons=[code for code,a in assignments.items() if re.search(r'flow.?chart|diagram|format|required representation|labeled|labelled|model|table|list',a.get('reason',''),re.I)]
 lane='flagged_quality' if any(x in flags for x in ['possible_factual_error','translation_mismatch']) else 'format_rejection_with_core_match' if format_reasons and matches else 'core_text_match_needs_review' if matches else 'no_current_core_match' if rs else 'missing_prior_review'
 row=dict(factId=f,id=c['id'],textHash=hashlib.sha256(json.dumps(c['fact'],sort_keys=True,ensure_ascii=False).encode()).hexdigest(),screen=lane,flags=flags,previousExclusion=exc[f],assignedReviews=list(assignments.values()),candidateUnits=matches)
 rows.append(row);ct[lane]+=1
 if lane=='format_rejection_with_core_match':
  for code in set(m['code'] for m in matches):codes[code]+=1
(out/'screening.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))
(out/'screening-summary.json').write_text(json.dumps(dict(scope='All currently excluded bundled unique facts; screening is not editorial approval',total=len(rows),counts=ct,formatCandidateCodes=codes),indent=2)+'\n')
print(ct);print(codes.most_common(30))
