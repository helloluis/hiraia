#!/usr/bin/env python3
"""Discovery helper: browse index/catalog pages and dump their links so we can
find correct story slugs (huni-huni) and book URLs (digitallibrary)."""
import json, os, urllib.request

BASE = "https://kamai.minai.work/api/v1/browse"
API_KEY = os.environ["KAMAI_API_KEY"]

def browse(url, selector=None, actions=None, timeout=30000):
    body = {"url": url, "timeout": timeout}
    if selector: body["selector"] = selector
    if actions: body["actions"] = actions
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
        headers={"x-api-key": API_KEY, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())

targets = [
    ("huni-stories", "https://huni-huni.com/category/stories/", None),
    ("huni-songs", "https://huni-huni.com/category/songs/", None),
    ("dgl-catalog", "https://digitallibrary.io/ceb", None),
]
out = {}
for name, url, sel in targets:
    try:
        d = browse(url, sel)
        links = d.get("links", [])
        out[name] = {"ok": d.get("ok"), "title": d.get("title"),
                     "n_links": len(links), "links": links}
        print(f"{name}: ok={d.get('ok')} title={d.get('title')!r} links={len(links)}")
    except Exception as e:
        out[name] = {"ok": False, "error": str(e)}
        print(f"{name}: ERROR {e}")
json.dump(out, open(os.path.join(os.path.dirname(__file__), ".raw", "discover.json"), "w"), indent=1)
print("wrote .raw/discover.json")
