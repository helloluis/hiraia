#!/usr/bin/env python3
# ============================================================================
# prep_pools_v2.py — build corpus-v2 SailCraft input pools (runs ON the pod;
# /workspace = hiraia-cpt-expansion). Streams raw v2 sources into one
# JSONL-with-text file per language at $SAILCRAFT/data/data_input/.
#
# Pool policy (CORPUS-EXPANSION-BRIEF.md — v2 is ADDITIVE; cross-v1/v2 dedup
# happens at tokenization mix time, NOT here):
#   pool_tl_v2  = MADLAD fil NOISY split only (v1 consumed clean)
#               + BloomLibrary tl books (CC-licensed child-register text)
#               + tlwiki full article dump (wikiextractor --json output)
#   pool_ceb_v2 = BloomLibrary ceb books (only new ceb source that landed;
#                 MADLAD ceb clean+noisy was already fully consumed by v1,
#                 ceb.wikipedia stays out — the Lsjbot trap)
# Skipped by decision (see EXPANSION-REPORT.md): OPUS (sentence-level),
# FineWeb-2 "removed" config (FW2's own rejects).
# ============================================================================
import glob, gzip, json, os, time

RAW = "/workspace/corpus/raw"
OUT_DIR = os.path.join(os.environ.get("SAILCRAFT", "/workspace/sailcraft-run"), "data", "data_input")
MIN_CHARS = 50  # cheap pre-trim; real filtering is SailCraft stage 1

POOLS = {
    "pool_tl_v2": [
        f"{RAW}/madlad-fil-v2/**/*noisy*.jsonl.gz",
        f"{RAW}/bloomlibrary-tl/books.jsonl",
        f"{RAW}/tlwiki/extracted/**/wiki_*",
    ],
    "pool_ceb_v2": [
        f"{RAW}/bloomlibrary-ceb/books.jsonl",
    ],
}

def iter_parquet(path):
    import pyarrow.dataset as ds
    for batch in ds.dataset(path).to_batches(columns=["text"], batch_size=8192):
        for v in batch.column("text"):
            yield v.as_py()

def iter_jsonl_gz(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        yield from iter_jsonl_lines(f)

def iter_jsonl(path):
    with open(path, "rt", encoding="utf-8", errors="replace") as f:
        yield from iter_jsonl_lines(f)

def iter_jsonl_lines(f):
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            yield line
            continue
        if isinstance(obj, str):
            yield obj
        elif isinstance(obj, dict):
            t = obj.get("text")
            if t:
                yield t

def iter_any(path):
    if path.endswith(".parquet"):
        return iter_parquet(path)
    if path.endswith(".jsonl.gz"):
        return iter_jsonl_gz(path)
    return iter_jsonl(path)  # .jsonl and wikiextractor's extension-less wiki_* files

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for pool, patterns in POOLS.items():
        out_path = os.path.join(OUT_DIR, f"{pool}.jsonl")
        docs = kept = bytes_out = 0
        t0 = time.time()
        with open(out_path, "w", encoding="utf-8") as out:
            for pat in patterns:
                files = sorted(glob.glob(pat, recursive=True))
                if not files:
                    print(f"[warn] {pool}: NO FILES for {pat}", flush=True)
                src_kept0 = kept
                for fp in files:
                    for text in iter_any(fp):
                        docs += 1
                        if not text or len(text) < MIN_CHARS:
                            continue
                        line = json.dumps({"text": text}, ensure_ascii=False) + "\n"
                        out.write(line)
                        kept += 1
                        bytes_out += len(line.encode("utf-8"))
                print(f"[src] {pool} <- {pat}: +{kept - src_kept0} docs "
                      f"({len(files)} files)", flush=True)
        manifest[pool] = {"docs_seen": docs, "docs_kept": kept, "bytes": bytes_out,
                          "seconds": round(time.time() - t0), "out": out_path}
        print(f"[pool done] {pool}: {kept}/{docs} docs, {bytes_out/1e9:.2f} GB "
              f"in {round(time.time()-t0)}s", flush=True)
    with open(os.path.join(OUT_DIR, "POOLS-MANIFEST.v2.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("[ALL POOLS DONE]", json.dumps({k: v["bytes"] for k, v in manifest.items()}), flush=True)

if __name__ == "__main__":
    main()
