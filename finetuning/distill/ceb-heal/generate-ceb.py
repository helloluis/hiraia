#!/usr/bin/env python3
"""
generate-ceb.py — ON-POD Cebuano heal-text generation with Sailor2-20B-Chat via vLLM.

Reads its shard of prompts.jsonl, generates grounded Cebuano expansions, writes outputs.jsonl.
High-throughput via vLLM continuous batching on one 80GB GPU. Prints ONLY aggregate metrics
(counts, tok/s) — the Cebuano text is written to disk on the pod and never echoed (AUP).

Env / args:
  MODEL   (default sail/Sailor2-20B-Chat)
  SHARD   which shard id this replica owns (required)
  PROMPTS path to prompts.jsonl (default /workspace/prompts.jsonl)
  OUT     output path (default /workspace/out/ceb-shard-${SHARD}.jsonl)
  TEMP MAXTOK TOPP   sampling
Usage on pod:
  SHARD=0 python generate-ceb.py
"""
import os, json, time, sys

MODEL  = os.environ.get("MODEL", "sail/Sailor2-20B-Chat")
SHARD  = int(os.environ["SHARD"])
PROMPTS= os.environ.get("PROMPTS", "/workspace/prompts.jsonl")
OUT    = os.environ.get("OUT", f"/workspace/out/ceb-shard-{SHARD}.jsonl")
TEMP   = float(os.environ.get("TEMP", "0.9"))
TOPP   = float(os.environ.get("TOPP", "0.95"))
MAXTOK = int(os.environ.get("MAXTOK", "512"))
MAXLEN = int(os.environ.get("MAXLEN", "2048"))
GPUUTIL= float(os.environ.get("GPUUTIL", "0.92"))

os.makedirs(os.path.dirname(OUT), exist_ok=True)

# resume: skip pids already written
done = set()
if os.path.exists(OUT):
    with open(OUT, encoding="utf-8") as f:
        for ln in f:
            try: done.add(json.loads(ln)["pid"])
            except Exception: pass

rows = []
with open(PROMPTS, encoding="utf-8") as f:
    for ln in f:
        ln = ln.strip()
        if not ln: continue
        r = json.loads(ln)
        if r.get("shard") != SHARD: continue
        if r["pid"] in done: continue
        rows.append(r)

print(f"[shard {SHARD}] model={MODEL} prompts={len(rows)} (skip {len(done)} done) → {OUT}", flush=True)
if not rows:
    print(f"[shard {SHARD}] nothing to do"); sys.exit(0)

from vllm import LLM, SamplingParams
llm = LLM(model=MODEL, dtype="bfloat16", tensor_parallel_size=1,
          gpu_memory_utilization=GPUUTIL, max_model_len=MAXLEN, enforce_eager=False)
sp = SamplingParams(temperature=TEMP, top_p=TOPP, max_tokens=MAXTOK, repetition_penalty=1.05)

BATCH = int(os.environ.get("BATCH", "2048"))
t0 = time.time(); n_out = 0; n_tok = 0
with open(OUT, "a", encoding="utf-8") as o:
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        outs = llm.chat([r["messages"] for r in chunk], sp, use_tqdm=False)
        for r, out in zip(chunk, outs):
            text = out.outputs[0].text.strip()
            ntok = len(out.outputs[0].token_ids)
            n_tok += ntok; n_out += 1
            o.write(json.dumps({"pid": r["pid"], "fact_id": r["fact_id"], "domain": r["domain"],
                                "grade": r["grade"], "fmt": r["fmt"], "ntok": ntok,
                                "text": text}, ensure_ascii=False) + "\n")
        o.flush()
        el = time.time() - t0
        print(f"[shard {SHARD}] {n_out}/{len(rows)} gens · {n_tok} tok · {n_tok/el:.0f} tok/s · {el/60:.1f}min", flush=True)

print(f"[shard {SHARD}] DONE {n_out} gens · {n_tok} tok · {(time.time()-t0)/60:.1f}min", flush=True)
