#!/usr/bin/env python3
"""
train-heal.py — full-parameter continued-pretrain (heal) of the pruned 2.4B on the heal
token stream. HF Trainer + DDP (launch with torchrun). Reports perplexity before/after on a
held-out calib slice so we can see the prune damage (1.85x) close. Saves the healed model.

AUP: trains on ceb/tl/en tokens; emits only loss/ppl numbers.

Launch (on pod):
  torchrun --nproc_per_node=$NGPU train-heal.py --model sailor2-2b4 --tokens heal-tokens.npy \
     --calib calib.jsonl --out sailor2-2b4-healed --lr 3e-5 [--max-steps N]
"""
import argparse, json, math, os, numpy as np, torch
from torch.utils.data import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="sailor2-2b4")
ap.add_argument("--tokens", default="heal-tokens.bin")
ap.add_argument("--calib", default="calib.jsonl")
ap.add_argument("--out", default="sailor2-2b4-healed")
ap.add_argument("--seqlen", type=int, default=2048)
ap.add_argument("--lr", type=float, default=3e-5)
ap.add_argument("--bs", type=int, default=8)
ap.add_argument("--ga", type=int, default=4)
ap.add_argument("--max-steps", type=int, default=-1)
ap.add_argument("--holdout", type=int, default=40)
ap.add_argument("--eval", dest="evalf", default="eval-holdout.jsonl", help="per-lang {text,lang} holdout")
args = ap.parse_args()

local_rank = int(os.environ.get("LOCAL_RANK", 0))
is_main = local_rank == 0
torch.cuda.set_device(local_rank)
tok = AutoTokenizer.from_pretrained(args.model)
# load straight onto this rank's GPU so the ppl-before eval runs on GPU, not CPU (was the "hang")
model = AutoModelForCausalLM.from_pretrained(args.model, dtype=torch.bfloat16).to(f"cuda:{local_rank}")
model.config.use_cache = False

class TokDS(Dataset):
    def __init__(self, path, seqlen):
        self.t = np.memmap(path, dtype=np.uint32, mode="r"); self.seqlen = seqlen
        self.n = len(self.t) // seqlen
    def __len__(self): return self.n
    def __getitem__(self, i):
        x = torch.from_numpy(self.t[i*self.seqlen:(i+1)*self.seqlen].astype(np.int64))
        return {"input_ids": x, "labels": x.clone()}

ds = TokDS(args.tokens, args.seqlen)
if is_main: print(f">> dataset: {len(ds)} seqs of {args.seqlen} = {len(ds)*args.seqlen/1e6:.0f}M tokens", flush=True)

@torch.no_grad()
def ppl_one(texts):
    model.eval(); dev = next(model.parameters()).device; tot = 0.0; ntok = 0
    for t in texts:
        ids = tok(t, return_tensors="pt", truncation=True, max_length=1024).input_ids.to(dev)
        if ids.shape[1] < 2: continue
        out = model(ids, labels=ids); n = ids.shape[1]-1
        tot += out.loss.item()*n; ntok += n
    model.train(); return math.exp(tot/max(1, ntok))

# per-language eval holdout {lang:[texts]} — measure Tagalog AND Cebuano AND English recovery
holds = {}
for l in open(args.evalf):
    if l.strip():
        r = json.loads(l); holds.setdefault(r.get("lang", "?"), []).append(r["text"])
def ppl_by_lang(): return {k: round(ppl_one(v), 2) for k, v in sorted(holds.items())}
if is_main:
    pb = ppl_by_lang(); print(f">> perplexity BEFORE heal (per-lang): {json.dumps(pb)}", flush=True)

targs = TrainingArguments(
    output_dir=args.out + "-ckpt", per_device_train_batch_size=args.bs,
    gradient_accumulation_steps=args.ga, learning_rate=args.lr, lr_scheduler_type="cosine",
    warmup_ratio=0.03, num_train_epochs=1, max_steps=args.max_steps, bf16=True,
    gradient_checkpointing=True, logging_steps=10, save_steps=500, save_total_limit=1,
    report_to="none", dataloader_num_workers=2, ddp_find_unused_parameters=False,
)
trainer = Trainer(model=model, args=targs, train_dataset=ds)
trainer.train()

if is_main:
    pa = ppl_by_lang()
    print(f">> perplexity AFTER heal (per-lang): {json.dumps(pa)}", flush=True)
    model.save_pretrained(args.out, safe_serialization=True); tok.save_pretrained(args.out)
    print(json.dumps({"ppl_before_heal": pb, "ppl_after_heal": pa}), flush=True)
    print(">> HEAL DONE", flush=True)
