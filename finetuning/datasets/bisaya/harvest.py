#!/usr/bin/env python3
"""Bisaya dataset harvester — pulls pages via the kamai headless-browser API
and writes formatted .txt source files per PLAYWRIGHT-SOURCING-BRIEF.md."""
import json, os, sys, time, urllib.request, urllib.error, re

BASE = "https://kamai.minai.work/api/v1/browse"
API_KEY = os.environ["KAMAI_API_KEY"]
ROOT = "/Users/luis/Code/hiraia/finetuning/datasets/bisaya"
OUT = os.path.join(ROOT, "sources")
RAW = os.path.join(ROOT, ".raw")
DATE = "2026-05-31"

def browse(url, selector=None, actions=None, timeout=30000):
    body = {"url": url, "timeout": timeout}
    if selector: body["selector"] = selector
    if actions: body["actions"] = actions
    req = urllib.request.Request(
        BASE, data=json.dumps(body).encode(),
        headers={"x-api-key": API_KEY, "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            cost = r.headers.get("X-Request-Cost", "?")
            return json.loads(r.read().decode()), cost
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode()[:200]}"}, "0"
    except Exception as e:
        return {"ok": False, "error": str(e)}, "0"

def save(slug, title, url, text, grade, notes, lang="Bisaya/Cebuano"):
    path = os.path.join(OUT, slug + ".txt")
    hdr = (f"# {title}\nSource: {url}\nRetrieved: {DATE}\nLanguage: {lang}\n"
           f"Grade level: {grade}\n\n{text}\n\n## Notes\n{notes}\n")
    with open(path, "w") as f:
        f.write(hdr)
    return path, len(text.split())

def harvest(job):
    """job: dict with slug,title,url,grade,notes, optional selector/actions."""
    d, cost = browse(job["url"], job.get("selector"), job.get("actions"))
    # stash raw for debugging
    with open(os.path.join(RAW, job["slug"] + ".json"), "w") as f:
        json.dump(d, f)
    if not d.get("ok"):
        print(f"  FAIL  {job['slug']}: {d.get('error')}")
        return None
    text = (d.get("text") or "").replace("\\n", "\n").strip()
    words = len(text.split())
    path, _ = save(job["slug"], job["title"], job["url"], text,
                   job.get("grade", "3-6"), job.get("notes", ""))
    flag = "" if words >= 200 else "  [LOW-WORDS]"
    print(f"  OK    {job['slug']}: {words}w  ${cost}{flag}")
    return {"slug": job["slug"], "words": words, "title": job["title"]}

if __name__ == "__main__":
    manifest_file = sys.argv[1]
    with open(manifest_file) as f:
        jobs = json.load(f)
    results = []
    for j in jobs:
        results.append(harvest(j))
        time.sleep(1.2)  # stay well under 60/min
    ok = [r for r in results if r]
    print(f"\nDONE: {len(ok)}/{len(jobs)} succeeded, "
          f"{sum(r['words'] for r in ok)} total words")
