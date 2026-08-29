#!/usr/bin/env python3
# ============================================================================
# pull_corpus_v3.py — corpus-v3 pull onto the EXPANSION volume (runs ON the
# pod; /workspace = hiraia-cpt-expansion 6er6skgoyb).
#
# v3 scope (research run 2026-08-22, agent-4 + manual verification):
#   DCAD-2000 (openbmb, CC BY 4.0, ungated) — per-source keep/remove slices:
#     fil_Latn: mala_*_keep (23.65GB) + fineweb-2_*_remove (2.33GB; FW2's own
#               rejects, quality-scored — SailCraft judges)
#     ceb_Latn: mala_*_keep (13.39GB) + new_cc_*_keep (0.09GB)
#               (ceb fw2 keep = repackaged v1 data — skipped)
#   Docs carry quality fields (lang_id_score, perplexity_score, ...) — used as
#   pre-filters in prep_pools_v3.py (anti-Lsjbot for ceb).
#   NOT pulled: mala remove slices (DCAD's rejects), new_cc (fil: absent).
# OPUS + DepEd are separate harvest paths (harvest_opus.py / crawl_deped.py).
# BalitaNLP: dropped by owner decision (no explicit license).
# ============================================================================
import json, os, sys, shutil, time
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

RAW = Path("/workspace/corpus/raw")
MANIFEST = RAW / "MANIFEST.v3.json"
MIN_FREE_GB = 80

SOURCES = [
    # (name, repo_id, allow_patterns) — ceb first (smaller)
    ("dcad-ceb", "openbmb/DCAD-2000", ["ceb_Latn/mala_*_keep.jsonl", "ceb_Latn/new_cc_*_keep.jsonl"]),
    ("dcad-fil", "openbmb/DCAD-2000", ["fil_Latn/mala_*_keep.jsonl", "fil_Latn/fineweb-2_*_remove.jsonl"]),
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
            sys.exit(f"ABORT before {name}: <{MIN_FREE_GB} GB free on volume.")
        rev = entry.get("revision") or api.repo_info(repo, repo_type="dataset").sha
        dest = RAW / name
        print(f"[pull] {name}: {repo}@{rev[:12]} patterns={patterns} -> {dest}", flush=True)
        t0 = time.time()
        manifest[name] = {"repo": repo, "revision": rev, "patterns": patterns, "complete": False}
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        snapshot_download(repo_id=repo, repo_type="dataset", revision=rev,
                          allow_patterns=patterns, local_dir=dest,
                          token=os.environ.get("HF_TOKEN") or None, max_workers=12)
        n, b = dir_stats(dest)
        manifest[name].update(complete=True, files=n, bytes=b,
                              seconds=round(time.time() - t0),
                              finished_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        print(f"[done] {name}: {n} files, {b/1e9:.2f} GB in {round(time.time()-t0)}s "
              f"(volume free: {free_gb(RAW):.0f} GB)", flush=True)
    print(f"[ALL DONE] manifest: {MANIFEST}", flush=True)

if __name__ == "__main__":
    main()
