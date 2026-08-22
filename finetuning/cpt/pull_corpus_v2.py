#!/usr/bin/env python3
# ============================================================================
# pull_corpus_v2.py — corpus-v2 pull onto the EXPANSION volume (runs ON the
# pod; /workspace = hiraia-cpt-expansion 6er6skgoyb, US-NE-1).
#
# v2 scope (CORPUS-EXPANSION-BRIEF.md):
#   - MADLAD-400 `data/fil/*` at the v1-pinned revision 9d886a76bd8f — we need
#     the NOISY split only (v1 already consumed clean), but pulling the whole
#     folder keeps the pull byte-identical to v1's provenance (~7GB).
#   - BloomLibrary + tlwiki are separate harvest paths (harvest_bloom.py /
#     driver_v2.sh), not HF pulls.
#   - OPUS and FineWeb-2 "removed" config: deliberately SKIPPED (sentence-level
#     corpora = low CPT value; FW2-removed = what FW2's own filters rejected).
#     Documented in EXPANSION-REPORT.md.
#
# Same pull-once guarantees as pull_corpus.py: idempotent snapshot_download +
# revision-pinned MANIFEST.json (separate MANIFEST.v2.json so a re-run never
# confuses v1 paths).
# ============================================================================
import json, os, sys, shutil, time
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

RAW = Path("/workspace/corpus/raw")
MANIFEST = RAW / "MANIFEST.v2.json"
MIN_FREE_GB = 80  # brief hard rule: keep >=80GB free on the expansion volume

MADLAD_V1_REV = "9d886a76bd8f"  # v1 MADLAD pull revision (prefix pin; resolved below)

SOURCES = [
    # (name, repo_id, allow_patterns, pinned_revision_or_None)
    ("madlad-fil-v2", "allenai/MADLAD-400", ["data/fil/*"], MADLAD_V1_REV),
]

def free_gb(p: Path) -> float:
    return shutil.disk_usage(p).free / 1e9

def dir_stats(p: Path):
    files = [f for f in p.rglob("*") if f.is_file() and ".cache" not in f.parts]
    return len(files), sum(f.stat().st_size for f in files)

def resolve_madlad_rev(api) -> str:
    """The brief pins '9d886a76bd8f' (a short sha). Find the full commit sha with
    that prefix via the commit list (HF refs don't reliably resolve short shas)."""
    commits = api.list_repo_commits("allenai/MADLAD-400", repo_type="dataset")
    matches = [c.commit_id for c in commits if c.commit_id.startswith(MADLAD_V1_REV)]
    if len(matches) != 1:
        raise RuntimeError(f"pinned prefix {MADLAD_V1_REV} matched {len(matches)} commits: {matches}")
    return matches[0]

def main():
    api = HfApi()
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    for name, repo, patterns, pinned in SOURCES:
        entry = manifest.get(name, {})
        if entry.get("complete"):
            print(f"[skip] {name}: already complete @ {entry['revision'][:12]} "
                  f"({entry['files']} files, {entry['bytes']/1e9:.2f} GB)", flush=True)
            continue
        if free_gb(RAW) < MIN_FREE_GB:
            sys.exit(f"ABORT before {name}: <{MIN_FREE_GB} GB free on volume.")
        rev = entry.get("revision") or pinned or api.repo_info(repo, repo_type="dataset").sha
        if name == "madlad-fil-v2" and rev == MADLAD_V1_REV:
            rev = resolve_madlad_rev(api)
        dest = RAW / name
        print(f"[pull] {name}: {repo}@{rev[:12]} patterns={patterns} -> {dest}", flush=True)
        t0 = time.time()
        manifest[name] = {"repo": repo, "revision": rev, "patterns": patterns, "complete": False}
        MANIFEST.write_text(json.dumps(manifest, indent=2))
        snapshot_download(repo_id=repo, repo_type="dataset", revision=rev,
                          allow_patterns=patterns, local_dir=dest,
                          # empty-string token sends "Bearer " (illegal header) — coerce to None
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
