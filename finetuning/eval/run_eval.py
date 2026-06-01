#!/usr/bin/env python3
"""Run the student-prompt suite against a LoRA adapter on Apple Silicon (MPS).

Loads the non-quantized Qwen/Qwen3-1.7B base (the adapter's declared base is the
bnb-4bit unsloth build, which is CUDA-only; the LoRA weights are architecture-
compatible with the standard base) + the PEFT adapter, generates a reply per
prompt, auto-scores with cheap heuristics, and writes raw outputs for human review.

Usage:
  python run_eval.py --adapter ../adapters/bisaya-v1/final-adapter --lang cebuano --out results-bisaya.json
  python run_eval.py --adapter ../adapters/tagalog-full-v2/final-adapter --lang tagalog --out results-tagalog.json
  python run_eval.py --base-only --lang cebuano --out results-base-ceb.json   # control, no adapter
"""
import argparse, json, re, time, os
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE = "Qwen/Qwen3-1.7B"
HERE = os.path.dirname(os.path.abspath(__file__))

# Tagalog-only function words (help detect "answered in Tagalog when Cebuano expected")
TAG_MARK = {"ng","mga","ang","ako","ikaw","siya","ito","iyan","yung","naman","kasi",
            "po","ho","ninyo","natin","tayo","kayo","niya","sila","hindi","mayroon",
            "para","dahil","kapag","habang","upang","nang","raw","daw"}
# Cebuano-only function words
CEB_MARK = {"ug","sa","nga","kini","siya","kay","naa","wala","dili","gyud","kaayo",
            "unsa","aron","imong","nimo","nato","ngano","atong","pwede","kung","anak",
            "maam","kana","mao","nimong","ako","kanimo"," kuhaa","makahimo"}
ENG_COMMON = {"the","and","is","of","to","this","that","with","for","are","you","it",
              "we","they","be","or","as","in","on","a","an","will","can"}

def toks(t): return re.findall(r"[a-zA-Zñ']+", t.lower())

def score(prompt_obj, reply):
    w = toks(reply); n = max(1, len(w))
    ceb = sum(1 for x in w if x in CEB_MARK) / n
    tag = sum(1 for x in w if x in TAG_MARK) / n
    eng = sum(1 for x in w if x in ENG_COMMON) / n
    expected = prompt_obj["lang"]
    # language match: dominant marker set should match expected language
    if expected == "cebuano":
        lang_ok = ceb >= tag and ceb > 0.02
    else:
        lang_ok = tag >= ceb and tag > 0.02
    return {
        "words": len(w),
        "ceb_ratio": round(ceb, 3),
        "tag_ratio": round(tag, 3),
        "eng_ratio": round(eng, 3),
        "lang_ok": bool(lang_ok),
        "ends_question": "?" in reply.rstrip()[-200:],
        "has_structure": ("**" in reply) or ("\n" in reply.strip()),
        "english_heavy": eng > 0.15,
        "too_short": len(w) < 25,
        "empty_or_degenerate": len(w) < 5 or len(set(w)) < max(3, len(w) // 8),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--base-only", action="store_true")
    ap.add_argument("--lang", required=True, choices=["cebuano", "tagalog"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="cap prompts for a smoke test")
    args = ap.parse_args()

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device={dev} base={BASE} adapter={args.adapter or '(base only)'}")

    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16).to(dev)
    if args.adapter and not args.base_only:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.adapter).to(dev)
    model.eval()

    prompts = json.load(open(os.path.join(HERE, "student-prompts.json")))["prompts"]
    prompts = [p for p in prompts if p["lang"] == args.lang]
    if args.limit:
        prompts = prompts[: args.limit]

    sys_prompt = ("Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino..."
                  if args.lang == "cebuano" else
                  "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino...")

    results = []
    t0 = time.time()
    for i, p in enumerate(prompts, 1):
        msgs = [{"role": "system", "content": sys_prompt},
                {"role": "user", "content": p["prompt"]}]
        text = tok.apply_chat_template(msgs, add_generation_prompt=True,
                                       tokenize=False, enable_thinking=False)
        enc = tok(text, return_tensors="pt").to(dev)
        in_len = enc["input_ids"].shape[1]
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=420, do_sample=True,
                                 temperature=0.7, top_p=0.9,
                                 pad_token_id=tok.eos_token_id)
        reply = tok.decode(out[0][in_len:], skip_special_tokens=True).strip()
        sc = score(p, reply)
        results.append({**p, "reply": reply, "scores": sc})
        flag = "" if (sc["lang_ok"] and not sc["english_heavy"] and not sc["empty_or_degenerate"]) else " ⚠"
        print(f"  [{i}/{len(prompts)}] {p['id']} ({p['register']}) {sc['words']}w lang_ok={sc['lang_ok']}{flag}")

    summary = {
        "adapter": args.adapter or "base-only",
        "lang": args.lang,
        "n": len(results),
        "lang_ok": sum(1 for r in results if r["scores"]["lang_ok"]),
        "english_heavy": sum(1 for r in results if r["scores"]["english_heavy"]),
        "degenerate": sum(1 for r in results if r["scores"]["empty_or_degenerate"]),
        "too_short": sum(1 for r in results if r["scores"]["too_short"]),
        "ends_question": sum(1 for r in results if r["scores"]["ends_question"]),
        "avg_words": round(sum(r["scores"]["words"] for r in results) / max(1, len(results))),
        "runtime_s": round(time.time() - t0),
    }
    json.dump({"summary": summary, "results": results},
              open(os.path.join(HERE, args.out), "w"), ensure_ascii=False, indent=1)
    print("\nSUMMARY:", json.dumps(summary, indent=1))

if __name__ == "__main__":
    main()
