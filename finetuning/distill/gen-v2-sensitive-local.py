import json, urllib.request, time, concurrent.futures as cf
ENDPOINT="http://127.0.0.1:9099/v1/chat/completions"; MODEL="Qwen3.5-35B-A3B-Q4_K_M.gguf"
OUT="finetuning/distill/work-v2/out/v2-sensitive.jsonl"
SYS="You are a master teacher building SFT data for a Tagalog/English science tutor for Filipino grade-5 kids, teaching correct behavior when RAG retrieval is imperfect. Output ONLY a JSON object, no markdown."
def call(u,maxtok=700,temp=0.7):
    body={"model":MODEL,"messages":[{"role":"system","content":SYS},{"role":"user","content":u}],"temperature":temp,"max_tokens":maxtok,"chat_template_kwargs":{"enable_thinking":False}}
    req=urllib.request.Request(ENDPOINT,data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    raw=json.load(urllib.request.urlopen(req,timeout=120))["choices"][0]["message"]["content"]
    s=raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip(); return json.loads(s)
def u_distract(it):
    r=it["right"]; w=it["wrong"]; lang="Taglish (code-switched Tagalog/English)" if it["lang"]=="tl" else "English"
    return f"""kind=distractor. The kid asks about THIS topic: "{r['topic']}" (verified truth: {r['tl']} / {r['en']}).
But retrieval mistakenly attached an UNRELATED fact about "{w['topic']}" ({w['en']}).
Produce JSON {{"question","think","answer"}}:
- question: messy grade-5 {lang} student message about "{r['topic']}", wrapped in homework/essay/project framing (optional small typo).
- think (English): name the real topic; explicitly note the provided fact is about "{w['topic']}", unrelated, does NOT answer this; decide to ignore it and answer the real topic.
- answer ({lang}, grade-5, 2-3 sentences): correctly teach "{r['topic']}" from its verified truth; do NOT mention/use the unrelated fact.
Output ONLY the JSON."""
def u_nofact(it):
    r=it["right"]; lang="Taglish" if it["lang"]=="tl" else "English"
    return f"""kind=nofact. The kid asks about "{r['topic']}" (verified truth: {r['tl']} / {r['en']}). NO verified fact will be shown to the model.
Produce JSON {{"question","think","answer"}}:
- question: messy grade-5 {lang} student message about "{r['topic']}" with homework/essay framing.
- think (English): name the real topic; note no verified fact was retrieved; decide to answer carefully from well-established knowledge and flag uncertainty if any.
- answer ({lang}, grade-5, 2-3 sentences): correctly teach the topic from its verified truth, humble/simple, no invented specifics.
Output ONLY the JSON."""
def build(it):
    try:
        ex=call(u_distract(it) if it["kind"]=="distractor" else u_nofact(it))
        return {"kind":it["kind"],"lang":it["lang"],"right_id":it["right"]["id"],
                "wrong_id":it.get("wrong",{}).get("id"),"question":ex["question"],"think":ex["think"],"answer":ex["answer"]}, None
    except Exception as e: return None, str(e)[:80]
items=json.load(open("finetuning/distill/work-v2/sensitive.json"))
t0=time.time(); ok=0; err=0
with open(OUT,"w") as wf, cf.ThreadPoolExecutor(max_workers=4) as ex:
    for row,e in ex.map(build, items):
        if row: wf.write(json.dumps(row,ensure_ascii=False)+"\n"); ok+=1
        else: err+=1
        if (ok+err)%50==0: print(f"  {ok+err}/{len(items)} ({ok} ok, {err} err)")
print(f"\nv2 SENSITIVE done: {ok}/{len(items)} -> {OUT} | {err} err | {time.time()-t0:.0f}s (no content printed)")
