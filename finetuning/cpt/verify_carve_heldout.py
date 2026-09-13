#!/usr/bin/env python3
# ============================================================================
# verify_carve_heldout.py — runs ON the tokenize pod (v1 volume at /workspace).
# 1. VERIFY the cleaned finals: full-line JSON parse of head/tail + 1,000 random
#    lines per pool (the 08-22 morning "corruption" was a truncated-head check —
#    this is the real one).
# 2. CARVE held-out eval sets (PROBE-CPT-CONFIG §3): 5,000 docs each tl/ceb,
#    seeded, single pass → corpus/eval/heldout-{tl,ceb}.jsonl + train remainders
#    → corpus/train/pool_{tl,ceb}.train.jsonl. Held-outs are never trained on.
# (en held-out is carved by build_probe_mix.py from the reserved anchor shard.)
# ============================================================================
import json, os, random, sys

V = "/workspace"
FINALS = {
    "tl": (f"{V}/sailcraft-run/data/data_output/final_output/pool_tl/data_clean.jsonl", 5000),
    "ceb": (f"{V}/sailcraft-run/data/data_output/final_output/pool_ceb/data_clean.jsonl", 5000),
}
EVAL_DIR, TRAIN_DIR = f"{V}/corpus/eval", f"{V}/corpus/train"
os.makedirs(EVAL_DIR, exist_ok=True); os.makedirs(TRAIN_DIR, exist_ok=True)

def parse_or_die(line, ctx):
    d = json.loads(line)
    assert isinstance(d.get("text"), str) and d["text"], f"bad text field @ {ctx}"
    return d

for lang, (path, n_held) in FINALS.items():
    # pass 1: count + verify head/tail/sample
    total = 0
    with open(path, encoding="utf-8") as f:
        for total, line in enumerate(f, 1):
            if total <= 3:
                parse_or_die(line, f"{lang} head {total}")
    last = line
    parse_or_die(last, f"{lang} tail")
    rng = random.Random(42)
    sample_idx = set(rng.sample(range(1, total + 1), 1000))
    held_idx = set(rng.sample(range(1, total + 1), n_held))
    held_path = f"{EVAL_DIR}/heldout-{lang}.jsonl"
    train_path = f"{TRAIN_DIR}/pool_{lang}.train.jsonl"
    n_h = n_t = checked = 0
    with open(path, encoding="utf-8") as f, \
         open(held_path, "w", encoding="utf-8") as fh, \
         open(train_path, "w", encoding="utf-8") as ft:
        for i, line in enumerate(f, 1):
            if i in sample_idx:
                parse_or_die(line, f"{lang} sample {i}"); checked += 1
            if i in held_idx:
                fh.write(line); n_h += 1
            else:
                ft.write(line); n_t += 1
    print(f"[{lang}] VERIFIED {total} lines (head/tail + {checked} random parses OK) "
          f"-> heldout {n_h} @ {held_path}, train {n_t} @ {train_path}", flush=True)
print("[verify_carve] ALL OK")
