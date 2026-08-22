#!/usr/bin/env python3
"""Local smoke test for harvest_bloom.py: 3 tl books + 3 ceb books, extraction sanity."""
import sys
sys.path.insert(0, "/Users/luis/Code/hiraia/finetuning/cpt")
import json, urllib.parse
import harvest_bloom as hb

for lang in ("tl", "ceb"):
    cfg = hb.LANGS[lang]
    ptrs = [{"__type": "Pointer", "className": "language", "objectId": p} for p in cfg["pointers"]]
    where = json.dumps({"langPointers": {"$in": ptrs}, "inCirculation": True})
    q = {"where": where, "limit": "6", "keys": "title,baseUrl,license,pageCount"}
    books = hb.get_json(f"{hb.PARSE}/classes/books?{urllib.parse.urlencode(q)}").get("results", [])
    print(f"== {lang}: {len(books)} books ==")
    for b in books:
        if not hb.license_ok(b.get("license")):
            print(f"  SKIP-LIC {b.get('license')}: {b.get('title')!r}")
            continue
        url = hb.htm_url(b)
        html = hb.fetch(url) if url else None
        if html is None:
            alt = hb.htm_url_via_listing(b)
            html = hb.fetch(alt) if alt else None
            url = alt
        if html is None:
            print(f"  SKIP-FETCH {b.get('title')!r} url={url}")
            continue
        text = hb.extract_text(html, cfg["html_langs"])
        print(f"  OK {b.get('title')!r} lic={b.get('license')} chars={len(text)}")
        print(f"     head: {text[:120]!r}")
