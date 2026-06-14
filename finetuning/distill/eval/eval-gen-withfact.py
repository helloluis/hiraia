#!/usr/bin/env python3
"""Path-B ceiling test: distilled adapter answering held-out framed questions WITH the
verified fact provided in-context (simulating perfect RAG). Output compared against the
no-fact distill answers we already have, to measure the grounding lift from retrieval."""
import json, os, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE="sail/Sailor2-3B-Chat"; ADAPTER="/workspace/output/distill-sailor-3b-v1/final-adapter"
HELD=os.environ.get("HELD","/workspace/heldout.json"); OUT=os.environ.get("OUT","/workspace/eval-withfact-out.json")
held=json.load(open(HELD)); tok=AutoTokenizer.from_pretrained(BASE); IM_END=tok.convert_tokens_to_ids("<|im_end|>")

base=AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16, device_map="cuda")
model=PeftModel.from_pretrained(base, ADAPTER); model.eval()
res={}
for r in held:
    # prepend the verified fact, the way a RAG context block would arrive
    grounded=f"Gamitin lamang ang katotohanang ito para sumagot:\n{r['tl']}\n\n{r['framed_q']}"
    ids=tok.apply_chat_template([{"role":"user","content":grounded}], tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out=model.generate(ids, max_new_tokens=320, do_sample=True, temperature=0.3, top_p=0.9, eos_token_id=IM_END, pad_token_id=IM_END)
    res[r["id"]]=tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
rows=[{"id":r["id"],"topic":r["topic"],"en":r["en"],"tl":r["tl"],"framed_q":r["framed_q"],"withfact_out":res[r["id"]]} for r in held]
json.dump(rows, open(OUT,"w"), ensure_ascii=False, indent=0); print(f"wrote {len(rows)} -> {OUT}")
