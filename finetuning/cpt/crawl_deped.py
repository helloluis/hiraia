#!/usr/bin/env python3
# ============================================================================
# crawl_deped.py — crawl the DepEd LR Portal Google Site (SDO Muntinlupa,
# sites.google.com/deped.gov.ph/deped-lrportal), download every linked Drive
# PDF, extract text with pdftotext (poppler), emit JSONL. Runs ON the pod.
#
# Validated 2026-08-22: leaf pages embed files as drive.google.com/{open,uc,
# thumbnail}?id=<ID> (177 unique IDs on the grade-3 AP page); direct download
# via drive.google.com/uc?export=download&id=<ID>[&confirm=t]; PDFs are
# ~90-95% born-digital (agent-6 scoping + local pdftotext sample).
# Live run note: the site links ~26k unique Drive IDs (not the estimated
# 4-10k) and ~97% resolve to real text-bearing PDFs — the download phase is
# parallelized (ThreadPoolExecutor) after the sequential pass projected ~16h.
#
# LRMDS (lrmds.deped.gov.ph) is deliberately NOT crawled here: its download
# button is JS/session-gated (probed 2026-08-22 — no direct file URL in the
# detail page HTML). Bisaya DepEd content lives mostly there; documented gap.
#
# Output: /workspace/corpus/raw/deped-lrportal/docs.jsonl
#   {"text": ..., "drive_id": ..., "source_page": ...}
# Resumable: crawled page map + processed IDs are tracked in state.json.
# ============================================================================
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SITE = "https://sites.google.com"
ROOT = "/deped.gov.ph/deped-lrportal"
OUT = Path("/workspace/corpus/raw/deped-lrportal")
PDF_DIR = OUT / "pdfs"
STATE = OUT / "state.json"
MAX_PAGES = 800
PAGE_DELAY = 0.25
DL_DELAY = 0.05
WORKERS = 12  # parallel Drive downloads — sequential was ~27 ids/min (~16h for 26k)
MIN_CHARS = 200  # a real module has far more; this trims covers/thumbnails-only PDFs
UA = {"User-Agent": "Mozilla/5.0 (corpus research; hiraia project)"}

PAGE_RE = re.compile(r'(?:href="|url\()\s*(?:https://sites\.google\.com)?('
                     + re.escape(ROOT) + r'[^"\\\s)\?#]*)')
ID_RE = re.compile(r'drive\.google\.com/(?:open|uc|thumbnail|file/d/)[\?/]?[a-z=&;]*?'
                   r'([-\w]{25,})')

def fetch(url, binary=False, retries=3):
    for i in range(retries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90)
            data = r.read()
            return data if binary else data.decode("utf-8", "ignore")
        except Exception as e:
            if i == retries - 1:
                print(f"[fetch-fail] {url}: {e}", flush=True)
                return None
            time.sleep(2 * (i + 1))

def crawl_pages():
    """BFS the site; return {page_path: set(drive_ids)}."""
    todo = deque([ROOT + "/"])
    seen = set()
    page_ids = {}
    while todo and len(seen) < MAX_PAGES:
        path = todo.popleft()
        path = path.rstrip("/") or ROOT
        if path in seen:
            continue
        seen.add(path)
        html = fetch(SITE + path)
        if html is None:
            continue
        for m in PAGE_RE.finditer(html):
            p = m.group(1).rstrip("/")
            if p not in seen and not p.endswith((".pdf", ".jpg", ".png")):
                todo.append(p)
        ids = set(ID_RE.findall(html))
        if ids:
            page_ids[path] = sorted(ids)
        if len(seen) % 25 == 0:
            print(f"[crawl] pages={len(seen)} queue={len(todo)} ids={sum(map(len, page_ids.values()))}", flush=True)
        time.sleep(PAGE_DELAY)
    return page_ids

def download(drive_id):
    dest = PDF_DIR / f"{drive_id}.pdf"
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm=t"
    data = fetch(url, binary=True)
    if not data or not data[:5] == b"%PDF-":
        return None
    dest.write_bytes(data)
    time.sleep(DL_DELAY)
    return dest

def extract(pdf_path):
    try:
        r = subprocess.run(["pdftotext", "-enc", "UTF-8", str(pdf_path), "-"],
                           capture_output=True, timeout=120)
        if r.returncode == 0:
            return r.stdout.decode("utf-8", "replace")
    except Exception:
        pass
    return None

def process_one(did):
    """Worker: download + extract one Drive ID. Returns (did, text_or_None, status)."""
    pdf = download(did)
    if pdf is None:
        return (did, None, "failed")
    text = extract(pdf)
    if not text or len(text.strip()) < MIN_CHARS:
        return (did, None, "skipped")
    return (did, text.strip(), "kept")

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(exist_ok=True)
    state = json.loads(STATE.read_text()) if STATE.exists() else {"pages": None, "done_ids": []}
    done = set(state["done_ids"])

    if state["pages"] is None:
        print("[crawl] mapping site ...", flush=True)
        page_ids = crawl_pages()
        state["pages"] = {k: v for k, v in page_ids.items()}
        STATE.write_text(json.dumps(state))
    else:
        page_ids = state["pages"]
    all_ids = sorted({i for ids in page_ids.values() for i in ids})
    id2page = {i: p for p, ids in page_ids.items() for i in ids}
    print(f"[crawl] {len(page_ids)} pages with files, {len(all_ids)} unique Drive IDs", flush=True)

    remaining = [d for d in all_ids if d not in done]
    print(f"[deped] {len(remaining)} IDs to fetch ({len(done)} already done), {WORKERS} workers", flush=True)
    out_path = OUT / "docs.jsonl"
    kept = failed = skipped = 0
    mode = "a" if out_path.exists() else "w"
    with open(out_path, mode, encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for n, (did, text, status) in enumerate(ex.map(process_one, remaining)):
                if status == "kept":
                    out.write(json.dumps({"text": text, "drive_id": did,
                                          "source_page": id2page.get(did, "")},
                                         ensure_ascii=False) + "\n")
                    kept += 1
                elif status == "failed":
                    failed += 1
                else:
                    skipped += 1
                done.add(did)
                if (n + 1) % 200 == 0:
                    out.flush()
                    state["done_ids"] = sorted(done)
                    STATE.write_text(json.dumps(state))
                    print(f"[deped] {n+1}/{len(remaining)} kept={kept} failed={failed} skipped={skipped}", flush=True)
    state["done_ids"] = sorted(done)
    STATE.write_text(json.dumps(state))
    stats = {"drive_ids": len(all_ids), "kept": kept, "failed_download": failed,
             "skipped_short_or_no_text": skipped}
    (OUT / "CRAWL-STATS.json").write_text(json.dumps(stats, indent=2))
    print(f"[deped DONE] {stats}", flush=True)

if __name__ == "__main__":
    main()
