#!/usr/bin/env python3
"""Build the next vertical-deepen wave's worklist. Picks WAVE fresh concepts (not yet
deepened), proportional to domain fact-share, each with its existing topics (so the
generator avoids dupes). Marks them done. Prints the compact JSON to stdout (pass as
Workflow args). Usage: python3 rag/scripts/deepen-worklist.py [WAVE]"""
import json, collections, random, sys, os
random.seed(int(os.environ.get('SEED','0')) or 1234)
WAVE = int(sys.argv[1]) if len(sys.argv)>1 else 45
HERE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK=os.path.join(HERE,'bank','science-facts.jsonl'); DONE=os.path.join(HERE,'bank','.deepened-concepts.txt')
rows=[json.loads(l) for l in open(BANK,encoding='utf-8') if l.strip()]
done=set(open(DONE).read().split()) if os.path.exists(DONE) else set()
def ckey(r):
    i=r['id']; i=i.rsplit('-g',1)[0] if '-g' in i else i; t=i.split('-'); return '-'.join(t[:2]) if len(t)>=2 else t[0]
byc=collections.defaultdict(list)
for r in rows: byc[ckey(r)].append(r)
concepts={k:v for k,v in byc.items() if 2<=len(v)<=60 and k not in done}
def dom(v): return collections.Counter(x['domain'] for x in v).most_common(1)[0][0]
bydom=collections.defaultdict(list)
for k,v in concepts.items(): bydom[dom(v)].append(k)
share={'LIVING_THINGS':0.61,'EARTH_SPACE':0.14,'MATTER':0.12,'FORCE_MOTION_ENERGY':0.12,'PH_GEOGRAPHY':0.02,'PH_CIVICS':0.005}
picks=[]
for d,frac in share.items():
    n=max(1,round(WAVE*frac)); ks=bydom.get(d,[]); random.shuffle(ks); picks+=[(d,k) for k in ks[:n]]
wl=[]
for d,k in picks:
    v=concepts[k]; gr=sorted({g for x in v for g in x.get('grades',[])}) or [4,7]
    wl.append({'concept':k,'domain':d,'grade_range':[min(gr),max(gr)],
               'existing_topics':[x['topic'] for x in v][:18]})
open(DONE,'a').write('\n'.join(w['concept'] for w in wl)+'\n')
sys.stderr.write(f"wave: {len(wl)} fresh concepts ({len(done)} already done, {len(concepts)} remain)\n")
print(json.dumps(wl,ensure_ascii=False))
