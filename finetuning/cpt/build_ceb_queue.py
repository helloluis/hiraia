#!/usr/bin/env python3
"""Build the tl->ceb translation queue for gen_ceb_ox.py.
Sources: LRMDS Filipino docs, LRMDS science docs, v3-final DepEd-style samples.
Queue items are ~<=3,500-char chunks (paragraph-packed). LID-filtered to tl."""
import json, random, re
from pathlib import Path

OUT = Path("/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb")
OUT.mkdir(exist_ok=True)
CPT = Path("/Users/luis/Code/hiraia/finetuning/cpt")
MAX_CHUNK = 3500
V3_SAMPLE = 3400          # educational docs sampled from the v3 tl final
EDU_MARKERS = re.compile(r"Modyul|Baitang|Gawain|Araling|Basahin|Isulat|Markahan|Paaralan", re.I)

def chunks(text):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out, buf, blen = [], [], 0
    for p in paras:
        if blen + len(p) > MAX_CHUNK and buf:
            out.append("\n\n".join(buf))
            buf, blen = [], 0
        if len(p) > MAX_CHUNK:      # single long para: hard-split on sentences
            for i in range(0, len(p), MAX_CHUNK):
                out.append(p[i:i + MAX_CHUNK])
            continue
        buf.append(p)
        blen += len(p) + 2
    if buf:
        out.append("\n\n".join(buf))
    return [c for c in out if len(c) >= 200]

def main():
    import fasttext
    fasttext.FastText.eprint = lambda *a, **k: None
    lid = fasttext.load_model("/tmp/sailcraft-local/lm_resource/lid.176.bin")

    def is_tl(t):
        lang, conf = lid.predict(t.replace("\n", " ")[:1500])[0][0].replace("__label__", ""), None
        return lang in ("tl", "fil")

    items = []
    # 1. LRMDS language harvest (Filipino-medium docs only)
    for line in open(CPT / "../reference-materials/lrmds/docs.jsonl", encoding="utf-8"):
        d = json.loads(line)
        if is_tl(d["text"][:1500]):
            items.append(("lrmds", d["lrmds_id"], d["text"]))
    print("lrmds tl docs:", len(items), flush=True)
    # 2. science set (tl only)
    n0 = len(items)
    for line in open(CPT / "../reference-materials/science/docs.jsonl", encoding="utf-8"):
        d = json.loads(line)
        if is_tl(d["text"][:1500]):
            items.append(("science", d["lrmds_id"], d["text"]))
    print("science tl docs:", len(items) - n0, flush=True)
    # 3. v3 final: sample educational-looking docs
    rng = random.Random(11)
    edu = []
    with open(CPT / "local-v3-run/final_tl_v3.jsonl", encoding="utf-8") as f:
        for i, line in enumerate(f):
            d = json.loads(line)
            t = d["text"]
            if 400 <= len(t) <= 12000 and EDU_MARKERS.search(t):
                # reservoir sample
                if len(edu) < V3_SAMPLE:
                    edu.append((f"v3-{i}", t))
                else:
                    j = rng.randint(0, i)
                    if j < V3_SAMPLE:
                        edu[j] = (f"v3-{i}", t)
    print("v3 edu docs sampled:", len(edu), flush=True)
    items += [("v3edu", sid, t) for sid, t in edu]

    n = 0
    with open(OUT / "queue.jsonl", "w", encoding="utf-8") as q:
        for src, sid, text in items:
            for k, c in enumerate(chunks(text)):
                q.write(json.dumps({"text": c, "src": src, "src_id": f"{src}:{sid}:{k}"},
                                   ensure_ascii=False) + "\n")
                n += 1
    print(f"[queue] {n} chunks from {len(items)} docs -> {OUT/'queue.jsonl'}", flush=True)

if __name__ == "__main__":
    main()
