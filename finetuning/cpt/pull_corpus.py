#!/usr/bin/env python3
# ============================================================================
# pull_corpus.py — one-shot, resumable CPT corpus pull onto the RunPod network
# volume (runs ON the pod; /workspace = volume hiraia-cpt-corpus, US-NE-1).
#
# Pull-once guarantees:
#   - snapshot_download(local_dir=...) is idempotent: complete files are skipped,
#     partial files resume (hf_xet >= 1.5.2 fixed the June stall bug).
#   - Every source records its resolved repo revision + byte/file counts in
#     /workspace/corpus/raw/MANIFEST.json — re-pulls pin to the SAME revision,
#     so the corpus can't silently drift between pulls.
#   - Scarce/critical sources (Cebuano, CulturaX) download first.
#
# Sources per CPT-FLAGSHIP-PLAN.md §0/§5: FineWeb-2 fil_Latn+ceb_Latn (core),
# MADLAD-400 fil+ceb (Tagalog = `fil` folder, NOT `tl` — §5b-B gotcha),
# CulturaX tl+ceb (gated; token via HF_TOKEN), anchors = fineweb sample-10BT (en)
# + a BOUNDED 10-shard cmn_Hani slice (zh) — anchor is ~25% of the mix, we do
# not need all of cmn_Hani. OPUS/BloomLibrary are separate harvest paths, not here.
# ============================================================================
import json, os, sys, shutil, time
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

RAW = Path("/workspace/corpus/raw")
MANIFEST = RAW / "MANIFEST.json"
MIN_FREE_GB = 30

SOURCES = [
    # (name, repo_id, allow_patterns)  — scarce ceb first, big anchors last
    ("fineweb2-ceb",   "HuggingFaceFW/fineweb-2", ["data/ceb_Latn/*"]),
    ("madlad-ceb",     "allenai/MADLAD-400",      ["data/ceb/*"]),
    ("culturax-ceb",   "uonlp/CulturaX",          ["ceb/*"]),
    ("culturax-tl",    "uonlp/CulturaX",          ["tl/*"]),
    ("fineweb2-fil",   "HuggingFaceFW/fineweb-2", ["data/fil_Latn/*"]),
    ("madlad-fil",     "allenai/MADLAD-400",      ["data/fil/*"]),
    ("anchor-en-fineweb10bt", "HuggingFaceFW/fineweb", ["sample/10BT/*"]),
    # bounded zh anchor: 10 shards only (000_00000..000_00009) — logged cap, extend later if the mix needs more
    ("anchor-zh-fineweb2-10shard", "HuggingFaceFW/fineweb-2", ["data/cmn_Hani/train/000_0000*.parquet"]),
]

def free_gb(p: Path) -> float:
    return shutil.disk_usage(p).free / 1e9

def dir_stats(p: Path):
    files = [f for f in p.rglob("*") if f.is_file() and ".cache" not in f.parts]
    return len(files), sum(f.stat().st_size for f in files)

def main():
    api = HfApi()
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    for name, repo, patterns in SOURCES:
        entry = manifest.get(name, {})
        if entry.get("complete"):
            print(f"[skip] {name}: already complete @ {entry['revision'][:12]} "
                  f"({entry['files']} files, {entry['bytes']/1e9:.2f} GB)", flush=True)
            continue
        if free_gb(RAW) < MIN_FREE_GB:
            sys.exit(f"ABORT before {name}: <{MIN_FREE_GB} GB free on volume — grow it, then re-run.")
        # pin: reuse the revision from an earlier partial pull, else resolve main NOW and freeze it
        rev = entry.get("revision") or api.repo_info(repo, repo_type="dataset").sha
        dest = RAW / name
        print(f"[pull] {name}: {repo}@{rev[:12]} patterns={patterns} -> {dest}", flush=True)
        t0 = time.time()
        manifest[name] = {"repo": repo, "revision": rev, "patterns": patterns, "complete": False}
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        snapshot_download(repo_id=repo, repo_type="dataset", revision=rev,
                          allow_patterns=patterns, local_dir=dest,
                          token=os.environ.get("HF_TOKEN"), max_workers=12)
        n, b = dir_stats(dest)
        manifest[name].update(complete=True, files=n, bytes=b,
                              seconds=round(time.time() - t0),
                              finished_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        print(f"[done] {name}: {n} files, {b/1e9:.2f} GB in {round(time.time()-t0)}s "
              f"(volume free: {free_gb(RAW):.0f} GB)", flush=True)
    total = sum(e.get("bytes", 0) for e in manifest.values())
    print(f"[ALL DONE] {len(manifest)} sources, {total/1e9:.2f} GB total. Manifest: {MANIFEST}", flush=True)

if __name__ == "__main__":
    main()
