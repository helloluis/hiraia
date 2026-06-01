#!/usr/bin/env python3
"""Fetch the Global Digital Library Cebuano book catalog via its public API,
then pull full text for each book. CC-licensed content (P4 of the brief)."""
import json, os, urllib.request, time

ROOT = "/Users/luis/Code/hiraia/finetuning/datasets/bisaya"
OUT = os.path.join(ROOT, "sources")
RAW = os.path.join(ROOT, ".raw")
DATE = "2026-05-31"
UA = {"User-Agent": "Mozilla/5.0 (research; hiraia dataset)"}

def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()

def slugify(s):
    keep = "".join(c if c.isalnum() else "-" for c in s.lower())
    while "--" in keep: keep = keep.replace("--", "-")
    return keep.strip("-")[:60]

# 1) catalog
cat_url = "https://api.digitallibrary.io/book-api/v1/books/ceb?page-size=60"
data = json.loads(get(cat_url))
books = data.get("results") or data.get("books") or []
print(f"catalog: {len(books)} Cebuano books")
summary = []

for b in books:
    bid = b.get("id")
    title = b.get("title", "untitled")
    level = b.get("readingLevel")
    # 2) book detail (chapters live here)
    try:
        det = json.loads(get(f"https://api.digitallibrary.io/book-api/v1/books/ceb/{bid}"))
    except Exception as e:
        print(f"  detail FAIL {bid} {title}: {e}"); continue
    chapters = det.get("chapters", [])
    texts = []
    for ch in chapters:
        cid = ch.get("id")
        try:
            cd = json.loads(get(f"https://api.digitallibrary.io/book-api/v1/books/ceb/{bid}/chapters/{cid}"))
            # chapter content is HTML; strip tags crudely
            import re
            html = cd.get("content", "")
            txt = re.sub(r"<[^>]+>", " ", html)
            txt = re.sub(r"\s+", " ", txt).strip()
            if txt: texts.append(txt)
        except Exception:
            pass
        time.sleep(0.2)
    full = "\n\n".join(texts).strip()
    words = len(full.split())
    if words < 5:
        print(f"  SKIP empty {title}"); continue
    slug = "dgl-" + slugify(title)
    desc = (b.get("description") or "").strip()
    notes = f"Global Digital Library, reading level {level}. License: {b.get('license',{}).get('name','CC (see GDL)')}. {desc}"
    hdr = (f"# {title}\nSource: https://digitallibrary.io/ceb/books/details/{bid}\n"
           f"Retrieved: {DATE}\nLanguage: Bisaya/Cebuano\nGrade level: GDL L{level}\n\n"
           f"{full}\n\n## Notes\n{notes}\n")
    open(os.path.join(OUT, slug + ".txt"), "w").write(hdr)
    summary.append({"slug": slug, "title": title, "level": level, "words": words})
    print(f"  OK {slug}: {words}w (L{level})")
    time.sleep(0.3)

json.dump(summary, open(os.path.join(RAW, "gdl_summary.json"), "w"), indent=1)
print(f"\nDONE: {len(summary)} books, {sum(s['words'] for s in summary)} words")
