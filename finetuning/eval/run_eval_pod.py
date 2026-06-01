#!/usr/bin/env python3
"""Pod-side re-eval: run the student-prompt suite against a model on the GPU,
using the SAME inference settings as the prior working inference test
(repetition_penalty=1.1). Designed to load either a merged model (preferred,
no base mismatch) or base+adapter via unsloth.

Usage (on pod, in venv):
  python run_eval_pod.py --model /workspace/output/bisaya-v1/merged-model --lang cebuano --out /workspace/eval-bisaya.json
  python run_eval_pod.py --adapter /workspace/output/bisaya-v1/final-adapter --lang cebuano --out /workspace/eval-bisaya.json   # fallback if merge incomplete
"""
import argparse, json, re, time, os

TAG_MARK = {"ng","mga","ang","ako","ikaw","siya","ito","iyan","yung","naman","kasi",
            "po","ho","ninyo","natin","tayo","kayo","niya","sila","hindi","mayroon",
            "para","dahil","kapag","habang","upang","nang","raw","daw"}
CEB_MARK = {"ug","sa","nga","kini","siya","kay","naa","wala","dili","gyud","kaayo",
            "unsa","aron","imong","nimo","nato","ngano","atong","pwede","kung","anak",
            "maam","kana","mao","nimong","kanimo","makahimo"}
ENG_COMMON = {"the","and","is","of","to","this","that","with","for","are","you","it",
              "we","they","be","or","as","in","on","will","can"}
def toks(t): return re.findall(r"[a-zA-Zñ']+", t.lower())

def score(p, reply):
    w = toks(reply); n = max(1, len(w))
    ceb = sum(1 for x in w if x in CEB_MARK)/n
    tag = sum(1 for x in w if x in TAG_MARK)/n
    eng = sum(1 for x in w if x in ENG_COMMON)/n
    lang_ok = (ceb >= tag and ceb > 0.02) if p["lang"]=="cebuano" else (tag >= ceb and tag > 0.02)
    # degenerate = low unique-word ratio (catches the repetition we saw)
    uniq = len(set(w))/n if w else 0
    return {"words": len(w), "ceb_ratio": round(ceb,3), "tag_ratio": round(tag,3),
            "eng_ratio": round(eng,3), "lang_ok": bool(lang_ok),
            "ends_question": "?" in reply.rstrip()[-200:],
            "english_heavy": eng > 0.15, "too_short": len(w) < 25,
            "uniq_ratio": round(uniq,2), "repetitive": uniq < 0.45}

def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    ap = argparse.ArgumentParser()
    ap.add_argument("--model"); ap.add_argument("--adapter")
    ap.add_argument("--base", default="unsloth/qwen3-1.7b-unsloth-bnb-4bit")
    ap.add_argument("--lang", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--prompts", default="/workspace/student-prompts.json")
    a = ap.parse_args()

    if a.model:
        tok = AutoTokenizer.from_pretrained(a.model)
        model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16, device_map="auto")
    else:
        from peft import PeftModel
        tok = AutoTokenizer.from_pretrained(a.base)
        model = AutoModelForCausalLM.from_pretrained(a.base, torch_dtype=torch.bfloat16, device_map="auto")
        model = PeftModel.from_pretrained(model, a.adapter)
    model.eval()

    prompts = [p for p in json.load(open(a.prompts))["prompts"] if p["lang"] == a.lang]
    sysp = ("Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. Naggamit ka og Socratic method ug natural nga Bisaya."
            if a.lang=="cebuano" else
            "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. Gumagamit ka ng Socratic method at natural na Tagalog.")
    results = []; t0 = time.time()
    for i, p in enumerate(prompts, 1):
        msgs = [{"role":"system","content":sysp},{"role":"user","content":p["prompt"]}]
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        enc = tok(text, return_tensors="pt").to(model.device)
        import torch as T
        with T.no_grad():
            out = model.generate(**enc, max_new_tokens=420, do_sample=True, temperature=0.7,
                                 top_p=0.9, repetition_penalty=1.1, pad_token_id=tok.eos_token_id)
        reply = tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        sc = score(p, reply); results.append({**p, "reply": reply, "scores": sc})
        print(f"  [{i}/{len(prompts)}] {p['id']} {p['register']} {sc['words']}w lang_ok={sc['lang_ok']} rep={sc['repetitive']}")
    summary = {"model": a.model or a.adapter, "lang": a.lang, "n": len(results),
               "lang_ok": sum(r["scores"]["lang_ok"] for r in results),
               "english_heavy": sum(r["scores"]["english_heavy"] for r in results),
               "repetitive": sum(r["scores"]["repetitive"] for r in results),
               "ends_question": sum(r["scores"]["ends_question"] for r in results),
               "avg_words": round(sum(r["scores"]["words"] for r in results)/max(1,len(results))),
               "runtime_s": round(time.time()-t0)}
    json.dump({"summary": summary, "results": results}, open(a.out,"w"), ensure_ascii=False, indent=1)
    print("\nSUMMARY:", json.dumps(summary, indent=1))

if __name__ == "__main__":
    main()
