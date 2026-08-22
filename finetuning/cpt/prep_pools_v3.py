#!/usr/bin/env python3
# ============================================================================
# prep_pools_v3.py — build corpus-v3 SailCraft input pools (runs ON the pod;
# /workspace = hiraia-cpt-expansion). v3 is ADDITIVE like v2 (cross-version
# dedup happens at tokenization mix time).
#
#   pool_tl_v3  = DCAD fil_Latn mala keep (lang_id_score>=0.7 pre-filter)
#               + DCAD fil_Latn fineweb-2 remove (same pre-filter)
#               + OPUS tl mono (chunked pseudo-docs)
#               + DepEd LR portal modules (pdftotext; Tagalog-medium site)
#   pool_ceb_v3 = DCAD ceb_Latn mala keep + new_cc keep
#                 (anti-Lsjbot pre-filter: lang_id>=0.7 AND stopwords>=0.05
#                  AND perplexity<=100000 — sampled bot stubs show perplexity
#                  ~1.7e6 and stopwords 0.015; real text is far from both)
#               + OPUS ceb mono
#
# DCAD records carry quality fields; the pre-filter only removes what
# SailCraft's gate would also hate — it just saves stage-1 hours on 37GB.
# ============================================================================
import glob, json, os, time

RAW = "/workspace/corpus/raw"
OUT_DIR = os.path.join(os.environ.get("SAILCRAFT", "/workspace/sailcraft-run"), "data", "data_input")
MIN_CHARS = 50

def dcad_ok(obj, lang):
    """DCAD quality-score pre-filter."""
    try:
        if float(obj.get("lang_id_score", 0)) < 0.70:
            return False
        if lang == "ceb":
            if float(obj.get("stopwords_ratio", 0)) < 0.05:
                return False
            if float(obj.get("perplexity_score", 0)) > 100000:
                return False
    except (TypeError, ValueError):
        return False
    return True

POOLS = {
    "pool_tl_v3": [
        (f"{RAW}/dcad-fil/fil_Latn/mala_*_keep.jsonl", ("dcad", "tl")),
        (f"{RAW}/dcad-fil/fil_Latn/fineweb-2_*_remove.jsonl", ("dcad", "tl")),
        (f"{RAW}/opus-*-tl/docs.jsonl", ("plain", None)),
        (f"{RAW}/opus-ubuntu-fil/docs.jsonl", ("plain", None)),
        (f"{RAW}/deped-lrportal/docs.jsonl", ("plain", None)),
    ],
    "pool_ceb_v3": [
        (f"{RAW}/dcad-ceb/ceb_Latn/mala_*_keep.jsonl", ("dcad", "ceb")),
        (f"{RAW}/dcad-ceb/ceb_Latn/new_cc_*_keep.jsonl", ("dcad", "ceb")),
        (f"{RAW}/opus-*-ceb/docs.jsonl", ("plain", None)),
    ],
}

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for pool, sources in POOLS.items():
        out_path = os.path.join(OUT_DIR, f"{pool}.jsonl")
        docs = kept = dropped_prefilter = bytes_out = 0
        t0 = time.time()
        with open(out_path, "w", encoding="utf-8") as out:
            for pat, (kind, lang) in sources:
                files = sorted(glob.glob(pat, recursive=True))
                if not files:
                    print(f"[warn] {pool}: NO FILES for {pat}", flush=True)
                src_kept0, src_drop0 = kept, dropped_prefilter
                for fp in files:
                    with open(fp, "rt", encoding="utf-8", errors="replace") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            docs += 1
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            text = obj.get("text") if isinstance(obj, dict) else None
                            if not text or len(text) < MIN_CHARS:
                                continue
                            if kind == "dcad" and not dcad_ok(obj, lang):
                                dropped_prefilter += 1
                                continue
                            out.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
                            kept += 1
                            bytes_out += len(text.encode("utf-8"))
                print(f"[src] {pool} <- {pat}: +{kept - src_kept0} docs "
                      f"(pre-filter dropped {dropped_prefilter - src_drop0}, {len(files)} files)",
                      flush=True)
        manifest[pool] = {"docs_seen": docs, "docs_kept": kept,
                          "dropped_prefilter": dropped_prefilter, "bytes": bytes_out,
                          "seconds": round(time.time() - t0), "out": out_path}
        print(f"[pool done] {pool}: {kept}/{docs} docs (pre-filter -{dropped_prefilter}), "
              f"{bytes_out/1e9:.2f} GB in {round(time.time()-t0)}s", flush=True)
    with open(os.path.join(OUT_DIR, "POOLS-MANIFEST.v3.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("[ALL POOLS DONE]", json.dumps({k: v["bytes"] for k, v in manifest.items()}), flush=True)

if __name__ == "__main__":
    main()
