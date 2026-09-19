#!/usr/bin/env python3
# ============================================================================
# gen_ceb_fw.py — Lane FW: DeepSeek V4 Flash (Fireworks) short-form Cebuano.
# Separate sidecar from OC/OR (`docs_ceb_fw.jsonl`, src=fwgen). Daily USD cap
# from usage tokens. Stops after FW_UNTIL_UTC. Does not touch docs_ceb.jsonl.
# ============================================================================
import json, os, random, re, sys, threading, time, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(os.environ.get("SYNTH_CEB_DIR", "/var/lib/synth-ceb"))
OUT.mkdir(parents=True, exist_ok=True)
DOCS = OUT / "docs_ceb_fw.jsonl"
AUDIT = OUT / "docs_ceb_fw_all.jsonl"
STATE = OUT / "fw-state.json"
LID = os.environ.get("LID_MODEL", "/opt/synth-ceb/lm_resource/lid.176.bin")
URL = "https://api.fireworks.ai/inference/v1/chat/completions"
MODEL = os.environ.get("FW_MODEL", "accounts/fireworks/models/deepseek-v4-flash-0731")
PRICE_IN = float(os.environ.get("FW_PRICE_IN", "0.22"))    # $/1M input
PRICE_CACHED = float(os.environ.get("FW_PRICE_CACHED", "0.007"))
PRICE_OUT = float(os.environ.get("FW_PRICE_OUT", "0.66"))   # $/1M output
BUDGET = float(os.environ.get("FW_BUDGET_USD", "10"))
UNTIL = os.environ.get("FW_UNTIL_UTC", "2026-08-31T00:00:00Z")
WORKERS = int(os.environ.get("FW_CONC", "3"))
MAX_TOKENS = int(os.environ.get("FW_MAX_TOKENS", "4000"))
TIMEOUT = int(os.environ.get("FW_TIMEOUT", "180"))

TL_MARKERS = re.compile(
    r"\b(ay|ng|nang|iyon|iyang|natin|atin|upang|kahit|din|rin|po|"
    r"sana|daw|raw|ito|kasi|bukod|dapat|habang|kailan|paano|ganoon|"
    r"ganyan|ngunit|subalit|dahil)\b",
    re.I,
)
BLEED_MAX = 0.04
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
GEN_SYS = (
    "You are an expert writer of Cebuano (Sinugbuanong Binisaya) "
    "educational materials for Philippine elementary schools. Write in "
    "natural, fluent Cebuano suitable for children. Output ONLY the "
    "requested piece — no notes, no preamble."
)

_lid = None
_lid_lock = threading.Lock()


def get_key():
    if os.environ.get("FIREWORKS_API_KEY"):
        return os.environ["FIREWORKS_API_KEY"]
    env_file = os.environ.get("SYNTH_ENV_FILE", "/opt/synth-ceb/env")
    if os.path.exists(env_file):
        for line in open(env_file):
            if line.startswith("FIREWORKS_API_KEY="):
                return line.strip().split("=", 1)[1]
    return None


def parse_until():
    s = UNTIL.replace("Z", "+00:00")
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def utc_day():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {"seq": 0, "spend": {}, "calls": {},
            "prompt_tokens": {}, "completion_tokens": {}}


def max_existing_seq():
    n = 0
    if not DOCS.exists():
        return 0
    with open(DOCS, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                s = json.loads(line).get("src_id", "")
                if s.startswith("fwgen:"):
                    n = max(n, int(s.split(":", 1)[1]))
            except Exception:
                pass
    return n


def lid_lang(text):
    global _lid
    with _lid_lock:
        if _lid is None:
            import fasttext
            fasttext.FastText.eprint = lambda *a, **k: None
            _lid = fasttext.load_model(LID)
        m = _lid
    pred = m.predict(text.replace("\n", " ")[:2000])
    return pred[0][0].replace("__label__", ""), float(pred[1][0])


def tl_bleed(text):
    words = re.findall(r"\b\w+\b", text.lower())
    if not words:
        return 1.0
    return len(TL_MARKERS.findall(text)) / len(words)


def strip_piece(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t).strip()
    lines = t.splitlines()
    if lines and re.search(r"^(here is|sure|of course|here'?s|sumusunod|narito)",
                           lines[0], re.I):
        t = "\n".join(lines[1:]).strip()
    return t


def make_prompt(rng):
    return (f"Sumulat ng {rng.choice(GEN_FORMATS)} sa Cebuano (mga 200 salita) "
            f"para sa Grade {rng.randint(1, 6)} tungkol sa "
            f"{rng.choice(GEN_TOPICS)}. Ilagay lang ang piece mismo, walang nota.")


def usage_cost(u):
    pin = int(u.get("prompt_tokens") or 0)
    pout = int(u.get("completion_tokens") or 0)
    cached = 0
    det = u.get("prompt_tokens_details") or {}
    if isinstance(det, dict):
        cached = int(det.get("cached_tokens") or 0)
    uncached = max(0, pin - cached)
    return (uncached / 1e6) * PRICE_IN + (cached / 1e6) * PRICE_CACHED + (pout / 1e6) * PRICE_OUT, pin, pout


def call_fw(key, prompt):
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": GEN_SYS},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.7,
    }
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            r = json.load(resp)
        m = r["choices"][0]["message"]
        return strip_piece(m.get("content") or ""), r.get("usage") or {}, None
    except urllib.error.HTTPError as e:
        err = e.read()[:240].decode("utf-8", "replace")
        return None, {}, f"HTTP {e.code} {err}"
    except Exception as e:
        return None, {}, str(e)


def main():
    key = get_key()
    if not key:
        print("[fw] no FIREWORKS_API_KEY", flush=True)
        sys.exit(1)
    until = parse_until()
    now = datetime.now(timezone.utc)
    if now >= until:
        print(f"[fw] past until {UNTIL} — idle", flush=True)
        return 0

    state = load_state()
    if not state.get("seq"):
        state["seq"] = max_existing_seq()
    lock = threading.Lock()
    stats = {"kept": 0, "fail": 0, "lid_drop": 0, "bleed_drop": 0, "calls": 0}

    def day_spend():
        return float(state.get("spend", {}).get(utc_day(), 0.0))

    def over_budget():
        return day_spend() >= BUDGET - 0.02

    def persist_state():
        STATE.write_text(json.dumps(state))

    def process(text, src_id):
        if not text or len(text) < 100:
            stats["fail"] += 1
            return "fail"
        lang, conf = lid_lang(text)
        bleed = tl_bleed(text)
        verdict = "ok"
        if lang != "ceb" or conf < 0.70:
            verdict = "lid"
        elif bleed > BLEED_MAX:
            verdict = "bleed"
        rec_all = {"text": text, "src": "fwgen", "src_id": src_id,
                   "lid": lang, "lid_conf": round(conf, 3),
                   "bleed": round(bleed, 4), "verdict": verdict}
        with open(AUDIT, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec_all, ensure_ascii=False) + "\n")
        if verdict != "ok":
            stats["lid_drop" if verdict == "lid" else "bleed_drop"] += 1
            return verdict
        with open(DOCS, "a", encoding="utf-8") as f:
            f.write(json.dumps({"text": text, "src": "fwgen", "src_id": src_id},
                               ensure_ascii=False) + "\n")
        stats["kept"] += 1
        return "ok"

    def worker(idx):
        rng = random.Random(hash((time.time(), idx, os.getpid())) & 0xffffffff)
        fails = 0
        while True:
            if datetime.now(timezone.utc) >= until:
                print(f"[fw] worker {idx} until reached", flush=True)
                return
            with lock:
                if over_budget():
                    print(f"[fw] worker {idx} budget ${day_spend():.3f}/${BUDGET}",
                          flush=True)
                    return
            text, usage, err = call_fw(key, make_prompt(rng))
            cost, pin, pout = usage_cost(usage)
            day = utc_day()
            with lock:
                state.setdefault("spend", {})
                state.setdefault("calls", {})
                state.setdefault("prompt_tokens", {})
                state.setdefault("completion_tokens", {})
                state["spend"][day] = state["spend"].get(day, 0.0) + cost
                state["calls"][day] = state["calls"].get(day, 0) + 1
                state["prompt_tokens"][day] = state["prompt_tokens"].get(day, 0) + pin
                state["completion_tokens"][day] = state["completion_tokens"].get(day, 0) + pout
                stats["calls"] += 1
                if text:
                    fails = 0
                    state["seq"] = int(state.get("seq", 0)) + 1
                    sid = f"fwgen:{state['seq']}"
                    process(text, sid)
                else:
                    stats["fail"] += 1
                    fails += 1
                    print(f"[fw] call-fail w{idx} {err}", flush=True)
                if stats["calls"] % 5 == 0:
                    persist_state()
                    print(f"[fw] kept={stats['kept']} fail={stats['fail']} "
                          f"lid={stats['lid_drop']} bleed={stats['bleed_drop']} "
                          f"spend=${day_spend():.3f}/{BUDGET} "
                          f"calls={state['calls'].get(day, 0)}", flush=True)
            if not text:
                time.sleep(min(20 * fails, 180))
            else:
                time.sleep(0.15)

    print(f"[fw] start model={MODEL} workers={WORKERS} budget=${BUDGET}/day "
          f"until={UNTIL} seq={state.get('seq', 0)} spend_today=${day_spend():.3f}",
          flush=True)
    if over_budget():
        print(f"[fw] already at budget ${day_spend():.3f}", flush=True)
        return 0
    threads = []
    for w in range(WORKERS):
        t = threading.Thread(target=worker, args=(w,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    persist_state()
    print(f"[FW DONE] {stats} spend=${day_spend():.4f} seq={state.get('seq')}",
          flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
