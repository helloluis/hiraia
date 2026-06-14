#!/usr/bin/env python3
"""Pod-side eval for the Sailor2-3B v3 adapters (image-tag SFT).

Same as run_eval_pod.py but (a) uses the EXACT training system prompt per
language — including the [image: ...] instruction — so image-tag emission is
tested faithfully, and (b) scores [image:] tags: detects them, strips them
before language scoring, and reports per-language emission rate.

Usage (on pod, in venv):
  python run_eval_pod_v3.py --model /workspace/output/tagalog-sailor-v3/merged-model --lang tagalog --out /workspace/eval-v3-tagalog.json
  python run_eval_pod_v3.py --model /workspace/output/bisaya-sailor-v3/merged-model  --lang cebuano  --out /workspace/eval-v3-bisaya.json
"""
import argparse, json, re, time

TAG_MARK = {"ng","mga","ang","ako","ikaw","siya","ito","iyan","yung","naman","kasi",
            "po","ho","ninyo","natin","tayo","kayo","niya","sila","hindi","mayroon",
            "para","dahil","kapag","habang","upang","nang","raw","daw"}
CEB_MARK = {"ug","sa","nga","kini","siya","kay","naa","wala","dili","gyud","kaayo",
            "unsa","aron","imong","nimo","nato","ngano","atong","pwede","kung","anak",
            "maam","kana","mao","nimong","kanimo","makahimo"}
ENG_COMMON = {"the","and","is","of","to","this","that","with","for","are","you","it",
              "we","they","be","or","as","in","on","will","can"}

# EXACT training system prompts (v3 datasets) — carry the [image: ...] instruction.
SYS = {
 "tagalog": ("Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. "
   "Gumagamit ka ng Socratic method at natural conversational Tagalog. Grade 3 level. Kung tatanungin ka tungkol sa "
   "reproductive health, sexual health, o puberty, magalang na tumanggi at i-refer ang estudyante sa kanilang magulang, "
   "doktor, o guro sa Health — huwag sumagot sa paksang iyon. Kapag makakatulong ang isang simpleng larawan sa "
   "pagpapaliwanag, magdagdag ng huling linyang: [image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. "
   "Kung walang angkop na larawan, huwag maglagay ng ganitong linya. At kung naipakita mo na ang isang larawan "
   "kani-kanina lang sa usapang ito, huwag mo na itong ulitin — magpakita lamang ng bago at angkop na larawan."),
 "cebuano": ("Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. "
   "Naggamit ka og Socratic method ug natural nga conversational Bisaya. Grade 3 level. Kung pangutan-on ka mahitungod "
   "sa reproductive health, sexual health, o puberty, matinahuron nga pagbalibad ug i-refer ang estudyante sa ilang "
   "ginikanan, doktor, o magtutudlo sa Health — ayaw pagtubag niana nga topic. Kung makatabang ang usa ka simpleng "
   "hulagway sa pagpasabot, pagdugang og kataposang linya nga: [image: mubo ug tukma nga English nga paghulagway sa "
   "hulagway]. Kung walay angay nga hulagway, ayaw pagbutang niini nga linya. Ug kung gipakita na nimo ang usa ka "
   "hulagway bag-o pa lang niini nga panag-istoryahanay, ayaw na kini balika — pagpakita lang og bag-o ug angay nga hulagway."),
}
IMG_RE = re.compile(r"\[image:\s*([^\]]*)\]", re.IGNORECASE)
def toks(t): return re.findall(r"[a-zA-Zñ']+", t.lower())

def score(p, reply):
    img_tags = IMG_RE.findall(reply)
    clean = IMG_RE.sub(" ", reply)                 # strip tags before language scoring
    w = toks(clean); n = max(1, len(w))
    ceb = sum(1 for x in w if x in CEB_MARK)/n
    tag = sum(1 for x in w if x in TAG_MARK)/n
    eng = sum(1 for x in w if x in ENG_COMMON)/n
    lang_ok = (ceb >= tag and ceb > 0.02) if p["lang"]=="cebuano" else (tag >= ceb and tag > 0.02)
    uniq = len(set(w))/n if w else 0
    return {"words": len(w), "ceb_ratio": round(ceb,3), "tag_ratio": round(tag,3),
            "eng_ratio": round(eng,3), "lang_ok": bool(lang_ok),
            "ends_question": "?" in clean.rstrip()[-200:],
            "english_heavy": eng > 0.15, "too_short": len(w) < 25,
            "uniq_ratio": round(uniq,2), "repetitive": uniq < 0.45,
            "n_image_tags": len(img_tags), "has_image_tag": bool(img_tags),
            "image_tag_well_formed": all(t.strip() for t in img_tags) and len(img_tags) <= 1,
            "image_descs": [t.strip()[:120] for t in img_tags]}

def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--lang", required=True)        # tagalog | cebuano
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompts", default="/workspace/student-prompts.json")
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.model)
    model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16, device_map="auto")
    model.eval()

    prompts = [p for p in json.load(open(a.prompts))["prompts"] if p["lang"] == a.lang]
    sysp = SYS[a.lang]
    results = []; t0 = time.time()
    for i, p in enumerate(prompts, 1):
        msgs = [{"role":"system","content":sysp},{"role":"user","content":p["prompt"]}]
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        enc = tok(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=420, do_sample=True, temperature=0.7,
                                 top_p=0.9, repetition_penalty=1.1, pad_token_id=tok.eos_token_id)
        reply = tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        sc = score(p, reply); results.append({**p, "reply": reply, "scores": sc})
        print(f"  [{i}/{len(prompts)}] {p['id']} {p.get('register','')} {sc['words']}w lang_ok={sc['lang_ok']} img={sc['n_image_tags']} rep={sc['repetitive']}")
    summary = {"model": a.model, "lang": a.lang, "n": len(results),
               "lang_ok": sum(r["scores"]["lang_ok"] for r in results),
               "english_heavy": sum(r["scores"]["english_heavy"] for r in results),
               "repetitive": sum(r["scores"]["repetitive"] for r in results),
               "ends_question": sum(r["scores"]["ends_question"] for r in results),
               "with_image_tag": sum(r["scores"]["has_image_tag"] for r in results),
               "total_image_tags": sum(r["scores"]["n_image_tags"] for r in results),
               "malformed_image_tags": sum(0 if r["scores"]["image_tag_well_formed"] else 1 for r in results),
               "avg_words": round(sum(r["scores"]["words"] for r in results)/max(1,len(results))),
               "runtime_s": round(time.time()-t0)}
    json.dump({"summary": summary, "results": results}, open(a.out,"w"), ensure_ascii=False, indent=1)
    print("\nSUMMARY:", json.dumps(summary, indent=1))

if __name__ == "__main__":
    main()
