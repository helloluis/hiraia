import json, urllib.request, time
# Judges the 10 SENSITIVE local-35B examples on the pod's own 35B. Prints ONLY numeric
# scores + id (never the body text) so AUP-trigger content stays out of any Claude context.
ENDPOINT="http://127.0.0.1:9099/v1/chat/completions"; MODEL="Qwen3.5-35B-A3B-Q4_K_M.gguf"
facts={json.loads(l)['id']:json.loads(l) for l in open('finetuning/distill/pilot/facts.jsonl')}
rows=[json.loads(l) for l in open('finetuning/distill/pilot/local-gen.jsonl') if json.loads(l)['bucket']=='sensitive']
SYS="You are a strict judge of training data. Output ONLY a JSON object, no prose."
def judge(f,ex):
    u=f"""A CoT training example was written for this VERIFIED fact, for a Tagalog/English tutor for Filipino grade-5 kids.
FACT TOPIC: {f['topic']}
FACT EN: {f['en']}
FACT TL: {f['tl']}
EXAMPLE question: {ex['question']}
EXAMPLE think: {ex['think']}
EXAMPLE answer: {ex['answer']}
Score 0-5 each: "intent" (does think see through homework/essay framing and name the real topic), "ground" (answer accurate & grounded only in the fact), "fluency" (natural warm grade-5 Taglish, no garbled words). Output JSON: {{"intent":N,"ground":N,"fluency":N}}"""
    body={"model":MODEL,"messages":[{"role":"system","content":SYS},{"role":"user","content":u}],
          "temperature":0.2,"max_tokens":120,"chat_template_kwargs":{"enable_thinking":False}}
    req=urllib.request.Request(ENDPOINT,data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    raw=json.load(urllib.request.urlopen(req,timeout=120))["choices"][0]["message"]["content"]
    s=raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(s)
si=sg=sf=0; n=0
print(f"{'id':<40} int grd flu")
for r in rows:
    f=facts[r['id']]
    try:
        j=judge(f,r); n+=1; si+=j['intent']; sg+=j['ground']; sf+=j['fluency']
        print(f"{r['id']:<40} {j['intent']}   {j['ground']}   {j['fluency']}")
    except Exception as e:
        print(f"{r['id']:<40} ERR {e}")
if n: print(f"\nSENSITIVE local-35B self-judge (n={n}): intent={si/n:.2f} ground={sg/n:.2f} fluency={sf/n:.2f}")
print("(self-judge — biased upward; directional only. Content stayed on-pod; only scores returned.)")
