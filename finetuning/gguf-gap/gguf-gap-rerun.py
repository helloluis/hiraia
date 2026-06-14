#!/usr/bin/env python3
"""Re-run the 25 tagalog pod-eval prompts against local llama-server (GGUF path)
with settings MATCHED to the merged-model pod eval (run_eval_pod_v3.py):
max_tokens 420, repeat_penalty 1.1, temp 0.7, top_p 0.9, seed 42.
Counts [image:] tag emission to test whether the merged-vs-GGUF tag gap
(21/25 vs 9/25) was an eval-mechanics artifact (-n 300 truncation, no rep penalty)
rather than an adapter conversion/scale problem."""
import json, re, sys, urllib.request, time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8089
OUT  = sys.argv[2] if len(sys.argv) > 2 else "/tmp/gguf-gap-rerun-tagalog.json"

SYS = ("Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. "
  "Gumagamit ka ng Socratic method at natural conversational Tagalog. Grade 3 level. Kung tatanungin ka tungkol sa "
  "reproductive health, sexual health, o puberty, magalang na tumanggi at i-refer ang estudyante sa kanilang magulang, "
  "doktor, o guro sa Health — huwag sumagot sa paksang iyon. Kapag makakatulong ang isang simpleng larawan sa "
  "pagpapaliwanag, magdagdag ng huling linyang: [image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. "
  "Kung walang angkop na larawan, huwag maglagay ng ganitong linya. At kung naipakita mo na ang isang larawan "
  "kani-kanina lang sa usapang ito, huwag mo na itong ulitin — magpakita lamang ng bago at angkop na larawan.")

IMG_RE = re.compile(r"\[image:\s*([^\]]*)\]", re.IGNORECASE)
prompts = [p for p in json.load(open("finetuning/eval/student-prompts.json"))["prompts"] if p["lang"] == "tagalog"]

results = []
t0 = time.time()
for i, p in enumerate(prompts, 1):
    body = json.dumps({
        "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": p["prompt"]}],
        "temperature": 0.7, "top_p": 0.9, "seed": 42,
        "max_tokens": 420, "repeat_penalty": 1.1,
    }).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    reply = json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"]["content"]
    tags = IMG_RE.findall(reply)
    unclosed = "[image:" in IMG_RE.sub(" ", reply)
    results.append({**p, "reply": reply, "n_tags": len(tags), "unclosed": unclosed,
                    "descs": [t.strip()[:120] for t in tags]})
    print(f"  [{i}/{len(prompts)}] {p['id']:7} tags={len(tags)} unclosed={unclosed}", flush=True)

summary = {"n": len(results),
           "with_image_tag": sum(1 for r in results if r["n_tags"] > 0),
           "unclosed_tags": sum(1 for r in results if r["unclosed"]),
           "total_tags": sum(r["n_tags"] for r in results),
           "runtime_s": round(time.time() - t0)}
json.dump({"summary": summary, "results": results}, open(OUT, "w"), ensure_ascii=False, indent=1)
print("\nSUMMARY:", json.dumps(summary))
