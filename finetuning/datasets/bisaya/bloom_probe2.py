#!/usr/bin/env python3
"""Nail down how to extract text from one Bloom book on S3 before bulk run."""
import json, urllib.request, urllib.parse

PARSE="https://bloom-parse-server-production.azurewebsites.net/parse"
APPID="R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5"
HDR={"X-Parse-Application-Id":APPID}

def get_json(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url,headers=HDR),timeout=40).read().decode())
def get_raw(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=40).read().decode("utf-8","ignore")
    except Exception as e:
        return f"__ERR__ {e}"

LID="wzd9XQt2DG"
q={"where":json.dumps({"langPointers":{"__type":"Pointer","className":"language","objectId":LID}}),
   "limit":"3","keys":"title,baseUrl,license,copyright,pageCount"}
books=get_json(f"{PARSE}/classes/books?{urllib.parse.urlencode(q)}").get("results",[])
out=[]
for b in books:
    base=b.get("baseUrl","")
    out.append(f"TITLE {b.get('title')!r}\n  baseUrl={base}")
    # candidate text-bearing files under the harvest folder
    for cand in ["bloomdigital/index.htm","index.htm"]:
        url=urllib.parse.urljoin(base, cand) if base.endswith("/") else base+"/"+cand
        body=get_raw(url)
        ok = not body.startswith("__ERR__")
        out.append(f"  {cand}: {'OK len='+str(len(body)) if ok else body[:80]}")
        if ok:
            import re
            txt=re.sub(r"<[^>]+>"," ",body); txt=re.sub(r"\s+"," ",txt).strip()
            out.append(f"     text_words={len(txt.split())}  head={txt[:200]!r}")
    out.append("")
open("/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw/bloom_probe2.txt","w").write("\n".join(out)+"\n")
print("PROBE DONE")
