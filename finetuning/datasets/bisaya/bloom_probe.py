#!/usr/bin/env python3
"""Probe BloomLibrary's public Parse API for Cebuano/Bisaya books.
Bloom reader uses a public Parse Server app id (same one the BloomPub
reader ships with). We only read book metadata here."""
import json, urllib.request, urllib.parse

PARSE = "https://bloom-parse-server-production.azurewebsites.net/parse"
APPID = "R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5"
HDR = {"X-Parse-Application-Id": APPID, "Content-Type": "application/json"}

def parse_get(path, params):
    url = f"{PARSE}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode())

out = []
# 1) find the Cebuano language object(s)
try:
    langs = parse_get("classes/language", {
        "where": json.dumps({"isoCode": "ceb"}),
        "limit": "10"})
    out.append("LANG ceb: " + json.dumps(langs.get("results", []), ensure_ascii=False)[:600])
    lang_ids = [l["objectId"] for l in langs.get("results", [])]
except Exception as e:
    out.append("lang err: " + str(e)); lang_ids = []

# 2) count + sample books pointing at that language
for lid in lang_ids:
    try:
        cnt = parse_get("classes/books", {
            "where": json.dumps({"langPointers": {
                "__type": "Pointer", "className": "language", "objectId": lid}}),
            "count": "1", "limit": "0"})
        out.append(f"BOOK COUNT for lang {lid}: {cnt.get('count')}")
        sample = parse_get("classes/books", {
            "where": json.dumps({"langPointers": {
                "__type": "Pointer", "className": "language", "objectId": lid}}),
            "limit": "5",
            "keys": "title,baseUrl,license,copyright,pageCount,readingLevel,tags"})
        for b in sample.get("results", []):
            out.append(f"  - {b.get('title')!r} | lvl {b.get('readingLevel')} | "
                       f"{b.get('license')} | {b.get('pageCount')}pp | {b.get('baseUrl','')[:90]}")
    except Exception as e:
        out.append(f"book err for {lid}: {e}")

open("/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw/bloom_probe.txt","w").write("\n".join(out)+"\n")
print("\n".join(out))
