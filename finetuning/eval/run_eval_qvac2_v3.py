#!/usr/bin/env python3
"""Phone-parity eval for the Sailor2-3B v3 adapters via the QVAC v8828 llama-cli
(the real phone engine: llama.cpp + GGUF base + GGUF LoRA).

Same machinery as run_eval_qvac2.py, but for v3 it (a) uses the EXACT v3 training
system prompt per language — including the [image: ...] instruction — and (b)
scores [image:] tag emission. Uses a larger ctx because the v3 system prompt is
long (~200 tok).

Run ON the pod (LD_LIBRARY_PATH must include the qvac-bin dir):
  LD_LIBRARY_PATH=/workspace/qvac-bin-v8828 python3 run_eval_qvac2_v3.py \
    --cli /workspace/qvac-bin-v8828/llama-cli \
    --base /workspace/models/sailor2-3b-chat-f16.gguf \
    --adapter /workspace/output/tagalog-sailor-v3/adapter-tagalog-f16.gguf \
    --lang tagalog --out /workspace/eval-v3-gguf-tagalog.json
"""
import argparse, json, re, subprocess, time

TAG={"ng","mga","ang","ako","ikaw","ito","iyan","yung","naman","kasi","po","hindi","mayroon","ngayon","natin","dahil","kapag","para"}
CEB={"ug","sa","nga","kini","siya","kay","naa","wala","dili","gyud","kaayo","unsa","aron","imong","nimo","nato","ngano","atong","kung","anak","maam","kana","mao"}
ENG={"the","and","is","of","to","this","that","with","for","are","you","it","we","they","be","or","as","in","on","will","can"}

# EXACT v3 training system prompts (carry the [image: ...] instruction).
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
    clean = IMG_RE.sub(" ", reply)
    w=toks(clean); n=max(1,len(w))
    ceb=sum(1 for x in w if x in CEB)/n; tag=sum(1 for x in w if x in TAG)/n; eng=sum(1 for x in w if x in ENG)/n
    uniq=len(set(w))/n if w else 0
    lang_ok=(ceb>=tag and ceb>0.02) if p["lang"]=="cebuano" else (tag>=ceb and tag>0.02)
    return {"words":len(w),"ceb_ratio":round(ceb,3),"tag_ratio":round(tag,3),"eng_ratio":round(eng,3),
            "lang_ok":bool(lang_ok),"ends_question":"?" in clean.rstrip()[-200:],
            "english_heavy":eng>0.15,"too_short":len(w)<25,"uniq_ratio":round(uniq,2),"repetitive":uniq<0.45,
            "n_image_tags":len(img_tags),"has_image_tag":bool(img_tags),
            "image_tag_well_formed": all(t.strip() for t in img_tags) and len(img_tags) <= 1,
            "image_descs":[t.strip()[:120] for t in img_tags]}

ANSI=re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
def clean_reply(raw, prompt):
    t=ANSI.sub("", raw)
    if prompt in t: t=t.split(prompt,1)[-1]
    for marker in ("[ Prompt:", "[ Generation", "\nExiting", "> /exit"):
        if marker in t: t=t.split(marker,1)[0]
    return t.lstrip("|/-\\ \t\r\n>").strip()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--cli",required=True); ap.add_argument("--base",required=True)
    ap.add_argument("--adapter",required=True); ap.add_argument("--lang",required=True)
    ap.add_argument("--out",required=True); ap.add_argument("--prompts",default="/workspace/student-prompts.json")
    ap.add_argument("--ctx",type=int,default=1024); ap.add_argument("--ntok",type=int,default=300)
    a=ap.parse_args()
    prompts=[p for p in json.load(open(a.prompts))["prompts"] if p["lang"]==a.lang]
    sysp=SYS[a.lang]
    results=[]; t0=time.time()
    for i,p in enumerate(prompts,1):
        cmd=[a.cli,"-m",a.base,"--lora",a.adapter,"-ngl","99",
             "-c",str(a.ctx),"-n",str(a.ntok),"--temp","0.7","--top-p","0.9","--seed","42",
             "-st","-sys",sysp,"-p",p["prompt"]]
        try:
            out=subprocess.run(cmd,capture_output=True,text=True,timeout=240)
            reply=clean_reply(out.stdout, p["prompt"])
        except subprocess.TimeoutExpired:
            reply="__TIMEOUT__"
        sc=score(p,reply); results.append({**p,"reply":reply,"scores":sc})
        print(f"  [{i}/{len(prompts)}] {p['id']:7} {p.get('register',''):13} {sc['words']:3}w lang_ok={sc['lang_ok']} img={sc['n_image_tags']} rep={sc['repetitive']}")
    summary={"adapter":a.adapter,"base":a.base,"lang":a.lang,"n":len(results),
             "lang_ok":sum(r['scores']['lang_ok'] for r in results),
             "english_heavy":sum(r['scores']['english_heavy'] for r in results),
             "repetitive":sum(r['scores']['repetitive'] for r in results),
             "ends_question":sum(r['scores']['ends_question'] for r in results),
             "with_image_tag":sum(r['scores']['has_image_tag'] for r in results),
             "total_image_tags":sum(r['scores']['n_image_tags'] for r in results),
             "malformed_image_tags":sum(0 if r['scores']['image_tag_well_formed'] else 1 for r in results),
             "avg_words":round(sum(r['scores']['words'] for r in results)/max(1,len(results))),
             "runtime_s":round(time.time()-t0)}
    json.dump({"summary":summary,"results":results},open(a.out,"w"),ensure_ascii=False,indent=1)
    print("\nSUMMARY:",json.dumps(summary,indent=1))

if __name__=="__main__": main()
