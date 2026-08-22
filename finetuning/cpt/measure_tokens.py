#!/usr/bin/env python3
# ============================================================================
# measure_tokens.py — sample-based token yield measurement (runs ON the pod).
# Brief method: tokenize 10k random docs with the Qwen3.5 tokenizer, compute
# tokens/byte on the sample, extrapolate by total file bytes. Reports TOKENS.
#
# Usage: python measure_tokens.py <file.jsonl> [more.jsonl ...] --out result.json
# ============================================================================
import argparse, json, os, random, sys

def pick_tokenizer():
    try:
        from transformers import AutoTokenizer
    except ImportError:
        sys.exit("transformers not installed in this venv")
    for name in ("Qwen/Qwen3.5-2B-Base", "Qwen/Qwen2.5-7B"):
        try:
            tok = AutoTokenizer.from_pretrained(name, trust_remote_code=True,
                                                token=os.environ.get("HF_TOKEN"))
            print(f"[tokenizer] {name}", flush=True)
            return tok, name
        except Exception as e:
            print(f"[tokenizer] {name} failed: {type(e).__name__}: {e}", flush=True)
    sys.exit("no usable tokenizer")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample", type=int, default=10000)
    args = ap.parse_args()

    tok, tok_name = pick_tokenizer()
    results = {}
    for path in args.files:
        total_bytes = os.path.getsize(path)
        # reservoir-sample raw lines by streaming (file can be multi-GB)
        rng = random.Random(42)
        sample = []
        with open(path, "rb") as f:
            for i, line in enumerate(f):
                if len(sample) < args.sample:
                    sample.append(line)
                else:
                    j = rng.randint(0, i)
                    if j < args.sample:
                        sample[j] = line
        texts, bytes_sampled = [], 0
        for raw in sample:
            bytes_sampled += len(raw)
            try:
                texts.append(json.loads(raw.decode("utf-8", "replace"))["text"])
            except Exception:
                texts.append(raw.decode("utf-8", "replace"))
        n_tokens = sum(len(ids) for ids in tok(texts, add_special_tokens=False)["input_ids"])
        tpb = n_tokens / max(bytes_sampled, 1)
        est = int(tpb * total_bytes)
        results[path] = {"tokenizer": tok_name, "total_bytes": total_bytes,
                         "sample_docs": len(sample), "sample_tokens": n_tokens,
                         "tokens_per_byte": round(tpb, 5), "est_tokens": est}
        print(f"[measure] {path}: {total_bytes/1e9:.2f} GB, sample {len(sample)} docs -> "
              f"{n_tokens} tokens ({tpb:.4f} tok/B) => est {est/1e9:.2f}B tokens", flush=True)
    with open(args.out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"[measure DONE] -> {args.out}", flush=True)

if __name__ == "__main__":
    main()
