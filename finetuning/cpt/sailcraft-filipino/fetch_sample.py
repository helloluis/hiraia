#!/usr/bin/env python3
"""Pull a small tl + ceb corpus sample into SailCraft's input dir as JSONL {"text": ...}.

Default source is MADLAD-400 v1.5 (ungated, open) because CulturaX is GATED:
even a valid HF token 403s until the account is on the authorized list (a manual,
one-click web step at https://huggingface.co/datasets/uonlp/CulturaX). MADLAD-400
is a primary source named in CPT-FLAGSHIP-PLAN.md §5 and needs no gate approval.

NOTE on language codes:
  - Tagalog is the `fil` folder in MADLAD-400 (NOT `tl`); Cebuano is `ceb`.
  - SailCraft still uses `tl` / `ceb` as its internal language ids (fastText
    lid.176 emits __label__tl / __label__ceb), so the data sources from MADLAD
    `fil`/`ceb` but is cleaned with the `tl`/`ceb` SailCraft configs.

If/when CulturaX access is granted, set --source culturax (reads the per-language
parquet shard directly, bypassing the gated dataset-loading-script 403).

Usage:
    HF_TOKEN=hf_... python fetch_sample.py --n 3000 --out_dir /tmp/sailcraft-run/data/data_input
"""
import argparse
import gzip
import itertools
import json
import os


def fetch_madlad(lang_folder, n, out, token):
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi(token=token)
    files = api.list_repo_files("allenai/madlad-400", repo_type="dataset")
    shards = sorted(f for f in files
                    if f.startswith(f"data-v1p5/{lang_folder}/") and "clean" in f)
    path = hf_hub_download("allenai/madlad-400", shards[0], repo_type="dataset",
                           token=token, cache_dir="/tmp/hf_cache_madlad")
    n_written = 0
    with gzip.open(path, "rt", encoding="utf-8") as fi, open(out, "w") as fo:
        for line in fi:
            fo.write(json.dumps({"text": json.loads(line)["text"]}, ensure_ascii=False) + "\n")
            n_written += 1
            if n_written >= n:
                break
    return n_written


def fetch_culturax(lang, n, out, token):
    # CulturaX: read the per-language parquet shard directly (gated content needs
    # the account on the authorized list, else 403). Avoids the loading-script path.
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    path = hf_hub_download("uonlp/CulturaX", f"{lang}/{lang}_part_00000.parquet",
                           repo_type="dataset", token=token, cache_dir="/tmp/hf_cache_culturax")
    n_written = 0
    pf = pq.ParquetFile(path)
    with open(out, "w") as fo:
        for batch in pf.iter_batches(batch_size=1000, columns=["text"]):
            for txt in batch.column("text").to_pylist():
                fo.write(json.dumps({"text": txt}, ensure_ascii=False) + "\n")
                n_written += 1
                if n_written >= n:
                    return n_written
    return n_written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000)
    ap.add_argument("--source", choices=["madlad", "culturax"], default="madlad")
    ap.add_argument("--out_dir", default="data/data_input")
    args = ap.parse_args()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY")
    os.makedirs(args.out_dir, exist_ok=True)

    # (SailCraft id, MADLAD folder, alias)
    langs = [("tl", "fil", "madlad_tl"), ("ceb", "ceb", "madlad_ceb")]
    for sail_id, madlad_folder, alias in langs:
        out = os.path.join(args.out_dir, f"{alias}.jsonl")
        if args.source == "madlad":
            n = fetch_madlad(madlad_folder, args.n, out, token)
        else:
            n = fetch_culturax(sail_id, args.n, out, token)
        print(f"{sail_id}: wrote {n} docs -> {out}")


if __name__ == "__main__":
    main()
