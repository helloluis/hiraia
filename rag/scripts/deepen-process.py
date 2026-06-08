#!/usr/bin/env python3
"""Process a vertical-deepen workflow output: assemble -> id-dedup -> semantic-dedup
(LaBSE >0.90 vs existing-concept + intra-batch) -> validate -> append -> rebuild
facts.generated. Run with the LaBSE venv. Usage: deepen-process.py <workflow_output.json>"""
import json, re, sys, os, subprocess, collections
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel
HERE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK=os.path.join(HERE,'bank','science-facts.jsonl')
res=json.load(open(sys.argv[1]))
res=res.get('result',res); concepts=res['concepts']
existing=[json.loads(l) for l in open(BANK,encoding='utf-8') if l.strip()]
exids=set(r['id'] for r in existing)
def ckey(i):
    i=i.rsplit('-g',1)[0] if '-g' in i else i; t=i.split('-'); return '-'.join(t[:2]) if len(t)>=2 else t[0]
# assemble + validate + id-dedup
cands=[]; seen=set(); drop=collections.Counter()
def uniq(idv):
    b=idv;n=2
    while idv in exids or idv in seen: idv=f"{b}-{n}";n+=1
    seen.add(idv);return idv
for c in concepts:
    for f in c.get('facts',[]):
        tl,en,bis=(f.get('tl') or '').strip(),(f.get('en') or '').strip(),(f.get('bis') or '').strip()
        if not(tl and en and bis): drop['lang']+=1;continue
        terms=[t for t in (f.get('terms') or []) if t and t.strip()]
        if len(terms)<5: drop['terms']+=1;continue
        grades=sorted({g for g in (f.get('grades') or []) if isinstance(g,int) and 1<=g<=10})
        if not grades: drop['grades']+=1;continue
        idv=uniq(re.sub(r'[^a-z0-9-]','',(f.get('id') or '').lower()) or c['concept']+'-x')
        cands.append({'id':idv,'domain':c['domain'],'topic':(f.get('topic') or '').strip(),'grades':grades,
                      'terms':terms,'fact':{'tl':tl,'en':en,'bis':bis},
                      'source':'claude-workflow vertical-deepen','generator':'claude-workflow','reviewed':False,
                      '_c':ckey(idv)})
# semantic dedup
dev='mps' if torch.backends.mps.is_available() else 'cpu'
tok=AutoTokenizer.from_pretrained('sentence-transformers/LaBSE');m=AutoModel.from_pretrained('sentence-transformers/LaBSE').to(dev).eval()
def emb(ts):
    o=[]
    for i in range(0,len(ts),64):
        e=tok(ts[i:i+64],return_tensors='pt',padding=True,truncation=True,max_length=192).to(dev)
        with torch.no_grad(): cls=m(**e).last_hidden_state[:,0]
        o.append(F.normalize(cls,p=2,dim=1).cpu().numpy())
    return np.vstack(o).astype(np.float32) if o else np.zeros((0,768),np.float32)
def txt(r): return f"{r['topic']}. {r['fact']['tl']}"
touched=set(c['_c'] for c in cands)
exbyc=collections.defaultdict(list)
for r in existing:
    k=ckey(r['id'])
    if k in touched: exbyc[k].append(r)
cv=emb([txt(c) for c in cands]) if cands else np.zeros((0,768),np.float32)
byc=collections.defaultdict(list)
for i,c in enumerate(cands): byc[c['_c']].append(i)
kept=[]; ddup=0
for k,idxs in byc.items():
    ev=emb([txt(r) for r in exbyc.get(k,[])])
    keptlocal=[]
    for i in idxs:
        v=cv[i];d=False
        if len(ev) and float((ev@v).max())>0.90: d=True
        if not d and keptlocal and float((cv[keptlocal]@v).max())>0.90: d=True
        if d: ddup+=1
        else: keptlocal.append(i);kept.append(cands[i])
for c in kept: c.pop('_c',None)
with open(BANK,'a',encoding='utf-8') as fo:
    for c in kept: fo.write(json.dumps(c,ensure_ascii=False)+'\n')
total=sum(1 for l in open(BANK,encoding='utf-8') if l.strip())
print(f"generated={sum(len(c.get('facts',[])) for c in concepts)} valid={len(cands)} dropped={dict(drop)} semdup={ddup} KEPT={len(kept)} -> bank={total}")
subprocess.run(['python3', os.path.join(HERE,'scripts','export-facts-ts.py')], check=True)
