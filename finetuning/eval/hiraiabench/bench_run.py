#!/usr/bin/env python3
"""Pod-side hiraiabench runner (mirrors bench-run.mjs): run the probe pool through an
OpenAI-compatible endpoint and dump answers. Same SHARED neutral tutor prompt + enable_thinking=false
(Qwen3.5 reasoning off) + <think> stripping as the local runner, so 32B is comparable to the rest.

Usage (on pod):  ENDPOINT=http://localhost:8080 MODEL=qwen3.5-32b NO_THINK=1 python bench_run.py
"""
import json, os, re, time, urllib.request

ENDPOINT = os.environ.get("ENDPOINT", "http://localhost:8080")
MODEL = os.environ.get("MODEL", "model")
TEMP = float(os.environ.get("TEMP", "0.5"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "800"))
NO_THINK = os.environ.get("NO_THINK", "1") == "1"
HERE = os.path.dirname(os.path.abspath(__file__))

SYS = {
    "tl": "Ikaw ay isang mabait at maalam na guro sa agham para sa mga batang Pilipino (grade 5). Sagutin nang malinaw, tama, at angkop sa edad ang tanong, sa wikang ginamit ng bata. Magbigay ng tiyak na sagot sa mga napatunayan nang agham, at maamong itama ang mga maling paniniwala (myth). Ngunit kung talagang hindi malalaman ang sagot (hal. kung uulan bukas, isang lottery number, o eksaktong datos na hindi mo alam), tapat na sabihing hindi ka sigurado at huwag mag-imbento.",
    "bis": "Ikaw usa ka mabuot ug maalamon nga magtutudlo sa siyensya alang sa mga bata sa Pilipinas (grade 5). Tubaga nga klaro, tukma, ug angay sa edad ang pangutana, sa pinulongan nga gigamit sa bata. Hatagi ug tin-aw nga tubag ang napamatud-an nga siyensya, ug malumo nga itul-id ang sayop nga mga tuo-tuo. Apan kung dili gyud mahibal-an ang tubag (pananglitan kung mo-ulan ba ugma, usa ka lottery number, o tukma nga datos nga wala nimo nahibal-i), matinud-anon nga isulti nga dili ka sigurado ug ayaw pag-imbento.",
    "en": "You are a kind, knowledgeable science tutor for Filipino grade-5 students. Answer clearly, accurately, and at an age-appropriate level, in the language the student used. Give confident answers to settled science and gently correct common misconceptions. But when the answer is genuinely unknowable (e.g. whether it will rain tomorrow, a lottery number, or an exact fact you do not know), honestly say you are not sure and do not make it up.",
}

def strip_think(s):
    if not s:
        return ""
    if "</think>" in s:
        return s.split("</think>")[-1].strip()
    if "<think>" in s:
        return ""
    return s.strip()

def ask(prompt, lang):
    body = {
        "model": os.environ.get("MODEL_API_NAME", "default"),  # vLLM requires it; llama.cpp ignores it
        "messages": [
            {"role": "system", "content": SYS.get(lang, SYS["en"])},
            {"role": "user", "content": prompt},
        ],
        "temperature": TEMP,
        "max_tokens": MAX_TOKENS,
        "stream": False,
    }
    if NO_THINK:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(
        f"{ENDPOINT}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.loads(r.read())
    return j["choices"][0]["message"]["content"] or ""

probes = json.load(open(os.path.join(HERE, "bench-set.json")))["probes"]
out = []
for i, p in enumerate(probes, 1):
    try:
        t0 = time.time()
        ans = strip_think(ask(p["prompt"], p["lang"]))
        out.append({"id": p["id"], "tier": p["tier"], "lang": p["lang"], "prompt": p["prompt"], "answer": ans})
        print(f"[{i}/{len(probes)}] {p['id']} ({int((time.time()-t0)*1000)}ms){' EMPTY' if not ans else ''}", flush=True)
    except Exception as e:
        out.append({"id": p["id"], "tier": p["tier"], "lang": p["lang"], "prompt": p["prompt"], "answer": "", "error": str(e)[:160]})
        print(f"[{i}/{len(probes)}] {p['id']} FAILED: {str(e)[:80]}", flush=True)

outf = os.path.join(HERE, f"answers.{MODEL}.json")
json.dump({"model": MODEL, "temp": TEMP, "count": len(out), "answers": out}, open(outf, "w"), ensure_ascii=False, indent=1)
print(f"\nwrote {len(out)} answers -> {outf}")
