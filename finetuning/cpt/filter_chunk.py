#!/usr/bin/env python3
# Parallel-bypass worker for SailCraft stage-1 filtering: applies the SAME
# FunctionDatasetFiltering as datasets.map would, over one line-chunk of a pool.
# Use when datasets.map machinery misbehaves (2026-08-21: 208 workers on a
# 22-core cgroup quota collapsed the shared-progress-lock path ~100×; this
# lock-free pattern tolerates oversubscription). Drive with:
#   split -n l/200 pool.jsonl chunks/c
#   ls chunks | xargs -P <quota> -I{} .venv/bin/python filter_chunk.py \
#       chunks/{} kept/{}.jsonl reasons/{}.json <lang_id>
import sys, json

sys.path.insert(0, "/workspace/sailcraft-run/code/data_cleaning")
import filtering as F

chunk_in, out_kept, out_reasons = sys.argv[1:4]
lang_id = sys.argv[4] if len(sys.argv) > 4 else "tl"
func = F.FunctionDatasetFiltering(
    lang_id, "/workspace/sailcraft-run/lm_resource/lid.176.bin", "", "")
reasons = {}
kept = total = 0
with open(chunk_in) as fi, open(out_kept, "w") as fo:
    for line in fi:
        total += 1
        try:
            ex = json.loads(line)
        except json.JSONDecodeError:
            continue
        keep, reason = func(ex)
        if keep:
            fo.write(json.dumps({"text": ex["text"]}, ensure_ascii=False) + "\n")
            kept += 1
        else:
            reasons[reason] = reasons.get(reason, 0) + 1
with open(out_reasons, "w") as fr:
    json.dump({"total": total, "kept": kept, "reasons": reasons}, fr)
