#!/usr/bin/env python3
"""Raw base-model bake-off: judge out-of-the-box Tagalog + Cebuano quality of
candidate bases (NO fine-tuning). transformers backend so Qwen3.5 (Gated
DeltaNet) and Sailor2 (Qwen2.5) both load natively. Writes bakeoff-results.json.
"""
import json, gc, time, traceback
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODELS = [
    "Qwen/Qwen3-1.7B",
    "Qwen/Qwen3.5-2B",
    "Qwen/Qwen3.5-4B",
    "sail/Sailor2-1B-Chat",
    "sail/Sailor2-3B-Chat",
]

SYS_TL = "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. Gumagamit ka ng Socratic method at natural na Tagalog."
SYS_CEB = "Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. Naggamit ka og Socratic method ug natural nga Bisaya."

PROMPTS = [
    # (id, lang, system, user)
    ("tl-photo", "tagalog", SYS_TL, "ano po ang potosintesis"),
    ("tl-states", "tagalog", SYS_TL, "ano po yung solid liquid gas"),
    ("tl-water",  "tagalog", SYS_TL, "water cycle"),
    ("tl-sky",    "tagalog", SYS_TL, "bakit po asul ang langit"),
    ("ceb-photo", "cebuano", SYS_CEB, "unsa man ang potosintesis"),
    ("ceb-green", "cebuano", SYS_CEB, "nganong berde man ang dahon maam"),
    ("ceb-states","cebuano", SYS_CEB, "unsa man ni solid liquid gas maam"),
    ("ceb-rain",  "cebuano", SYS_CEB, "ngano man nga moulan"),
]


def gen_one(model, tok, system, user):
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    # disable Qwen "thinking" so we judge the actual answer; harmless if unsupported
    try:
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                       enable_thinking=False)
    except TypeError:
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tok(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=256, do_sample=True,
                             temperature=0.7, top_p=0.9,
                             pad_token_id=tok.eos_token_id)
    reply = tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    # strip any leftover think block
    if "</think>" in reply:
        reply = reply.split("</think>", 1)[-1]
    return reply.strip()


def main():
    results = {}
    for mid in MODELS:
        print(f"\n########## {mid} ##########", flush=True)
        t0 = time.time()
        try:
            tok = AutoTokenizer.from_pretrained(mid, trust_remote_code=True)
            model = AutoModelForCausalLM.from_pretrained(
                mid, torch_dtype=torch.bfloat16, device_map="cuda",
                trust_remote_code=True)
            model.eval()
            outs = []
            for pid, lang, sysp, user in PROMPTS:
                try:
                    r = gen_one(model, tok, sysp, user)
                except Exception as e:
                    r = f"__GEN_ERROR__ {e}"
                print(f"  [{pid}] {len(r.split())}w :: {r[:90]!r}", flush=True)
                outs.append({"id": pid, "lang": lang, "prompt": user, "reply": r})
            results[mid] = {"ok": True, "load_s": round(time.time()-t0), "responses": outs}
            del model; gc.collect(); torch.cuda.empty_cache()
        except Exception as e:
            print(f"  LOAD/RUN FAILED: {e}", flush=True)
            traceback.print_exc()
            results[mid] = {"ok": False, "error": str(e)}
            gc.collect(); torch.cuda.empty_cache()
    json.dump(results, open("/workspace/bakeoff-results.json", "w"),
              ensure_ascii=False, indent=1)
    print("\nDONE -> /workspace/bakeoff-results.json", flush=True)


if __name__ == "__main__":
    main()
