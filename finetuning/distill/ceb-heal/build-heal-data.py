#!/usr/bin/env python3
"""
build-heal-data.py — assemble the heal corpus token stream for the pruned 2.4B.

Mix (token-budgeted): Cebuano core (local, upsampled) + Tagalog (FineWeb-2 fil_Latn, streamed)
+ English anchor (FineWeb sample-10BT, streamed). Tokenizes with Sailor2's tokenizer, separates
docs with EOS, writes tokens INCREMENTALLY to a flat uint32 .bin (no giant in-RAM list — the
full ~1.8B-token run would OOM otherwise). train-heal.py memmaps the .bin into 2048-windows.

AUP: reads the ceb core (body-science) but only tokenizes it; emits counts, never text.

Usage:
  python build-heal-data.py --ceb out/ceb-pilot-core.jsonl --tokenizer sail/Sailor2-3B \
     --total-tokens 1800000000 --ratios 0.20,0.35,0.45 --out heal-tokens.bin
"""
import argparse, json, random, numpy as np
from transformers import AutoTokenizer
from datasets import load_dataset

ap = argparse.ArgumentParser()
ap.add_argument("--ceb", required=True)
ap.add_argument("--tokenizer", default="sail/Sailor2-3B")
ap.add_argument("--total-tokens", type=int, default=1_800_000_000)
ap.add_argument("--ratios", default="0.20,0.35,0.45", help="ceb,tl,en")
ap.add_argument("--out", default="heal-tokens.bin")
ap.add_argument("--seed", type=int, default=7)
args = ap.parse_args()

rng = random.Random(args.seed)
tok = AutoTokenizer.from_pretrained(args.tokenizer)
EOS = tok.eos_token_id if tok.eos_token_id is not None else tok.convert_tokens_to_ids("<|endoftext|>")
r_ceb, r_tl, r_en = (float(x) for x in args.ratios.split(","))
q_ceb = int(args.total_tokens * r_ceb); q_tl = int(args.total_tokens * r_tl); q_en = int(args.total_tokens * r_en)
print(f">> quotas: ceb={q_ceb/1e6:.0f}M tl={q_tl/1e6:.0f}M en={q_en/1e6:.0f}M (eos={EOS})", flush=True)

fout = open(args.out, "wb")

def add_until(text_iter, quota, tag):
    got = 0
    for t in text_iter:
        if not t:
            continue
        ids = tok(t, add_special_tokens=False).input_ids
        if not ids:
            continue
        ids.append(EOS)
        fout.write(np.asarray(ids, dtype=np.uint32).tobytes())
        got += len(ids)
        if got >= quota:
            break
    print(f">> {tag}: {got/1e6:.1f}M tokens", flush=True)
    return got

# CEB — local, repeat-shuffle to hit quota (upsample)
ceb_texts = [json.loads(l)["text"] for l in open(args.ceb) if l.strip()]
print(f">> ceb pool: {len(ceb_texts)} docs", flush=True)
def ceb_iter():
    while True:
        rng.shuffle(ceb_texts)
        for t in ceb_texts:
            yield t
n_ceb = add_until(ceb_iter(), q_ceb, "ceb")

# TL — FineWeb-2 Tagalog/Filipino (streamed)
tl_ds = load_dataset("HuggingFaceFW/fineweb-2", name="fil_Latn", split="train", streaming=True)
n_tl = add_until((x.get("text") for x in tl_ds), q_tl, "tl")

# EN — FineWeb 10BT sample (streamed)
en_ds = load_dataset("HuggingFaceFW/fineweb", name="sample-10BT", split="train", streaming=True)
n_en = add_until((x.get("text") for x in en_ds), q_en, "en")

fout.close()
total = n_ceb + n_tl + n_en
print(json.dumps({"total_tokens": int(total), "out": args.out, "seqs_2048": int(total // 2048),
                  "ceb": n_ceb, "tl": n_tl, "en": n_en}), flush=True)
print(">> BUILD-DATA DONE", flush=True)
