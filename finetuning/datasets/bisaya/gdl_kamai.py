#!/usr/bin/env python3
"""Drive the Global Digital Library Cebuano catalog via kamai (JS render),
dismissing the Cookiebot wall, then probe the one known book URL."""
import json, os, urllib.request

BASE = "https://kamai.minai.work/api/v1/browse"
KEY = os.environ["KAMAI_API_KEY"]
RAW = "/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw"

def browse(url, selector=None, actions=None, timeout=30000):
    body={"url":url,"timeout":timeout}
    if selector: body["selector"]=selector
    if actions: body["actions"]=actions
    req=urllib.request.Request(BASE,data=json.dumps(body).encode(),
        headers={"x-api-key":KEY,"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=120) as r:
        return json.loads(r.read().decode())

results={}

# 1) Catalog: accept cookies, wait for React, scroll to load books
cat=browse("https://digitallibrary.io/ceb",
    actions=[
        {"action":"js_click","selector":"#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"},
        {"action":"wait_ms","ms":3000},
        {"action":"scroll_to","selector":"footer"},
        {"action":"wait_ms","ms":2000},
    ])
links=cat.get("links",[])
booklinks=[l for l in links if "/books/details/" in l.get("href","") or "/book/" in l.get("href","")]
results["catalog"]={"ok":cat.get("ok"),"n_links":len(links),
    "booklinks":booklinks,"textlen":len(cat.get("text","") or "")}

# 2) Known book content URL
kb=browse("https://content.digitallibrary.io/ceb-fil/book/kaya-na-ba-nako/",
    actions=[{"action":"wait_ms","ms":3000}])
results["known_book"]={"ok":kb.get("ok"),"title":kb.get("title"),
    "textlen":len(kb.get("text","") or ""),
    "text_head":(kb.get("text","") or "")[:600]}

json.dump(results,open(os.path.join(RAW,"gdl_kamai.json"),"w"),indent=1,ensure_ascii=False)
print("catalog booklinks:",len(booklinks)," known_book textlen:",results["known_book"]["textlen"])
