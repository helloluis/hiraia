#!/usr/bin/env python3
"""feed_ceb_queue.py — keep synth-ceb/queue.jsonl fed while the Ox Alpha free
window lasts. Appends new tl->ceb translation chunks sampled from the local v3
Tagalog final (15M docs), two tiers:
  1. edu  — docs matching pedagogical markers (same filter as build_ceb_queue)
  2. gen  — general Tagalog docs (LID-checked), for volume
Random-offset sampling (file is 5.5GB; full scans are slow). Skips v3 line
indices already used by the original queue. Idempotent: only adds when the
un-attempted remainder drops below --min-remaining.
"""
import argparse, json, os, random, re
from pathlib import Path

OUT = Path(os.environ.get("SYNTH_CEB_DIR", "/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb"))
CPT = Path(os.environ.get("SYNTH_CPT_DIR", "/Users/luis/Code/hiraia/finetuning/cpt"))
V3 = Path(os.environ.get("SYNTH_V3", str(CPT / "local-v3-run/final_tl_v3.jsonl")))
QUEUE = OUT / "queue.jsonl"
AUDIT = OUT / "docs_ceb_all.jsonl"
MAX_CHUNK = 3500
EDU_MARKERS = re.compile(r"Modyul|Baitang|Gawain|Araling|Basahin|Isulat|Markahan|Paaralan", re.I)

def chunks(text):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out, buf, blen = [], [], 0
    for p in paras:
        if blen + len(p) > MAX_CHUNK and buf:
            out.append("\n\n".join(buf))
            buf, blen = [], 0
        if len(p) > MAX_CHUNK:
            for i in range(0, len(p), MAX_CHUNK):
                out.append(p[i:i + MAX_CHUNK])
            continue
        buf.append(p)
        blen += len(p) + 2
    if buf:
        out.append("\n\n".join(buf))
    return [c for c in out if len(c) >= 200]

def load_src_ids(path):
    ids = set()
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    ids.add(json.loads(line)["src_id"])
                except Exception:
                    pass
    return ids

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-remaining", type=int, default=1500)
    ap.add_argument("--add", type=int, default=6000)
    ap.add_argument("--edu-share", type=float, default=0.5)
    args = ap.parse_args()

    queued = load_src_ids(QUEUE)
    attempted = load_src_ids(AUDIT)
    remaining = len(queued - attempted)
    print(f"[feed] queued={len(queued)} attempted={len(attempted)} "
          f"remaining={remaining}", flush=True)
    if remaining >= args.min_remaining:
        print("[feed] above threshold, nothing to do", flush=True)
        return

    # v3 line indices already consumed by the original queue (v3edu:v3-<i>:<k>)
    used_lines = set()
    for sid in queued:
        m = re.match(r"v3edu:v3-(\d+):", sid)
        if m:
            used_lines.add(int(m.group(1)))

    import fasttext
    fasttext.FastText.eprint = lambda *a, **k: None
    lid = fasttext.load_model(os.environ.get("LID_MODEL", "/tmp/sailcraft-local/lm_resource/lid.176.bin"))

    def is_tl(t):
        return lid.predict(t.replace("\n", " ")[:1500])[0][0].replace(
            "__label__", "") in ("tl", "fil")

    rng = random.Random()
    fsize = os.path.getsize(V3)
    want_edu = int(args.add * args.edu_share)
    new_items, seen_lines = [], set(used_lines)
    stats = {"seek": 0, "parse_err": 0, "len_skip": 0, "dup": 0, "not_tl": 0}

    def sample_docs(n_want, edu_only):
        got = 0
        while got < n_want and stats["seek"] < n_want * 60:
            stats["seek"] += 1
            with open(V3, "rb") as f:
                f.seek(rng.randrange(fsize))
                f.readline()                    # discard partial line
                bpos = f.tell()
                raw = f.readline()
            if not raw:
                continue
            try:
                t = json.loads(raw)["text"]
            except Exception:
                stats["parse_err"] += 1
                continue
            if bpos in seen_lines:
                stats["dup"] += 1
                continue
            if not (400 <= len(t) <= 12000):
                stats["len_skip"] += 1
                continue
            if edu_only and not EDU_MARKERS.search(t):
                continue
            if not edu_only and not is_tl(t[:1500]):
                stats["not_tl"] += 1
                continue
            seen_lines.add(bpos)
            new_items.append(("v3xedu" if edu_only else "v3xgen", bpos, t))
            got += 1

    sample_docs(want_edu, True)
    n_edu = len(new_items)
    sample_docs(args.add - n_edu, False)
    print(f"[feed] sampled edu={n_edu} gen={len(new_items) - n_edu} "
          f"stats={stats}", flush=True)

    n = 0
    with open(QUEUE, "a", encoding="utf-8") as q:
        for src, pos, text in new_items:
            for k, c in enumerate(chunks(text)):
                sid = f"{src}:{pos}:{k}"
                if sid in queued:
                    continue
                q.write(json.dumps({"text": c, "src": src, "src_id": sid},
                                   ensure_ascii=False) + "\n")
                n += 1
    print(f"[feed] appended {n} chunks -> {QUEUE}", flush=True)

if __name__ == "__main__":
    main()
