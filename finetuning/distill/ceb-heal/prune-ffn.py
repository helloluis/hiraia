#!/usr/bin/env python3
"""
prune-ffn.py — Minitron-style FFN-width structured prune of Sailor2-3B (Qwen2) → ~2.4B.

Width-only (Sailor2: depth-pruning → convergence failure). We shave each layer's FFN
intermediate dim from 9352 → NEW (default 4608, ~50%), keeping the highest-importance
neurons. Importance = accumulated |activation| feeding down_proj over a CEBUANO+TL+EN
calibration set (so Cebuano-relevant neurons are protected — the long tail). Attention,
hidden_size, and embeddings are untouched. The pruned model is DEGRADED by construction —
the heal (continued-pretrain) recovers it; here we just produce it + measure the damage
(perplexity before/after) so we know what the heal must close.

AUP: reads ceb/tl calibration text but only as model input; emits numbers (ppl, param count),
never text.

Usage (on a GPU pod):
  python prune-ffn.py --model sail/Sailor2-3B --calib calib.jsonl --new-intermediate 4608 --out sailor2-2b4
"""
import argparse, json, torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="sail/Sailor2-3B")
ap.add_argument("--calib", default="calib.jsonl")
ap.add_argument("--new-intermediate", type=int, default=4608)
ap.add_argument("--max-len", type=int, default=1024)
ap.add_argument("--holdout", type=int, default=40, help="calib texts held out for perplexity")
ap.add_argument("--out", default="sailor2-2b4-pruned")
args = ap.parse_args()

dev = "cuda" if torch.cuda.is_available() else "cpu"
print(f">> device={dev} loading {args.model} ...", flush=True)
tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.bfloat16).to(dev).eval()
cfg = model.config
L, I = cfg.num_hidden_layers, cfg.intermediate_size
K = args.new_intermediate
print(f">> layers={L} intermediate={I} -> {K} | params before: {sum(p.numel() for p in model.parameters())/1e9:.3f}B", flush=True)

texts = [json.loads(l)["text"] for l in open(args.calib) if l.strip()]
hold, calib = texts[:args.holdout], texts[args.holdout:]
print(f">> calib={len(calib)} holdout={len(hold)}", flush=True)

@torch.no_grad()
def ppl(txts):
    tot, ntok = 0.0, 0
    for t in txts:
        ids = tok(t, return_tensors="pt", truncation=True, max_length=args.max_len).input_ids.to(dev)
        if ids.shape[1] < 2: continue
        out = model(ids, labels=ids)
        n = ids.shape[1] - 1
        tot += out.loss.item() * n; ntok += n
    import math
    return math.exp(tot / max(1, ntok))

ppl_before = ppl(hold)
print(f">> perplexity BEFORE prune: {ppl_before:.2f}", flush=True)

# importance: accumulate |input to down_proj| per intermediate neuron, per layer
imp = [torch.zeros(I, device=dev, dtype=torch.float32) for _ in range(L)]
hooks = []
def mk(li):
    def hook(mod, inp):
        imp[li] += inp[0].detach().float().abs().sum(dim=(0, 1))
    return hook
for li, layer in enumerate(model.model.layers):
    hooks.append(layer.mlp.down_proj.register_forward_pre_hook(mk(li)))
print(">> collecting FFN importance over calibration ...", flush=True)
with torch.no_grad():
    for i, t in enumerate(calib):
        ids = tok(t, return_tensors="pt", truncation=True, max_length=args.max_len).input_ids.to(dev)
        model(ids)
        if i % 50 == 0: print(f"   calib {i}/{len(calib)}", flush=True)
for h in hooks: h.remove()

print(">> pruning each layer's FFN to top-K neurons ...", flush=True)
for li, layer in enumerate(model.model.layers):
    keep = torch.topk(imp[li], K).indices.sort().values
    mlp = layer.mlp
    mlp.gate_proj.weight.data = mlp.gate_proj.weight.data[keep, :].clone()
    mlp.up_proj.weight.data   = mlp.up_proj.weight.data[keep, :].clone()
    mlp.down_proj.weight.data = mlp.down_proj.weight.data[:, keep].clone()
    mlp.gate_proj.out_features = K; mlp.up_proj.out_features = K; mlp.down_proj.in_features = K
cfg.intermediate_size = K

ppl_after = ppl(hold)
nparams = sum(p.numel() for p in model.parameters())
print(f">> perplexity AFTER prune:  {ppl_after:.2f}  (was {ppl_before:.2f}, ratio {ppl_after/ppl_before:.2f}x)", flush=True)
print(f">> params after: {nparams/1e9:.3f}B", flush=True)

print(f">> saving pruned model -> {args.out}", flush=True)
model.save_pretrained(args.out, safe_serialization=True)
tok.save_pretrained(args.out)
print(json.dumps({"params_b": round(nparams/1e9, 3), "ppl_before": round(ppl_before, 2),
                  "ppl_after": round(ppl_after, 2), "ppl_ratio": round(ppl_after/ppl_before, 2),
                  "new_intermediate": K}))
print(">> PRUNE DONE", flush=True)
