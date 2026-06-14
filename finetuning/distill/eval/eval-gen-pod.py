#!/usr/bin/env python3
"""Pod-side eval: generate for FRAMED questions with NO RAG context, on
(a) base Sailor2-3B-Chat and (b) base + distill LoRA. Paths via env HELD/OUT."""
import json, os, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE="sail/Sailor2-3B-Chat"
ADAPTER="/workspace/output/distill-sailor-3b-v1/final-adapter"
HELD=os.environ.get("HELD","/workspace/heldout.json")
OUT=os.environ.get("OUT","/workspace/eval-out.json")

held=json.load(open(HELD))
tok=AutoTokenizer.from_pretrained(BASE)
IM_END=tok.convert_tokens_to_ids("<|im_end|>")  # pin EOS so generation stops cleanly

def gen_all(model, tag):
    model.eval(); res={}
    for r in held:
        msgs=[{"role":"user","content":r["framed_q"]}]
        ids=tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out=model.generate(ids, max_new_tokens=320, do_sample=True, temperature=0.3, top_p=0.9,
                               eos_token_id=IM_END, pad_token_id=IM_END)
        res[r["id"]]=tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
    print(f"  [{tag}] generated {len(res)}")
    return res

print(f"HELD={HELD} OUT={OUT} im_end={IM_END}")
print("loading base...")
base=AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16, device_map="cuda")
base_out=gen_all(base, "base")
print("attaching adapter...")
dist=PeftModel.from_pretrained(base, ADAPTER)
dist_out=gen_all(dist, "distill")

rows=[{"id":r["id"],"topic":r["topic"],"en":r["en"],"tl":r["tl"],"framed_q":r["framed_q"],
       "base_out":base_out[r["id"]],"distill_out":dist_out[r["id"]]} for r in held]
json.dump(rows, open(OUT,"w"), ensure_ascii=False, indent=0)
print(f"wrote {len(rows)} -> {OUT}")
