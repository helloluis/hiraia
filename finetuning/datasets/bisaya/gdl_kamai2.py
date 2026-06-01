#!/usr/bin/env python3
"""Last GDL attempt: use kamai `evaluate` to read the rendered React DOM
(hrefs + text) after a long wait, across several candidate routes."""
import json, os, urllib.request

BASE="https://kamai.minai.work/api/v1/browse"
KEY=os.environ["KAMAI_API_KEY"]
RAW="/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw"

def browse(url,actions=None,timeout=30000):
    body={"url":url,"timeout":timeout}
    if actions: body["actions"]=actions
    req=urllib.request.Request(BASE,data=json.dumps(body).encode(),
        headers={"x-api-key":KEY,"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=120) as r:
        return json.loads(r.read().decode())

# JS that returns a compact JSON string of book links + text length
EVAL=("(()=>{const a=[...document.querySelectorAll('a')].map(x=>x.href)"
      ".filter(h=>/\\/(book|books)\\//.test(h));"
      "return JSON.stringify({hrefs:[...new Set(a)].slice(0,80),"
      "bodylen:document.body.innerText.length,"
      "head:document.body.innerText.slice(0,300)});})()")

routes=[
    "https://digitallibrary.io/ceb",
    "https://digitallibrary.io/ceb/topic/library-books/",
    "https://digitallibrary.io/ceb/search/?q=",
]
out={}
for u in routes:
    try:
        d=browse(u,actions=[
            {"action":"js_click","selector":"#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"},
            {"action":"wait_ms","ms":4000},
            {"action":"scroll_to","selector":"footer"},
            {"action":"wait_ms","ms":2500},
            {"action":"evaluate","text":EVAL},
        ])
        # evaluate result may surface in actions_performed or text; capture whole resp
        out[u]={"ok":d.get("ok"),"textlen":len(d.get("text","") or ""),
                "actions":d.get("actions_performed"),
                "evaluate":d.get("evaluate") or d.get("result"),
                "text_head":(d.get("text","") or "")[:400]}
    except Exception as e:
        out[u]={"err":str(e)}
json.dump(out,open(os.path.join(RAW,"gdl_kamai2.json"),"w"),indent=1,ensure_ascii=False)
print("done; routes:",len(out))
