#!/usr/bin/env python3
"""v2 eval: generate with the v2 adapter in PRODUCTION format for 3 conditions per
held-out fact: correct fact in context / WRONG fact (distractor) / no fact."""
import json, os, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
BASE="sail/Sailor2-3B-Chat"; ADAPTER=os.environ.get("ADAPTER","/workspace/output/distill-sailor-3b-v2/final-adapter")
HELD="/workspace/heldout-v2.json"; OUT=os.environ.get("OUT","/workspace/eval-v2-out.json")
held=json.load(open(HELD)); tok=AutoTokenizer.from_pretrained(BASE); IM_END=tok.convert_tokens_to_ids("<|im_end|>")
base=AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16, device_map="cuda")
model=PeftModel.from_pretrained(base, ADAPTER); model.eval()
def gen(system,user):
    ids=tok.apply_chat_template([{"role":"system","content":system},{"role":"user","content":user}],
                                tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out=model.generate(ids, max_new_tokens=360, do_sample=True, temperature=0.3, top_p=0.9, eos_token_id=IM_END, pad_token_id=IM_END)
    return tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
rows=[]
for i,r in enumerate(held):
    rows.append({"id":r["id"],"topic":r["topic"],"en":r["en"],"tl":r["tl"],"framed_q":r["framed_q"],"wrong_topic":r["wrong_topic"],
                 "out_correct":gen(r["system"],r["user_correct"]),
                 "out_distractor":gen(r["system"],r["user_distractor"]),
                 "out_nofact":gen(r["system"],r["user_nofact"])})
    if (i+1)%10==0: print(f"  {i+1}/{len(held)}")
json.dump(rows, open(OUT,"w"), ensure_ascii=False, indent=0); print(f"wrote {len(rows)} -> {OUT}")
