#!/usr/bin/env python3
# ============================================================================
# harvest_opus.py — OPUS monolingual tl/ceb downloads (runs ON the pod; stdlib
# only). Sources verified 2026-08-22 (agent-3 survey; sizes measured from the
# object store). Mono files are sentence-per-line; we chunk consecutive
# sentences into ~2KB pseudo-documents (single sentences are weak CPT signal).
#
# Output: /workspace/corpus/raw/opus-<name>-<lang>/docs.jsonl {"text": ...}
# ============================================================================
import gzip, json, time, urllib.request
from pathlib import Path

RAW = Path("/workspace/corpus/raw")
UA = {"User-Agent": "Mozilla/5.0 (corpus research; hiraia project)"}
CHUNK = 2000      # target chars per pseudo-doc
MIN_CHARS = 50

BASE = "https://object.pouta.csc.fi"
FILES = [
    # tl — the verified big five + small clean supplements
    ("opensubtitles-tl", f"{BASE}/OPUS-OpenSubtitles/v2024/mono/tl.txt.gz"),
    ("ccmatrix-tl",      f"{BASE}/OPUS-CCMatrix/v1/mono/tl.txt.gz"),
    ("ccaligned-tl",     f"{BASE}/OPUS-CCAligned/v1/mono/tl.txt.gz"),
    ("wikimatrix-tl",    f"{BASE}/OPUS-WikiMatrix/v1/mono/tl.txt.gz"),
    ("paracrawl-tl",     f"{BASE}/OPUS-ParaCrawl/v9/mono/tl.txt.gz"),
    ("ted2020-tl",       f"{BASE}/OPUS-TED2020/v1/mono/tl.txt.gz"),
    ("qed-tl",           f"{BASE}/OPUS-QED/v2.0a/mono/tl.txt.gz"),
    ("gnome-tl",         f"{BASE}/OPUS-GNOME/v1/mono/tl.txt.gz"),
    ("ubuntu-tl",        f"{BASE}/OPUS-Ubuntu/v14.10/mono/tl.txt.gz"),
    ("ubuntu-fil",       f"{BASE}/OPUS-Ubuntu/v14.10/mono/fil.txt.gz"),
    ("bible-tl",         f"{BASE}/OPUS-bible-uedin/v1/mono/tl.txt.gz"),
    # ceb — WikiMatrix dominates; rest are small supplements
    ("wikimatrix-ceb",   f"{BASE}/OPUS-WikiMatrix/v1/mono/ceb.txt.gz"),
    ("ccmatrix-ceb",     f"{BASE}/OPUS-CCMatrix/v1/mono/ceb.txt.gz"),
    ("ted2020-ceb",      f"{BASE}/OPUS-TED2020/v1/mono/ceb.txt.gz"),
    ("qed-ceb",          f"{BASE}/OPUS-QED/v2.0a/mono/ceb.txt.gz"),
    ("bible-ceb",        f"{BASE}/OPUS-bible-uedin/v1/mono/ceb.txt.gz"),
]

def harvest(name, url):
    out_dir = RAW / f"opus-{name}"
    out_path = out_dir / "docs.jsonl"
    if out_path.exists():
        print(f"[skip] opus-{name}: docs.jsonl exists", flush=True)
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
    except Exception as e:
        print(f"[fail] opus-{name}: {e}", flush=True)
        return
    docs = bytes_out = lines = 0
    buf, blen = [], 0
    with gzip.open(resp, "rt", encoding="utf-8", errors="replace") as f, \
         open(out_path, "w", encoding="utf-8") as out:
        for line in f:
            line = line.strip()
            if not line:
                continue
            lines += 1
            buf.append(line)
            blen += len(line) + 1
            if blen >= CHUNK:
                text = "\n".join(buf)
                if len(text) >= MIN_CHARS:
                    out.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
                    docs += 1
                    bytes_out += blen
                buf, blen = [], 0
        if buf:
            text = "\n".join(buf)
            if len(text) >= MIN_CHARS:
                out.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
                docs += 1
                bytes_out += blen
    print(f"[done] opus-{name}: {lines} lines -> {docs} docs, {bytes_out/1e6:.1f} MB "
          f"in {round(time.time()-t0)}s", flush=True)

if __name__ == "__main__":
    for name, url in FILES:
        harvest(name, url)
    print("[OPUS ALL DONE]", flush=True)
