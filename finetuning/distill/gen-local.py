import json, urllib.request, time, sys

ENDPOINT="http://127.0.0.1:9099/v1/chat/completions"
MODEL="Qwen3.5-35B-A3B-Q4_K_M.gguf"
SYS="You are a teacher building training data for a Tagalog/English science tutor for Filipino grade-5 kids. You output ONLY valid JSON, no markdown fences."

def prompt(f):
    return f"""Here is a VERIFIED science fact (do not contradict it; ground your answer ONLY in it):
TOPIC: {f['topic']}
FACT (English): {f['en']}
FACT (Tagalog): {f['tl']}

Produce ONE training example as JSON with keys:
- "question": a REALISTIC messy grade-5 student message in Taglish (code-switched Tagalog/English) whose true topic is the fact, but wrapped in distracting framing like homework/essay/project/report, optionally with a small typo. e.g. "may homework po ako tungkol sa <topic>" / "pa-report naman about <topic>".
- "think": a short first-person reasoning trace (2-4 sentences): figure out what the kid ACTUALLY wants, explicitly note the framing words (homework/essay/report) are NOT the topic, name the real topic, and decide to answer grade-5 level grounded in the fact.
- "answer": a warm simple grade-5 Taglish answer, 2-4 sentences, grounded ONLY in the fact.
Output ONLY the JSON object."""

def gen(f):
    body={"model":MODEL,"messages":[{"role":"system","content":SYS},{"role":"user","content":prompt(f)}],
          "temperature":0.7,"max_tokens":700,"chat_template_kwargs":{"enable_thinking":False}}
    req=urllib.request.Request(ENDPOINT,data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    t=time.time(); resp=json.load(urllib.request.urlopen(req,timeout=120)); dt=time.time()-t
    return resp["choices"][0]["message"]["content"], dt

facts=[json.loads(l) for l in open("finetuning/distill/pilot/facts.jsonl")]
out=open("finetuning/distill/pilot/local-gen.jsonl","w")
ok=0; tot_t=0; bad=0
for i,f in enumerate(facts):
    try:
        raw,dt=gen(f); tot_t+=dt
        s=raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        ex=json.loads(s)
        rec={"id":f["id"],"bucket":f["bucket"],"topic":f["topic"],"teacher":"local-35b",
             "question":ex.get("question",""),"think":ex.get("think",""),"answer":ex.get("answer",""),"latency":round(dt,2)}
        out.write(json.dumps(rec,ensure_ascii=False)+"\n"); ok+=1
        print(f"[{i+1}/30] {dt:.1f}s {f['bucket']:9s} {f['topic'][:40]}")
    except Exception as e:
        bad+=1; print(f"[{i+1}/30] FAILED {f['topic'][:40]}: {e}")
out.close()
print(f"\nOK={ok} bad={bad} avg_latency={tot_t/max(ok,1):.1f}s total={tot_t:.0f}s")
