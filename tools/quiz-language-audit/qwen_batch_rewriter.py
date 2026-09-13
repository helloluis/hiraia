"""Bounded comparison: ten independent quiz edits per request, proposals only."""
import argparse,collections,concurrent.futures,fcntl,hashlib,json,os,time,urllib.request,urllib.error
from pathlib import Path
import qwen_rewriter as q
E=q.E
WRAPPER='''Apply the editing instructions independently to each entry in the quizzes array. Each entry has an id and the same quiz data used for an individual edit. Return exactly one result per supplied id in the results array, preserving ids. Never transfer facts, options, or findings between entries. A hold applies only to its own entry. Return the complete result object for every entry; do not omit later entries or abbreviate repeated fields.'''

def build(items,prompt):
 assert len(items)==10
 assert len({len(i['job']['content']['target']['options']) for i in items})==1
 q.PROMPT=prompt
 entries=[]
 for i in items:entries.append({'id':i['job']['key'],'quiz':json.loads(q.make_payload(i)['messages'][1]['content'])})
 schema=E.obj({'results':{'type':'array','minItems':len(items),'maxItems':len(items),'items':E.obj({'id':{'type':'string','enum':[i['job']['key'] for i in items]},'result':E.schema(items[0]['job']['content'],'rewrite')})}})
 p=q.make_payload(items[0]);p['messages']=[{'role':'system','content':prompt+'\n\n'+WRAPPER},{'role':'user','content':E.a.canonical({'quizzes':entries})}];p['response_format']['json_schema']['schema']=schema
 # Same maximum token allowance per card as the individual baseline.
 p['thinking_budget']=4096*len(items);p['max_tokens']=8000*len(items)
 return p

def unique_object(pairs):
 d={}
 for k,v in pairs:
  if k in d:raise ValueError('Duplicate JSON key')
  d[k]=v
 return d

def parse(raw,items,p):
 ch=raw['choices'][0]
 if ch.get('finish_reason')!='stop':raise ValueError('Incomplete response: '+str(ch.get('finish_reason')))
 x=json.loads(ch['message']['content'],object_pairs_hook=unique_object);E.validate(x,p['response_format']['json_schema']['schema'])
 byid={i['job']['key']:i for i in items};ids=[z['id'] for z in x['results']]
 if len(set(ids))!=len(ids) or set(ids)!=set(byid):raise ValueError('Missing/duplicate/unknown card ids')
 result={}
 for z in x['results']:
  item=byid[z['id']]
  try:
   changes=q.validate(z['result'],item);result[item['sample_id']]={'status':'held' if z['result']['status']=='hold' else 'proposal','result':z['result'],'changes':changes}
  except ValueError as ex:result[item['sample_id']]={'status':'rejected','error':str(ex),'result':z['result']}
 return result

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--sample',type=Path,required=True);ap.add_argument('--prompt-file',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--prepare',action='store_true');a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 lock=(a.out/'run.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 items=json.loads(a.sample.read_text());prompt=a.prompt_file.read_text();groups=[[i for i in items if i['job']['content']['language']==lang] for lang in ['bis','tl']];payloads=[build(g,prompt) for g in groups]
 ceilings=[((len(E.a.canonical(p).encode())+4096)*2+p['max_tokens']*6)/1e6 for p in payloads]
 if sum(ceilings)>2:raise ValueError('Worst-case reserve exceeds $2')
 cfg={'sample_sha256':E.a.digest(items),'prompt_sha256':E.a.digest(prompt),'wrapper':WRAPPER,'runner_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'model':q.MODEL,'batch_size':10,'requests':2,'max_tokens_each':80000,'thinking_budget_each':40960,'ceiling_usd':sum(ceilings),'budget_usd':2,'retries':0}
 f=a.out/'config.json'
 if f.exists() and json.loads(f.read_text())!=cfg:raise ValueError('Configuration changed')
 E.a.write_json(f,cfg);E.a.write_json(a.out/'sample.json',items)
 for n,p in enumerate(payloads,1):E.a.write_json(a.out/'batches'/str(n)/'request.json',p)
 if a.prepare:print(json.dumps(cfg));return
 key=os.environ.get('ALIBABACLOUD_API_KEY')
 if not key:key=next(l.split('=',1)[1].strip().strip('\"\'') for l in (q.g.REPO/'.env.local').read_text().splitlines() if l.strip().startswith('ALIBABACLOUD_API_KEY='))
 def run(n):
  d=a.out/'batches'/str(n+1);p=payloads[n]
  if (d/'started.json').exists():return
  E.a.write_json(d/'started.json',{'time':time.time(),'reserved_usd':ceilings[n]})
  try:
   req=urllib.request.Request(q.URL,data=E.a.canonical(p).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=420) as response:raw=json.load(response)
   E.a.write_json(d/'response.json',raw);results=parse(raw,groups[n],p)
   for i,x in results.items():E.a.write_json(a.out/'results'/str(i)/'final.json',x)
   E.a.write_json(d/'finished.json',{'time':time.time(),'validated_ids':len(results)});print(n+1,'received',len(results),'cards',flush=True)
  except Exception as ex:
   detail=ex.read(16000).decode(errors='replace').replace(key,'[REDACTED]') if isinstance(ex,urllib.error.HTTPError) else None
   E.a.write_json(d/'error.json',{'error':str(ex).replace(key,'[REDACTED]'),'provider_detail':detail,'time':time.time()});print(n+1,'ERROR',str(ex).replace(key,'[REDACTED]'),flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,range(2)))
 usage=collections.Counter();cost=unknown=0
 for n in range(1,3):
  d=a.out/'batches'/str(n)
  if (d/'response.json').exists():
   u=json.loads((d/'response.json').read_text()).get('usage',{})
   for k in ['prompt_tokens','completion_tokens']:usage[k]+=u.get(k,0)
   usage['reasoning_tokens']+=u.get('completion_tokens_details',{}).get('reasoning_tokens',0);cost+=(u.get('prompt_tokens',0)*2+u.get('completion_tokens',0)*6)/1e6
  elif (d/'started.json').exists():unknown+=json.loads((d/'started.json').read_text())['reserved_usd']
 counts=collections.Counter(json.loads(p.read_text())['status'] for p in (a.out/'results').glob('*/final.json'))
 summary={'counts':dict(counts),'batch_errors':len(list((a.out/'batches').glob('*/error.json'))),'usage':dict(usage),'estimated_usd':cost,'unknown_reserved_usd':unknown};E.a.write_json(a.out/'summary.json',summary);print(json.dumps(summary),flush=True)
if __name__=='__main__':main()
