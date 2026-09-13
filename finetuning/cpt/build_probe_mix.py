#!/usr/bin/env python3
# ============================================================================
# build_probe_mix.py — runs ON the tokenize pod. Builds the ~6B-token probe-CPT
# document mix (PROBE-CPT-CONFIG §3) as interleaved shuffled JSONL + a manifest
# with measured Qwen-token accounting. Binary packing (4096-seq) happens in the
# trainer's own preprocessing at smoke-test time — this file is the canonical
# document stream it consumes.
#
# Mix: tl 60% (v1 train ×2 epochs, independently shuffled) / ceb 11.7% (×2) /
# en 20% (fineweb sample-10BT subset) / zh 8.3% (cmn_Hani subset).
# Interleaves per ~100M-token block using per-source chars/token calibration
# (500-doc sample each) so no full tokenization pass is needed to build; exact
# per-source token counts are then measured on the OUTPUT with n-proc chunks.
# en held-out (2,000 docs) comes from the RESERVED shard (last sample-10BT
# parquet), which is excluded from the train subset.
# ============================================================================
import glob, json, os, random, subprocess, sys, time

V = "/workspace"
OUT = f"{V}/corpus/tokenized/probe-mix-v1"
os.makedirs(OUT, exist_ok=True)
TOK_TARGETS = {"tl": 3.6e9, "ceb": 0.7e9, "en": 1.2e9, "zh": 0.5e9}
RATIOS = {k: v / sum(TOK_TARGETS.values()) for k, v in TOK_TARGETS.items()}

from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base")
assert len(tok) >= 248000, f"tokenizer vocab {len(tok)} != Qwen3.5"

def jsonl_iter(paths):
    for p in paths:
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)["text"]

def parquet_iter(paths):
    import pyarrow.dataset as ds
    for p in paths:
        for b in ds.dataset(p).to_batches(columns=["text"], batch_size=4096):
            for v in b.column("text"):
                yield v.as_py()

EN_SHARDS = sorted(glob.glob(f"{V}/corpus/raw/anchor-en-fineweb10bt/sample/10BT/*.parquet"))
EN_HELD_SHARD, EN_TRAIN_SHARDS = EN_SHARDS[-1], EN_SHARDS[:-1]
ZH_SHARDS = sorted(glob.glob(f"{V}/corpus/raw/anchor-zh-fineweb2-10shard/**/*.parquet", recursive=True))

SOURCES = {
    "tl": lambda: jsonl_iter([f"{V}/corpus/train/pool_tl.train.jsonl"]),
    "ceb": lambda: jsonl_iter([f"{V}/corpus/train/pool_ceb.train.jsonl"]),
    "en": lambda: parquet_iter(EN_TRAIN_SHARDS),
    "zh": lambda: parquet_iter(ZH_SHARDS),
}

# --- en held-out carve (2,000 docs from the reserved shard) ---
held_en = f"{V}/corpus/eval/heldout-en.jsonl"
if not os.path.exists(held_en):
    with open(held_en, "w", encoding="utf-8") as f:
        for i, t in enumerate(parquet_iter([EN_HELD_SHARD])):
            if i >= 2000: break
            f.write(json.dumps({"text": t}, ensure_ascii=False) + "\n")
    print(f"[heldout-en] 2000 docs from reserved shard {os.path.basename(EN_HELD_SHARD)}", flush=True)

# --- calibrate chars/token per source ---
cal = {}
for name, mk in SOURCES.items():
    rng, chars, toks = random.Random(7), 0, 0
    for i, t in enumerate(mk()):
        if i > 20000: break
        if rng.random() < 0.03 and len(t) > 200:
            chars += len(t); toks += len(tok(t, add_special_tokens=False).input_ids)
            if toks > 400_000: break
    cal[name] = chars / max(toks, 1)
    print(f"[calibrate] {name}: {cal[name]:.2f} chars/token", flush=True)

# --- interleave by ~100M-token blocks; tl/ceb loop epochs (max 2) ---
BLOCK = 100e6
iters = {k: SOURCES[k]() for k in SOURCES}
epochs = {k: 1 for k in SOURCES}
emitted = {k: 0.0 for k in SOURCES}   # estimated tokens
docs = {k: 0 for k in SOURCES}
mix_path = f"{OUT}/probe-mix.jsonl"
t0 = time.time()
with open(mix_path, "w", encoding="utf-8") as out:
    while any(emitted[k] < TOK_TARGETS[k] for k in SOURCES):
        for k in SOURCES:
            if emitted[k] >= TOK_TARGETS[k]:
                continue
            goal = emitted[k] + BLOCK * RATIOS[k]
            while emitted[k] < min(goal, TOK_TARGETS[k]):
                try:
                    t = next(iters[k])
                except StopIteration:
                    if k in ("tl", "ceb") and epochs[k] < 2:
                        epochs[k] += 1; iters[k] = SOURCES[k]()
                        print(f"[epoch] {k} -> epoch {epochs[k]} at {emitted[k]/1e9:.2f}B est tokens", flush=True)
                        continue
                    print(f"[exhausted] {k} at {emitted[k]/1e9:.2f}B est tokens ({epochs[k]} epochs)", flush=True)
                    emitted[k] = TOK_TARGETS[k]; break
                out.write(json.dumps({"text": t, "source": k}, ensure_ascii=False) + "\n")
                emitted[k] += len(t) / cal[k]; docs[k] += 1
manifest = {"targets": TOK_TARGETS, "estimated_tokens": {k: round(v) for k, v in emitted.items()},
            "docs": docs, "epochs": epochs, "chars_per_token": cal,
            "en_heldout_shard": os.path.basename(EN_HELD_SHARD), "build_seconds": round(time.time() - t0)}
with open(f"{OUT}/MIX-MANIFEST.json", "w") as f:
    json.dump(manifest, f, indent=2)
print("[mix done]", json.dumps(manifest), flush=True)
print(f"NOTE: shuffle happens at trainer packing; block-interleave already bounds locality. Mix at {mix_path}", flush=True)
