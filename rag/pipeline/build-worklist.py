#!/usr/bin/env python3
"""
Phase-1 worklist builder. Enumerates the CONCEPTS the fact bank should cover and
subtracts what's already covered, producing the generation worklist.

Sources of concepts:
  1. The image concept inventory (packages/images/gemini-queue/qc-progress.json) —
     ~2,800 slugs already built for the visual layer; the ready-made spine.
  2. (later) CG-gap topics from the curriculum audit + a kid-curiosity taxonomy.

Coverage is a ROUGH token-overlap estimate (image slugs and fact ids use different
naming), used only to size the gap — exact dedup happens at generation time by id.

Out: rag/pipeline/worklist.jsonl  (one {slug, source, covered_guess} per concept)
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FACTS = os.path.join(ROOT, "rag/bank/science-facts.jsonl")
QC = os.path.join(ROOT, "packages/images/gemini-queue/qc-progress.json")
OUT = os.path.join(ROOT, "rag/pipeline/worklist.jsonl")

STOP = set("the a an of and or to in on for with is are na ng sa ang mga at ay diagram scene".split())
def toks(s):
    return {t for t in re.split(r"[^a-z0-9]+", s.lower()) if len(t) > 2 and t not in STOP}

facts = [json.loads(l) for l in open(FACTS)]
# build a token index of everything we already cover
covered_tokens = []
for f in facts:
    tk = toks(f["id"]) | toks(f.get("topic","")) | set(t.lower() for t in f.get("terms",[]))
    covered_tokens.append(tk)

def is_covered(slug):
    st = toks(slug)
    if not st: return True
    for tk in covered_tokens:
        inter = st & tk
        # "covered" if the slug's distinctive tokens are mostly present in one fact
        if len(inter) >= max(2, len(st) - 1):
            return True
    return False

qc = json.load(open(QC))
slugs = list(qc.keys()) if isinstance(qc, dict) else qc
worklist, covered = [], 0
for s in slugs:
    c = is_covered(s)
    covered += c
    if not c:
        worklist.append({"slug": s, "source": "image-spine", "covered_guess": False})

with open(OUT, "w") as fh:
    for w in worklist:
        fh.write(json.dumps(w, ensure_ascii=False) + "\n")

print(f"existing facts:           {len(facts)}")
print(f"image concept slugs:      {len(slugs)}")
print(f"  ~already covered:       {covered}")
print(f"  uncovered -> worklist:  {len(worklist)}")
print(f"\nProjection toward Phase 1 = 5,000 facts:")
have = len(facts)
from_images = len(worklist)
print(f"  current bank:           {have}")
print(f"  + image-spine concepts: {from_images}  -> {have + from_images}")
gap = 5000 - (have + from_images)
print(f"  remaining to 5,000:     {max(0,gap)}  (from CG-gap topics + kid-curiosity taxonomy)")
print(f"\nwrote {OUT}")
