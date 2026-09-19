#!/usr/bin/env python3
# ============================================================================
# prep_pools.py — build SailCraft input pools from the raw corpus pull (runs ON
# the pod; /workspace = hiraia-cpt-corpus volume). Streams parquet + jsonl.gz
# into one JSONL-with-text file per language at $SAILCRAFT/data/data_input/.
#
# Pool policy (documented decision, 2026-08-21):
#   tl  = fineweb2-fil + MADLAD fil CLEAN split + culturax-tl
#         (tl has volume to spare; the noisy split buys little for the compute)
#   ceb = fineweb2-ceb + MADLAD ceb CLEAN+NOISY + culturax-ceb
#         (ceb is scarce (~0.37B tok) — mine everything; the LID-0.70 gate and
#          stage-1 filters do the quality control)
# Anchors (en/zh) do NOT pass through SailCraft — fineweb/fineweb-2 are already
# cleaned corpora; they join at tokenization/mix time.
# ============================================================================
import glob, gzip, json, os, sys, time

RAW = "/workspace/corpus/raw"
OUT_DIR = os.path.join(os.environ.get("SAILCRAFT", "/workspace/sailcraft-run"), "data", "data_input")
MIN_CHARS = 50  # cheap pre-trim; real filtering is SailCraft stage 1

POOLS = {
    "pool_tl": [
        f"{RAW}/fineweb2-fil/**/*.parquet",
        f"{RAW}/madlad-fil/**/*clean*.jsonl.gz",
        f"{RAW}/culturax-tl/**/*.parquet",
    ],
    "pool_ceb": [
        f"{RAW}/fineweb2-ceb/**/*.parquet",
        f"{RAW}/madlad-ceb/**/*.jsonl.gz",      # clean AND noisy
        f"{RAW}/culturax-ceb/**/*.parquet",
    ],
}

def iter_parquet(path):
    import pyarrow.dataset as ds
    for batch in ds.dataset(path).to_batches(columns=["text"], batch_size=8192):
        for v in batch.column("text"):
            yield v.as_py()

def iter_jsonl_gz(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
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
                    it = iter_parquet(fp) if fp.endswith(".parquet") else iter_jsonl_gz(fp)
                    for text in it:
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
    with open(os.path.join(OUT_DIR, "POOLS-MANIFEST.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("[ALL POOLS DONE]", json.dumps({k: v["bytes"] for k, v in manifest.items()}), flush=True)

if __name__ == "__main__":
    main()
