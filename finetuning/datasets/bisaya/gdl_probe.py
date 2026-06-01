#!/usr/bin/env python3
import json, urllib.request
UA={"User-Agent":"Mozilla/5.0 (research)"}
def get(u,t=25):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read().decode()

out=[]
# what languages exist?
try:
    langs=json.loads(get("https://api.digitallibrary.io/book-api/v1/languages"))
    ceb=[l for l in langs if "ceb" in str(l).lower() or "bin" in str(l).lower() or "ce" in str(l.get("code","")).lower()]
    out.append("LANG matches: "+json.dumps(ceb, ensure_ascii=False))
except Exception as e:
    out.append("languages err: "+str(e))

for u in [
    "https://api.digitallibrary.io/book-api/v1/books/ceb?page-size=5",
    "https://api.digitallibrary.io/book-api/v1/books/ceb/?page-size=5",
    "https://api.digitallibrary.io/book-api/v1/books/ceb-fil?page-size=5",
]:
    try:
        d=json.loads(get(u))
        keys=list(d.keys()) if isinstance(d,dict) else type(d).__name__
        n=len(d.get("results",[])) if isinstance(d,dict) else 0
        out.append(f"{u}\n   keys={keys} results={n}\n   raw0={json.dumps(d)[:300]}")
    except Exception as e:
        out.append(f"{u}\n   ERR {e}")

open("/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw/gdl_probe.txt","w").write("\n\n".join(out)+"\n")
print("done")
