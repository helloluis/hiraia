#!/usr/bin/env python3
"""Eval runner for the QVAC v8828 llama-cli (the real phone engine: llama.cpp +
GGUF base + GGUF LoRA). v8828 rejects -no-cnv and runs single-turn conversation
mode, so we parse the conversation stdout (banner + '> prompt' echo + reply +
'[ Prompt: ... ]' stats trailer). Runs the 50-prompt suite for one language,
auto-scores, writes JSON for eval_db.py to ingest.

Run ON the pod (LD_LIBRARY_PATH must include the qvac-bin dir):
  LD_LIBRARY_PATH=/workspace/qvac-bin-v8828 python3 run_eval_qvac2.py \
    --cli /workspace/qvac-bin-v8828/llama-cli \
    --base /workspace/models/qwen3-1.7b-q8_0.gguf \
    --adapter /workspace/output/tagalog-full/adapter-tagalog-f16.gguf \
    --lang tagalog --out /workspace/eval-tagalog.json
"""
import argparse, json, re, subprocess, time

TAG={"ng","mga","ang","ako","ikaw","ito","iyan","yung","naman","kasi","po","hindi","mayroon","ngayon","natin","dahil","kapag","para"}
CEB={"ug","sa","nga","kini","siya","kay","naa","wala","dili","gyud","kaayo","unsa","aron","imong","nimo","nato","ngano","atong","kung","anak","maam","kana","mao"}
ENG={"the","and","is","of","to","this","that","with","for","are","you","it","we","they","be","or","as","in","on","will","can"}
def toks(t): return re.findall(r"[a-zA-Zñ']+", t.lower())

def score(p, reply):
    w=toks(reply); n=max(1,len(w))
    ceb=sum(1 for x in w if x in CEB)/n; tag=sum(1 for x in w if x in TAG)/n; eng=sum(1 for x in w if x in ENG)/n
    uniq=len(set(w))/n if w else 0
    lang_ok=(ceb>=tag and ceb>0.02) if p["lang"]=="cebuano" else (tag>=ceb and tag>0.02)
    return {"words":len(w),"ceb_ratio":round(ceb,3),"tag_ratio":round(tag,3),"eng_ratio":round(eng,3),
            "lang_ok":bool(lang_ok),"ends_question":"?" in reply.rstrip()[-200:],
            "english_heavy":eng>0.15,"too_short":len(w)<25,"uniq_ratio":round(uniq,2),"repetitive":uniq<0.45}

ANSI=re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
def clean_reply(raw, prompt):
    t=ANSI.sub("", raw)
    # everything after the first echo of the user prompt is the model turn
    if prompt in t:
        t=t.split(prompt,1)[-1]
    # cut the stats trailer / exit lines
    for marker in ("[ Prompt:", "[ Generation", "\nExiting", "> /exit"):
        if marker in t:
            t=t.split(marker,1)[0]
    # strip the leading spinner glyphs ( |-\|/ ) and whitespace
    t=t.lstrip("|/-\\ \t\r\n>")
    return t.strip()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--cli",required=True); ap.add_argument("--base",required=True)
    ap.add_argument("--adapter",required=True); ap.add_argument("--lang",required=True)
    ap.add_argument("--out",required=True); ap.add_argument("--prompts",default="/workspace/student-prompts.json")
    ap.add_argument("--ctx",type=int,default=512); ap.add_argument("--ntok",type=int,default=220)
    a=ap.parse_args()
    prompts=[p for p in json.load(open(a.prompts))["prompts"] if p["lang"]==a.lang]
    sysp=("Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. Naggamit ka og Socratic method ug natural nga Bisaya."
          if a.lang=="cebuano" else
          "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. Gumagamit ka ng Socratic method at natural na Tagalog.")
    results=[]; t0=time.time()
    for i,p in enumerate(prompts,1):
        cmd=[a.cli,"-m",a.base,"--lora",a.adapter,"-ngl","99",
             "-c",str(a.ctx),"-n",str(a.ntok),"--temp","0.7","--top-p","0.9","--seed","42",
             "-st","-sys",sysp,"-p",p["prompt"]]
        try:
            out=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
            reply=clean_reply(out.stdout, p["prompt"])
        except subprocess.TimeoutExpired:
            reply="__TIMEOUT__"
        sc=score(p,reply); results.append({**p,"reply":reply,"scores":sc})
        print(f"  [{i}/{len(prompts)}] {p['id']:7} {p['register']:13} {sc['words']:3}w lang_ok={sc['lang_ok']} rep={sc['repetitive']} eng={sc['english_heavy']}")
    summary={"adapter":a.adapter,"base":a.base,"lang":a.lang,"n":len(results),
             "lang_ok":sum(r['scores']['lang_ok'] for r in results),
             "english_heavy":sum(r['scores']['english_heavy'] for r in results),
             "repetitive":sum(r['scores']['repetitive'] for r in results),
             "too_short":sum(r['scores']['too_short'] for r in results),
             "ends_question":sum(r['scores']['ends_question'] for r in results),
             "avg_words":round(sum(r['scores']['words'] for r in results)/max(1,len(results))),
             "runtime_s":round(time.time()-t0)}
    json.dump({"summary":summary,"results":results},open(a.out,"w"),ensure_ascii=False,indent=1)
    print("\nSUMMARY:",json.dumps(summary,indent=1))

if __name__=="__main__": main()
