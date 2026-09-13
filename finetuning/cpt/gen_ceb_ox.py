#!/usr/bin/env python3
# ============================================================================
# gen_ceb_ox.py — synthetic Cebuano via OpenRouter stealth/ox-alpha (free
# preview week, Aug 2026). Translation-first: Tagalog educational text ->
# Cebuano. Reasoning model: needs big max_tokens; parse `content` only.
#
# Queue: sources tagged by origin. Output: docs_ceb.jsonl {"text","src","src_id"}.
# QC inline: fastText LID (lid.176, local) ceb>=0.70 + Tagalog-bleed heuristic.
# A third lane (Grok in-session) writes a SIDECAR, not this file:
#   synth-ceb/docs_ceb_grok.jsonl  src=grokgen  src_id=grokgen:<n>
# A fourth lane (Fireworks Flash) writes another sidecar on the VPS:
#   docs_ceb_fw.jsonl  src=fwgen  src_id=fwgen:<n>  (synth-ceb-fw.service)
# See SYNTH-CEB-SPEC.md §10–§11. Do not reuse ocgen: / grokgen: / fwgen:.
# Daily cap guard: stops at ~950 calls/UTC day (free tier is 1000/day here).
# Resume: skips src_ids already present in the output.
# ============================================================================
import json, os, random, re, sys, threading, time
from pathlib import Path

OUT = Path(os.environ.get("SYNTH_CEB_DIR", "/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb"))
OUT.mkdir(exist_ok=True)
DOCS = OUT / "docs_ceb.jsonl"
STATE = OUT / "gen-state.json"
LID = os.environ.get("LID_MODEL", "/tmp/sailcraft-local/lm_resource/lid.176.bin")
WORKERS = 10
MAX_TOKENS = int(os.environ.get("OR_MAX_TOKENS", "32768"))

# Tagalog-DISTINCTIVE function words only (first version used shared words like
# ang/sa/na/kung/ba — valid in both languages — and dropped 23/30 good outputs).
# These are tl-only: ay (inversion), ng, nang, iyon, natin/atin, upang, kahit,
# din/rin, po, sana, daw/raw, ito, kasi. ceb equivalents: ug/sa, nga, kana(ko),
# natong, aron, bisan, usab/sad, (no po), unta, konó, kini, kay.
TL_MARKERS = re.compile(r"\b(ay|ng|nang|iyon|iyang|natin|atin|upang|kahit|din|rin|po|"
                        r"sana|daw|raw|ito|kasi|bukod|dapat|habang|kailan|paano|ganoon|"
                        r"ganyan|ngunit|subalit|dahil)\b", re.I)
BLEED_MAX = 0.04

def get_key(name):
    env_file = os.environ.get("SYNTH_ENV_FILE", "/Users/luis/Code/hiraia/.env.local")
    if os.environ.get(name):
        return os.environ[name]
    if not os.path.exists(env_file):
        return None
    for line in open(env_file):
        if line.startswith(name + "="):
            return line.strip().split("=", 1)[1]
    return None

# Lanes: OpenRouter free tier (1000 req/day for this account) does the heavy
# translation batches. Cap is per-REQUEST, so batch size is the yield lever.
# OpenCode Go ox-alpha-free sheds any request that runs >~4min (503 at ~256s
# or silent hang) — but short GENERATION calls (~200-word stories, ~50s)
# succeed, so OC runs as a short-form generation lane instead of translating.
PROVIDERS = [
    {"id": "oc", "url": "https://opencode.ai/zen/go/v1/chat/completions",
     "model": "ox-alpha-free", "key": get_key("OPENCODE_API_KEY"),
     "cap": int(os.environ.get("CAP_OC", "2000")), "timeout": 240,
     "mode": "gen", "max_tokens": 2500,
     "workers": int(os.environ.get("OC_CONC", "2"))},
    {"id": "or", "url": "https://openrouter.ai/api/v1/chat/completions",
     "model": "stealth/ox-alpha", "key": get_key("OPENROUTER_API_KEY"),
     "cap": int(os.environ.get("CAP_OR", "950")), "timeout": int(os.environ.get("OR_TIMEOUT", "900")),
     "mode": "xlate", "max_tokens": MAX_TOKENS,
     "workers": int(os.environ.get("OR_CONC", "4"))},
]
PROVIDERS = [p for p in PROVIDERS if p["key"]]
assert PROVIDERS, "no provider keys"
_lid_model = None
_lid_lock = threading.Lock()

def lid_lang(text):
    global _lid_model
    with _lid_lock:
        if _lid_model is None:
            import fasttext
            fasttext.FastText.eprint = lambda *a, **k: None
            _lid_model = fasttext.load_model(LID)
        m = _lid_model
    pred = m.predict(text.replace("\n", " ")[:2000])
    return pred[0][0].replace("__label__", ""), float(pred[1][0])

def tl_bleed(text):
    words = re.findall(r"\b\w+\b", text.lower())
    if not words:
        return 1.0
    hits = len(TL_MARKERS.findall(text))
    return hits / len(words)

BATCH = int(os.environ.get("GEN_BATCH", "8"))  # chunks per call — OR cap is
# per-REQUEST, not tokens. Queue chunks are ~2–3.5k chars; 8× is ~2× the old
# pack of 4. Raise GEN_BATCH further only if keep-rate stays high.

BATCH_SYS = ("You are an expert translator of Philippine languages. Translate each numbered "
             "Tagalog passage into natural, fluent Cebuano (Sinugbuanong Binisaya) suitable for "
             "elementary school children. Keep meaning and structure faithful. Output ONLY the "
             "translations, each starting with its [N] marker, in order — no notes, no preamble.")

def call_http_curl(body, prov, retries=4):
    """Both lanes via real curl. OC: urllib gets Cloudflare 1010/empty-503
    even with a curl UA. OR: urllib IncompleteRead-drops large batch replies."""
    import subprocess
    tag = prov["id"]
    payload = json.dumps(body)
    for i in range(retries):
        try:
            p = subprocess.run(
                ["curl", "-sS", "--max-time", str(prov["timeout"]), prov["url"],
                 "-H", f"Authorization: Bearer {prov['key']}",
                 "-H", "Content-Type: application/json",
                 "-H", "User-Agent: curl/8.7.1",
                 "-w", "\n__HTTP__%{http_code}", "-d", payload],
                capture_output=True, text=True, timeout=prov["timeout"] + 60)
            out = p.stdout
            code = ""
            if "__HTTP__" in out:
                out, _, code = out.rpartition("__HTTP__")
            code = code.strip()
            if code.startswith("2"):
                try:
                    r = json.loads(out)
                    return r["choices"][0]["message"].get("content")
                except Exception as e:
                    print(f"[{tag} parse-fail] try{i} {e} {out[:200]!r}", flush=True)
            else:
                print(f"[{tag} http {code}] try{i} rc={p.returncode} {out[:200]!r} "
                      f"{p.stderr[:120]!r}", flush=True)
            if tag == "or" and code == "429":
                # upstream free-tier congestion lasts for long stretches —
                # long cooldowns so we don't burn the daily cap on doomed retries
                time.sleep(120 * (i + 1))
            elif code == "429" or not code.startswith("2"):
                time.sleep(30 * (i + 1) + random.uniform(0, 10))
        except Exception as e:
            print(f"[{tag} curl-fail] try{i} {e}", flush=True)
            time.sleep(10 * (i + 1))
    return None

GEN_TOPICS = [
    "pagtatanim ng palay", "pangingisda sa dagat", "pagluluto ng adobo",
    "pag-aaral ng abakada", "paglilinis ng bakuran", "pagtitinda sa palengke",
    "pista sa barangay", "pagkakaroon ng bagong kapatid", "pag-aalaga ng aso",
    "pagtatanim ng gulay", "pagpunta sa paaralan sa unang araw",
    "pag-iwas sa sakit na sipon", "pagligo sa ilog", "paglalaro ng tumbang preso",
    "pagtulong sa lola", "pagbabahagi ng pagkain", "pagtitipid ng pera",
    "ang ulan at ang payong", "pag-aani ng mais", "pag-gawa ng saranggola",
    "ang araw at ang init nito", "pagtulog sa hapon", "paglilinis ng ngipin",
    "pagbasa ng libro", "pagbisita sa probinsya", "ang alimango sa bukid",
    "pagtitinda ng pandesal", "paglalaro ng habulan", "pag-aaral ng pagbilang",
    "ang kalabaw sa uma", "pagtatanong tungkol sa mga bituin", "pagpupunyagi",
]
GEN_FORMATS = [
    "maikling kwento na may aral sa dulo",
    "aralin na may tatlong tanong sa dulo",
    "talatang nagpapaliwanag", "tula na may sukat",
    "usapan ng dalawang bata", "sanaysay", "kwentong bayan",
]
GEN_SYS = ("You are an expert writer of Cebuano (Sinugbuanong Binisaya) "
           "educational materials for Philippine elementary schools. Write in "
           "natural, fluent Cebuano suitable for children. Output ONLY the "
           "requested piece — no notes, no preamble.")

def make_gen_prompt(rng):
    return (f"Sumulat ng {rng.choice(GEN_FORMATS)} sa Cebuano (mga 200 salita) "
            f"para sa Grade {rng.randint(1, 6)} tungkol sa "
            f"{rng.choice(GEN_TOPICS)}. Ilagay lang ang piece mismo, walang nota.")

def post(body, prov, retries=4):
    """One HTTP attempt loop via curl. Logs every failed attempt."""
    return call_http_curl(body, prov, retries)

def call_ox(texts, prov, retries=4):
    if isinstance(texts, str):
        texts = [texts]
    if len(texts) == 1:
        user, sys_prompt = texts[0], (
            "You are an expert translator of Philippine languages. Translate the user's "
            "Tagalog text into natural, fluent Cebuano (Sinugbuanong Binisaya) suitable for "
            "elementary school children. Keep the meaning and structure faithful. Output ONLY "
            "the Cebuano translation — no notes, no preamble.")
    else:
        user = "\n\n".join(f"[{i+1}]\n{t}" for i, t in enumerate(texts))
        sys_prompt = BATCH_SYS
    body = {
        "model": prov["model"],
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user},
        ],
        "max_tokens": prov["max_tokens"],
    }
    return post(body, prov, retries)

def call_gen(prov, rng, retries=3):
    body = {
        "model": prov["model"],
        "messages": [
            {"role": "system", "content": GEN_SYS},
            {"role": "user", "content": make_gen_prompt(rng)},
        ],
        "max_tokens": prov["max_tokens"],
    }
    return post(body, prov, retries)

def split_batch(out, n):
    """Split a numbered-marker batch output back into n sections (None where missing)."""
    parts = re.split(r"\[(\d+)\]\s*", out)
    segs = {}
    for i in range(1, len(parts) - 1, 2):
        try:
            segs[int(parts[i])] = parts[i + 1].strip()
        except ValueError:
            pass
    return [segs.get(i) for i in range(1, n + 1)]

def calls_today(state, prov_id=None):
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if prov_id:
        return state.get("calls", {}).get(f"{day}:{prov_id}", 0)
    return state.get("calls", {}).get(day, 0)  # legacy single-lane counter

def calls_left(state, prov):
    return prov["cap"] - calls_today(state, prov["id"])

def seconds_until_utc_midnight():
    now = time.gmtime()
    elapsed = now.tm_hour * 3600 + now.tm_min * 60 + now.tm_sec
    return max(1, 86400 - elapsed)

_prov_by_id = {p["id"]: p for p in PROVIDERS}
XLATE = next((p for p in PROVIDERS if p["mode"] == "xlate"), None)
GENP = next((p for p in PROVIDERS if p["mode"] == "gen"), None)

def bump_calls(state, prov, lock):
    with lock:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        state["calls"].setdefault(f"{day}:{prov['id']}", 0)
        state["calls"][f"{day}:{prov['id']}"] += 1

def main():
    queue_file = OUT / os.environ.get("GEN_QUEUE", "queue.jsonl")
    state = json.loads(STATE.read_text()) if STATE.exists() else {"calls": {}}
    done_ids = set()
    if DOCS.exists():
        with open(DOCS, encoding="utf-8") as f:
            for line in f:
                try:
                    done_ids.add(json.loads(line)["src_id"])
                except Exception:
                    pass
    queue = []
    with open(queue_file, encoding="utf-8") as f:
        for line in f:
            q = json.loads(line)
            if q["src_id"] not in done_ids:
                queue.append(q)
    print(f"[gen] queue={len(queue)} (done={len(done_ids)})", flush=True)

    lock = threading.Lock()
    stats = {"kept": 0, "fail": 0, "lid_drop": 0, "bleed_drop": 0}

    def process_item(q, out):
        """QC + persist one translated section."""
        if not out or len(out.strip()) < 100:
            stats["fail"] += 1
            return "fail"
        out = out.strip()
        lang, conf = lid_lang(out)
        bleed = tl_bleed(out)
        verdict = "ok"
        if lang != "ceb" or conf < 0.70:
            verdict = "lid"
        elif bleed > BLEED_MAX:
            verdict = "bleed"
        with lock:
            with open(OUT / "docs_ceb_all.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"text": out, "src": q["src"], "src_id": q["src_id"],
                                    "lid": lang, "lid_conf": round(conf, 3),
                                    "bleed": round(bleed, 4), "verdict": verdict},
                                   ensure_ascii=False) + "\n")
            if verdict != "ok":
                stats["lid_drop" if verdict == "lid" else "bleed_drop"] += 1
                return verdict
            with open(DOCS, "a", encoding="utf-8") as f:
                f.write(json.dumps({"text": out, "src": q["src"], "src_id": q["src_id"]},
                                   ensure_ascii=False) + "\n")
            stats["kept"] += 1
            if stats["kept"] % 20 == 0:
                STATE.write_text(json.dumps(state))
                print(f"[gen] kept={stats['kept']} fail={stats['fail']} "
                      f"lid={stats['lid_drop']} bleed={stats['bleed_drop']} "
                      f"today: " + " ".join(
                          f"{p['id']}={calls_today(state, p['id'])}/{p['cap']}"
                          for p in PROVIDERS), flush=True)
        return "ok"

    def work(batch):
        """One translation batch on the OR lane; split output by [N] markers.
        Missing sections are returned so the caller can requeue them — a
        truncated 8-chunk reply must not drop the unread items."""
        if calls_left(state, XLATE) <= 0:
            return "cap", batch
        nchar = sum(len(q.get("text") or "") for q in batch)
        print(f"[or] batch n={len(batch)} chars={nchar}", flush=True)
        out = call_ox([q["text"] for q in batch], XLATE)
        bump_calls(state, XLATE, lock)
        if not out:
            stats["fail"] += len(batch)
            return "fail", batch
        sections = split_batch(out, len(batch)) if len(batch) > 1 else [out]
        leftover = []
        for q, sec in zip(batch, sections):
            if not sec or not str(sec).strip():
                leftover.append(q)
            else:
                process_item(q, sec)
        if leftover:
            print(f"[or] requeue {len(leftover)}/{len(batch)} missing sections",
                  flush=True)
        return "ok", leftover

    def gen_loop(worker_idx):
        """OC lane: short-form generation. Sleeps at the daily cap and
        resumes at UTC midnight. Does not join/hold the OR lane."""
        rng = random.Random(hash((time.time(), worker_idx)) & 0xffffffff)
        fails = 0
        while True:
            if calls_left(state, GENP) <= 0:
                wait = min(seconds_until_utc_midnight(), 60)
                print(f"[oc gen] worker {worker_idx} capped, "
                      f"sleep {wait}s (UTC day roll)", flush=True)
                time.sleep(wait)
                continue
            out = call_gen(GENP, rng)
            bump_calls(state, GENP, lock)
            if out:
                fails = 0
                with lock:
                    state["gen_seq"] = state.get("gen_seq", 0) + 1
                    sid = f"ocgen:{state['gen_seq']}"
                process_item({"src": "ocgen", "src_id": sid}, out)
            else:
                fails += 1
                time.sleep(min(60 * fails, 300))

    def or_loop(worker_idx):
        """OR translation: independent of OC. Pops batches from the shared
        remaining queue; on daily cap, puts the batch back and sleeps until
        the UTC day rolls. A 503 storm on OC cannot stall this lane."""
        while True:
            if calls_left(state, XLATE) <= 0:
                wait = min(seconds_until_utc_midnight(), 60)
                print(f"[or] worker {worker_idx} capped, "
                      f"sleep {wait}s (UTC day roll)", flush=True)
                time.sleep(wait)
                continue
            with lock:
                n = min(BATCH, len(queue))
                batch = queue[:n]
                del queue[:n]
            if not batch:
                print(f"[or] worker {worker_idx} queue empty, sleep 300s",
                      flush=True)
                time.sleep(300)
                continue
            status, leftover = work(batch)
            if leftover:
                with lock:
                    if status == "cap":
                        queue[:0] = leftover
                    else:
                        # fail / truncated: retry later, don't hot-loop the
                        # same 429 batch at the head of the queue
                        queue.extend(leftover)

    print("[gen] OC and OR lanes run independently; a cap or outage on one "
          "does not stall the other", flush=True)
    threads = []
    if GENP:
        for w in range(GENP["workers"]):
            t = threading.Thread(target=gen_loop, args=(w,), name=f"oc-{w}")
            t.start()
            threads.append(t)
    if XLATE:
        print(f"[gen] OR queue remaining={len(queue)} batch={BATCH} "
              f"max_tokens={XLATE['max_tokens']} timeout={XLATE['timeout']} "
              f"workers={XLATE['workers']}", flush=True)
        for w in range(XLATE["workers"]):
            t = threading.Thread(target=or_loop, args=(w,), name=f"or-{w}")
            t.start()
            threads.append(t)
    else:
        print("[gen] no translation lane configured", flush=True)
    for t in threads:
        t.join()
    STATE.write_text(json.dumps(state))
    print(f"[GEN DONE] {stats} calls_today={calls_today(state)}", flush=True)

if __name__ == "__main__":
    main()
