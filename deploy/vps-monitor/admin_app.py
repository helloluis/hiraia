#!/usr/bin/env python3
"""
hiraia mission control — /admin on hiraia.b11.dev

An instrument panel for RunPod training runs: live telemetry, loss curve, pod
inventory, push-button termination, and a run log for documenting progress.

Deliberate constraints:
  * stdlib only — no pip, no venv, nothing to drift or rot. It has to work on the
    worst night, not the best one.
  * binds 127.0.0.1 only; nginx terminates TLS and proxies /admin.
  * the RunPod API key never leaves the server; the browser only ever sees
    rendered numbers.
  * no LLM anywhere in the path.

Auth: single account, PBKDF2-SHA256 password hash (never plaintext on disk),
HMAC-signed session cookie (HttpOnly/Secure/SameSite=Strict), per-IP login
rate limiting, CSRF token on every state-changing POST.
"""
import hashlib, hmac, html, json, os, re, secrets, subprocess, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie

CONF = os.environ.get("HIRAIA_ADMIN_CONF", "/opt/hiraia-monitor/config.json")
STATE_DIR = os.environ.get("HIRAIA_MONITOR_STATE", "/var/lib/hiraia-monitor")
HEARTBEATS = os.path.join(STATE_DIR, "heartbeats.jsonl")
RUNS = os.path.join(STATE_DIR, "runs.jsonl")
NOTES = os.path.join(STATE_DIR, "notes.jsonl")
GREENLIGHT = os.path.join(STATE_DIR, "greenlight.json")
PODSCRIPTS = os.environ.get("HIRAIA_PODSCRIPTS", "/opt/hiraia-monitor/podscripts")
MONITOR_LOG = os.environ.get("HIRAIA_MONITOR_LOG", "/var/log/hiraia-monitor.log")
PORT = int(os.environ.get("ADMIN_PORT", "8135"))
MOUNT = os.environ.get("ADMIN_MOUNT", "/admin")  # absolute paths: /admin (no slash) must work too
SYNTH_DIR = os.environ.get("SYNTH_CEB_DIR", "/var/lib/synth-ceb")
SYNTH_HIST = os.path.join(SYNTH_DIR, "history.jsonl")
GROK_DOCS = os.path.join(SYNTH_DIR, "docs_ceb_grok.jsonl")
GROK_AUDIT = os.path.join(SYNTH_DIR, "docs_ceb_grok_all.jsonl")
TOK_PER_BYTE = 0.35   # measured Qwen3.5 ratio for Cebuano text (pool_ceb_v3)
_synth_cache = {"sig": None, "v": None, "hist_t": 0}
REST, GQL = "https://rest.runpod.io/v1", "https://api.runpod.io/graphql"
UA = "hiraia-admin/1.0"          # RunPod 403s urllib's default User-Agent
SESSION_HOURS = 72
_cfg_cache = {"t": 0, "v": {}}
_rate = {}                        # ip -> [failed_count, first_fail_ts]
_api_cache = {"t": 0, "v": None}  # throttle RunPod calls to <=1 per 10s


# ---------------------------------------------------------------- config/auth
def cfg():
    if time.time() - _cfg_cache["t"] > 20:
        try:
            with open(CONF) as f:
                _cfg_cache["v"] = json.load(f)
            _cfg_cache["t"] = time.time()
        except (OSError, json.JSONDecodeError):
            pass
    return _cfg_cache["v"]


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"pbkdf2_sha256$200000${salt}${dk.hex()}"


def verify_password(password, stored):
    try:
        algo, iters, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, AttributeError):
        return False


def sign_session(email, secret):
    exp = int(time.time()) + SESSION_HOURS * 3600
    body = f"{email}|{exp}"
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}|{sig}"


def valid_session(token, secret):
    try:
        email, exp, sig = token.split("|")
        expect = hmac.new(secret.encode(), f"{email}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
        return hmac.compare_digest(sig, expect) and int(exp) > time.time()
    except (ValueError, AttributeError):
        return False


def rate_limited(ip):
    n, first = _rate.get(ip, (0, 0))
    if n >= 8 and time.time() - first < 900:
        return True
    if time.time() - first > 900:
        _rate.pop(ip, None)
    return False


def note_failure(ip):
    n, first = _rate.get(ip, (0, 0))
    _rate[ip] = (n + 1, first or time.time())


# ------------------------------------------------------------------ data taps
def runpod(path, method="GET"):
    key = cfg().get("runpod_api_key", "")
    req = urllib.request.Request(f"{REST}/{path}", method=method,
                                 headers={"Authorization": f"Bearer {key}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        body = r.read().decode() or "{}"
    return json.loads(body) if body.strip() else {}


def gql(query):
    key = cfg().get("runpod_api_key", "")
    req = urllib.request.Request(GQL, data=json.dumps({"query": query}).encode(), headers={
        "Content-Type": "application/json", "User-Agent": UA, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)["data"]


def balance():
    me = gql("query { myself { clientBalance currentSpendPerHr } }")["myself"]
    return float(me["clientBalance"]), float(me.get("currentSpendPerHr") or 0)


def gpu_names():
    """REST /pods omits the GPU model; GraphQL has machine.gpuDisplayName."""
    try:
        pods = gql("query { myself { pods { id machine { gpuDisplayName } } } }")["myself"]["pods"]
        return {p["id"]: ((p.get("machine") or {}).get("gpuDisplayName") or "") for p in pods}
    except Exception:
        return {}


def tail_jsonl(path, limit=3000):
    out = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return out[-limit:]


def tail_text(path, n=60):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 24000))
            return f.read().decode(errors="replace").splitlines()[-n:]
    except OSError:
        return []


def pod_age_hours(pod, seen):
    for field in ("createdAt", "lastStatusChange"):
        raw = pod.get(field)
        if not raw:
            continue
        txt = str(raw)
        if "Rented by User:" in txt:
            txt = txt.split("Rented by User:", 1)[1].strip()
            try:
                t = datetime.strptime(txt[:24], "%a %b %d %Y %H:%M:%S").replace(tzinfo=timezone.utc)
                return (datetime.now(timezone.utc) - t).total_seconds() / 3600
            except ValueError:
                continue
        try:
            t = datetime.fromisoformat(txt.replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - t).total_seconds() / 3600
        except ValueError:
            continue
    return (time.time() - seen.get(pod["id"], time.time())) / 3600


def ceiling_for(name):
    limits = cfg().get("max_pod_hours", {})
    if name in limits:
        return float(limits[name])
    for pat, hrs in limits.items():
        if pat.endswith("*") and name.startswith(pat[:-1]):
            return float(hrs)
    return float(cfg().get("default_max_pod_hours", 6))


def synth_stats():
    """Synthetic-Cebuano pipeline telemetry (SYNTH-CEB-SPEC.md). The audit file
    grows without bound, so re-parse only when (size, mtime) changes."""
    docs = os.path.join(SYNTH_DIR, "docs_ceb.jsonl")
    audit = os.path.join(SYNTH_DIR, "docs_ceb_all.jsonl")
    queue = os.path.join(SYNTH_DIR, "queue.jsonl")
    state = os.path.join(SYNTH_DIR, "gen-state.json")
    if not os.path.exists(docs):
        return None
    try:
        sig = tuple((os.path.getsize(f), int(os.path.getmtime(f)))
                    for f in (docs, audit, queue, GROK_DOCS) if os.path.exists(f))
    except OSError:
        return None
    if _synth_cache["sig"] == sig and _synth_cache["v"]:
        out = dict(_synth_cache["v"])
    else:
        n_kept, lane_oc, lane_or = 0, 0, 0
        tok_oc = tok_or = 0
        try:
            with open(docs, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if not line.strip():
                        continue
                    n_kept += 1
                    try:
                        d = json.loads(line)
                        tb = len(d.get("text", "").encode("utf-8", "replace"))
                        is_oc = str(d.get("src_id", "")).startswith("ocgen:")
                    except json.JSONDecodeError:
                        tb, is_oc = 0, '"ocgen:' in line
                    if is_oc:
                        lane_oc += 1
                        tok_oc += tb
                    else:
                        lane_or += 1
                        tok_or += tb
        except OSError:
            pass
        lane_grok, tok_grok = 0, 0
        try:
            with open(GROK_DOCS, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if not line.strip():
                        continue
                    lane_grok += 1
                    try:
                        tok_grok += len(json.loads(line).get("text", "").encode("utf-8", "replace"))
                    except json.JSONDecodeError:
                        pass
        except OSError:
            pass
        verdicts = {}
        n_all = 0
        try:
            with open(audit, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if not line.strip():
                        continue
                    n_all += 1
                    try:
                        v = json.loads(line).get("verdict", "?")
                    except json.JSONDecodeError:
                        v = "?"
                    verdicts[v] = verdicts.get(v, 0) + 1
        except OSError:
            pass
        q_total = 0
        try:
            with open(queue, "rb") as f:
                q_total = sum(1 for _ in f)
        except OSError:
            pass
        out = {"kept": n_kept, "attempted": n_all, "verdicts": verdicts,
               "lane_oc": lane_oc, "lane_or": lane_or, "lane_grok": lane_grok,
               "tok_oc": round(tok_oc * TOK_PER_BYTE),
               "tok_or": round(tok_or * TOK_PER_BYTE),
               "tok_grok": round(tok_grok * TOK_PER_BYTE),
               "queue_total": q_total,
               "keep_pct": round(100 * n_kept / n_all, 1) if n_all else None}
        _synth_cache.update(sig=sig, v=dict(out))
    try:
        st = json.load(open(state))
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out["caps"] = {"oc": st.get("calls", {}).get(f"{day}:oc", 0),
                       "or": st.get("calls", {}).get(f"{day}:or", 0),
                       "oc_max": int(os.environ.get("CAP_OC", 2000)),
                       "or_max": int(os.environ.get("CAP_OR", 950))}
        out["gen_seq"] = st.get("gen_seq")
    except (OSError, json.JSONDecodeError, ValueError):
        out["caps"] = None
    try:
        out["service"] = subprocess.run(["systemctl", "is-active", "synth-ceb"],
                                        capture_output=True, timeout=8).stdout.decode().strip()
    except Exception:
        out["service"] = "unknown"
    try:
        out["last_doc_age_s"] = round(time.time() - os.path.getmtime(docs))
    except OSError:
        out["last_doc_age_s"] = None
    # rolling production history: one sample per >=5 min, for the rate + curve
    now = time.time()
    if now - _synth_cache["hist_t"] > 300:
        try:
            with open(SYNTH_HIST, "a") as f:
                f.write(json.dumps({"ts": now, "kept": out["kept"],
                                    "tok_oc": out["tok_oc"], "tok_or": out["tok_or"],
                                    "tok_grok": out["tok_grok"],
                                    "lane_grok": out["lane_grok"]}) + "\n")
            _synth_cache["hist_t"] = now
        except OSError:
            pass
    hist = tail_jsonl(SYNTH_HIST, 400)
    out["history"] = [{"ts": h.get("ts", 0), "kept": h.get("kept", 0),
                       "tok_oc": h.get("tok_oc"), "tok_or": h.get("tok_or"),
                       "tok_grok": h.get("tok_grok")} for h in hist]
    rate = None
    if len(hist) >= 2:
        span = hist[-1].get("ts", 0) - hist[0].get("ts", 0)
        grew = hist[-1].get("kept", 0) - hist[0].get("kept", 0)
        if span > 600:
            rate = round(grew / (span / 3600), 1)
    out["docs_per_hr"] = rate
    return out


PHASE_DEFS = [
    ("boot",        "Booting",      "Pod starting; environment preflight."),
    ("preprocess",  "Tokenizing",   "Converting the corpus to tokens. One-time \u2014 the training run reuses this cache."),
    ("packing",     "Packing",      "Bin-packing sequences into fixed-length blocks."),
    ("canary",      "Canary",       "Training a few steps to measure real s/it, which sizes the budget."),
    ("budget_hold", "Budget hold",  "Waiting for a spend decision \u2014 BILLING WHILE IDLE."),
    ("held",        "HELD",         "Deliberately paused for operator greenlight \u2014 BILLING WHILE IDLE."),
    ("train",       "Training",     "The real run. Checkpoints stream to the network volume."),
    ("eval",        "Eval",         "Scoring a checkpoint."),
    ("done",        "Done",         "Run finished."),
]
PHASE_ORDER = [x[0] for x in PHASE_DEFS]
PHASE_META = {k: {"label": l, "why": w} for k, l, w in PHASE_DEFS}


def phase_of(hb):
    """Which pipeline stage a heartbeat represents. An explicit `phase` field wins;
    otherwise fall back to `kind` so older senders keep working."""
    ph = (hb.get("phase") or "").strip().lower()
    if ph in PHASE_META:
        return ph
    k = (hb.get("kind") or "").strip().lower()
    if k in PHASE_META:
        return k
    if (hb.get("note", "") or "").lower().startswith("eval"):
        return "eval"
    return "train" if not k else "boot"


def greenlight_state():
    try:
        with open(GREENLIGHT) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"greenlight": False}


def set_greenlight(pod_id, by):
    """Arm the greenlight AND restore the guard ceiling in one action.

    These must not be separable. The ceiling was lowered to backstop a hold; if the
    run is greenlit while the ceiling is still low, Guard 1 terminates a healthy run
    mid-flight. Doing both here means the operator cannot forget the second half."""
    st = {"greenlight": True, "pod_id": pod_id, "ts": time.time(), "by": by}
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = GREENLIGHT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, indent=2)
    os.replace(tmp, GREENLIGHT)

    restored = None
    try:
        c = cfg()
        target = float(c.get("greenlight_restore_ceiling_h", 54))
        name = c.get("greenlight_pod_name", "hiraia-fullrun")
        if float(c.get("max_pod_hours", {}).get(name, 0)) < target:
            c["max_pod_hours"][name] = target
            c.pop("hold_mode_note", None)
            ctmp = CONF + ".tmp"
            with open(ctmp, "w") as f:
                json.dump(c, f, indent=2)
            json.load(open(ctmp))
            os.replace(ctmp, CONF)
            os.chmod(CONF, 0o600)
            _cfg_cache["t"] = 0
            restored = target
    except Exception as e:                      # never let this block the greenlight
        st["ceiling_error"] = str(e)
    st["ceiling_restored_h"] = restored
    try:
        with open(NOTES, "a") as f:
            f.write(json.dumps({"ts": time.time(), "text":
                f"GREENLIGHT armed from the dashboard by {by} for pod {pod_id}. "
                f"Guard ceiling restored to {restored}h." if restored else
                f"GREENLIGHT armed from the dashboard by {by} for pod {pod_id}. "
                f"Ceiling already adequate."}) + "\n")
    except OSError:
        pass
    return st


def gather(force=False):
    """One consolidated telemetry snapshot. RunPod calls are throttled so a
    browser left open on the dashboard can't hammer the API."""
    if not force and _api_cache["v"] and time.time() - _api_cache["t"] < 10:
        return _api_cache["v"]
    snap = {"ts": time.time(), "errors": []}
    try:
        pods = runpod("pods") or []
    except Exception as e:
        pods, snap["errors"] = [], snap["errors"] + [f"pod list: {e}"]
    try:
        seen = json.load(open(os.path.join(STATE_DIR, "state.json"))).get("first_seen", {})
    except (OSError, json.JSONDecodeError):
        seen = {}
    gnames = gpu_names() if pods else {}
    snap["pods"] = []
    for p in pods:
        age = round(pod_age_hours(p, seen), 2)
        ceil_h = ceiling_for(p.get("name", "?"))
        rate = float(p.get("costPerHr") or 0)
        snap["pods"].append({
            "id": p["id"], "name": p.get("name", "?"),
            "gpu": gnames.get(p["id"]) or (p.get("machine", {}) or {}).get("gpuTypeId")
                   or p.get("gpuTypeId") or "GPU",
            "gpu_count": p.get("gpuCount", 1),
            "vcpu": p.get("vcpuCount"),
            "ram_gb": p.get("memoryInGb"),
            "disk_gb": p.get("containerDiskInGb"),
            "vol_gb": p.get("volumeInGb") or 0,
            "vol_id": p.get("networkVolumeId") or "",
            "image": (p.get("imageName") or "").split("/")[-1],
            "cost": rate,
            "status": p.get("desiredStatus", "?"),
            "age_h": age,
            "ceiling_h": ceil_h,
            "spent": round(rate * age, 2),                       # burned so far
            "cost_at_ceiling": round(rate * ceil_h, 2),          # worst case if it runs to the ceiling
            "remaining_at_ceiling": round(rate * max(ceil_h - age, 0), 2),
        })
    snap["burn"] = round(sum(p["cost"] for p in snap["pods"]), 2)
    snap["spent_now"] = round(sum(p["spent"] for p in snap["pods"]), 2)
    snap["max_exposure"] = round(sum(p["cost_at_ceiling"] for p in snap["pods"]), 2)
    try:
        bal, spend = balance()
        snap["balance"], snap["spend"] = round(bal, 2), round(spend, 3)
        snap["runway_h"] = round(bal / spend, 1) if spend > 0.001 else None
    except Exception as e:
        snap["balance"] = snap["spend"] = snap["runway_h"] = None
        snap["errors"].append(f"balance: {e}")

    hbs = tail_jsonl(HEARTBEATS)
    snap["hb_count"] = len(hbs)
    live_ids = {p["id"] for p in snap["pods"]}
    latest_live, latest_any = None, None
    by_pod = {}
    def is_train(h):
        k = (h.get("kind") or "").lower()
        if k:
            return k == "train"
        return not (h.get("note", "") or "").lower().startswith("eval")
    all_hbs = hbs                       # every kind -- needed for phase reporting
    hbs = [h for h in hbs if is_train(h)]   # loss chart is training-only, deliberately
    for hb in hbs:                      # file order is chronological; last write wins
        step, loss = hb.get("step"), hb.get("loss")
        if isinstance(step, (int, float)) and isinstance(loss, (int, float)) and step > 0:
            by_pod.setdefault(hb.get("pod_id"), []).append(
                {"step": int(step), "loss": round(float(loss), 4),
                 "ts": hb.get("ts", 0), "pod": hb.get("pod_id"), "note": hb.get("note", "")})
        latest_any = hb
        if hb.get("pod_id") in live_ids:
            latest_live = hb
    latest = latest_live or latest_any  # prefer a running pod, else show the last run
    # ONE run per chart: mixing pods draws a meaningless zigzag. Sort by step so a
    # resumed/retried run can't fold back on itself either.
    focus = (latest or {}).get("pod_id")
    series = sorted(by_pod.get(focus, []), key=lambda p: p["step"])
    snap["focus_pod"] = focus
    # A curve from a DEAD pod next to a live pod reads as "training is fine" at 3am.
    # Label it explicitly instead of letting it masquerade as the current run.
    snap["focus_live"] = bool(focus and focus in live_ids)
    snap["focus_note"] = (latest or {}).get("note", "") if focus else ""
    snap["other_runs"] = [{"pod": k, "points": len(v)} for k, v in by_pod.items() if k != focus]
    snap["series"] = series[-1500:]
    if latest:
        age_s = time.time() - float(latest.get("ts", 0))
        total = latest.get("total_steps") or cfg().get("expected_total_steps") or 0
        step = latest.get("step") or 0
        sit = latest.get("sec_per_step")
        snap["training"] = {
            "step": step, "total": total, "loss": latest.get("loss"),
            "pct": round(100 * step / total, 1) if total else None,
            "sec_per_step": sit, "note": latest.get("note", ""),
            "pod_id": latest.get("pod_id"), "hb_age_s": round(age_s),
            "stale": age_s > 60 * float(cfg().get("heartbeat_stale_minutes", 20)),
            "eta_h": round((total - step) * float(sit) / 3600, 2) if (total and sit) else None,
        }
    else:
        snap["training"] = None
    # ---- CURRENT PHASE. The loss chart is training-only by design, but that used to
    # mean a non-training run showed as "IDLE" with no indication of what it was doing.
    # Useless precisely when nobody is available to ask. This reports every stage.
    focus_any = None
    for hb in all_hbs:
        if hb.get("pod_id") in live_ids:
            focus_any = hb.get("pod_id")
    if focus_any is None and all_hbs:
        focus_any = all_hbs[-1].get("pod_id")
    snap["phase"] = None
    ph_hbs = [h for h in all_hbs if h.get("pod_id") == focus_any] if focus_any else []
    if ph_hbs:
        cur = ph_hbs[-1]
        key = phase_of(cur)
        meta = PHASE_META.get(key, {"label": key, "why": ""})
        step = cur.get("step")
        step = float(step) if isinstance(step, (int, float)) else None
        total = cur.get("total_steps") or 0
        # rate/ETA measured from OUR receive timestamps, so it needs no pod cooperation
        same = [h for h in ph_hbs if phase_of(h) == key and isinstance(h.get("step"), (int, float))]
        same = same[-40:]
        rate = eta_s = None
        if len(same) >= 2:
            dt = float(same[-1].get("ts", 0)) - float(same[0].get("ts", 0))
            ds = float(same[-1]["step"]) - float(same[0]["step"])
            if dt > 0 and ds > 0:
                rate = ds / dt
                if total:
                    eta_s = max(0.0, (float(total) - float(same[-1]["step"])) / rate)
        age_s = time.time() - float(cur.get("ts", 0))
        snap["phase"] = {
            "key": key, "label": meta["label"], "why": meta["why"],
            "idx": PHASE_ORDER.index(key) if key in PHASE_ORDER else None,
            "order": PHASE_ORDER,
            "labels": [PHASE_META[k]["label"] for k in PHASE_ORDER],
            "step": step, "total": total or None,
            "pct": round(100.0 * step / total, 1) if (total and step is not None) else None,
            "rate_per_s": round(rate, 2) if rate else None,
            "eta_s": round(eta_s) if eta_s is not None else None,
            "note": cur.get("note", ""), "pod_id": focus_any,
            "hb_age_s": round(age_s),
            "stale": age_s > 60 * float(cfg().get("heartbeat_stale_minutes", 20)),
            "deadline_ts": cur.get("deadline_ts"),
        }

    try:
        snap["synth"] = synth_stats()
    except Exception as e:
        snap["synth"] = None; snap["errors"].append(f"synth: {e}")
    snap["greenlight"] = greenlight_state()
    snap["log"] = tail_text(MONITOR_LOG, 40)
    snap["runs"] = tail_jsonl(RUNS, 40)[::-1]
    snap["notes"] = tail_jsonl(NOTES, 60)[::-1]
    _api_cache.update(t=time.time(), v=snap)
    return snap


# --------------------------------------------------------------------- markup
CSS = """
:root{
  --bg:#0d0f0e; --panel:#141715; --panel-2:#191d1a; --line:#242926;
  --ink:#e6e4db; --ink-2:#9aa39a; --ink-3:#616a62;
  --signal:#ffb454; --signal-dim:#7a5622;
  --ok:#5fd08a; --warn:#ffb454; --crit:#ff6b5e; --cool:#6fb3e0;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink); min-height:100vh;
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:14px; line-height:1.5;
  background-image:
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,180,84,.06), transparent 60%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.012) 0 1px, transparent 1px 3px);
}
a{color:var(--signal);text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:20px 18px 64px}
header.top{
  display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;
  padding-bottom:14px;margin-bottom:20px;border-bottom:1px solid var(--line);
}
.brand{font-size:19px;letter-spacing:.14em;font-weight:600;text-transform:uppercase}
.brand em{font-style:normal;color:var(--signal)}
.sub{color:var(--ink-3);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase}
.spacer{flex:1}
.pill{
  display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:2px;
  border:1px solid var(--line);background:var(--panel);font-size:11.5px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);
}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ink-3);flex:none}
.dot.live{background:var(--ok);box-shadow:0 0 0 0 rgba(95,208,138,.7);animation:pulse 2.4s infinite}
.dot.warn{background:var(--warn)} .dot.crit{background:var(--crit)}
@keyframes pulse{70%{box-shadow:0 0 0 7px rgba(95,208,138,0)}100%{box-shadow:0 0 0 0 rgba(95,208,138,0)}}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:10px;margin-bottom:20px}
.tile{
  background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:13px 14px;
  position:relative;overflow:hidden;
}
.tile::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--signal-dim)}
.tile.hot::before{background:var(--crit)} .tile.good::before{background:var(--ok)}
.tile .k{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3)}
.tile .v{font-size:25px;line-height:1.15;margin-top:5px;font-weight:600;letter-spacing:-.01em}
.tile .v small{font-size:13px;font-weight:400;color:var(--ink-2);letter-spacing:0}
.tile .m{font-size:11px;color:var(--ink-3);margin-top:3px}
section{margin-bottom:22px}
h2{
  font-size:11.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-2);
  margin-bottom:9px;display:flex;align-items:center;gap:9px;
}
h2::after{content:'';flex:1;height:1px;background:var(--line)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:14px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{
  text-align:left;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);font-weight:500;padding:0 10px 8px 0;border-bottom:1px solid var(--line);
}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:none}
.mono-dim{color:var(--ink-3);font-size:11.5px}
.glbox{margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:2px;background:var(--panel-2)}
.glbox.armed{border-color:var(--ok);color:var(--ok);font-size:12.5px;letter-spacing:.06em}
.glsub{color:var(--ink-3);font-size:11.5px;margin-top:7px;letter-spacing:0}
button.go{background:var(--ok);border:1px solid var(--ok);color:#0d0f0e;font-weight:700;
  padding:10px 20px;border-radius:2px;cursor:pointer;font-size:13px;letter-spacing:.1em;
  text-transform:uppercase;font-family:inherit}
button.go:hover{background:#7fe0a4;border-color:#7fe0a4;color:#0d0f0e}
.histbar{background:rgba(255,107,94,.09);border:1px solid var(--crit);color:var(--crit);
  padding:9px 12px;border-radius:2px;font-size:12px;margin-bottom:12px;line-height:1.45}
.phase-strip{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:16px}
.pstep{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink-3);padding:4px 9px;border:1px solid var(--line);
  border-radius:2px;background:var(--panel)}
.pstep .pdot{width:6px;height:6px;border-radius:50%;background:var(--line);flex:none}
.pstep.done{color:var(--ok)} .pstep.done .pdot{background:var(--ok)}
.pstep.cur{color:var(--ink);border-color:var(--signal);background:var(--panel-2)}
.pstep.cur .pdot{background:var(--signal);box-shadow:0 0 0 3px rgba(255,180,84,.22)}
.pstep.hold{border-color:var(--crit);color:var(--crit)} .pstep.hold .pdot{background:var(--crit)}
.parrow{color:var(--line);font-size:12px}
.pnow{font-size:27px;font-weight:600;letter-spacing:-.4px;line-height:1.15}
.pnow.hot{color:var(--crit)}
.pwhy{color:var(--ink-2);font-size:12.5px;margin-top:5px}
.pnote{color:var(--ink-3);font-size:11.5px;margin-top:6px;word-break:break-word}
.pmeta{color:var(--ink-2);font-size:12px;margin-top:7px;letter-spacing:.04em}
.pnext{margin-top:12px;font-size:12.5px;color:var(--cool);border-top:1px solid var(--line);padding-top:10px}
.pnext.hot{color:var(--crit);font-weight:600}
.pfresh{margin-top:7px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.pfresh.hot{color:var(--crit)}
.bar.big{height:12px;margin-top:12px}
.bar{height:4px;background:var(--panel-2);border-radius:2px;overflow:hidden;margin-top:5px;min-width:72px}
.bar span{display:block;height:100%;background:var(--signal)}
.bar span.hot{background:var(--crit)}
button{
  font-family:inherit;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;
  background:transparent;color:var(--crit);border:1px solid var(--crit);
  padding:6px 12px;border-radius:2px;cursor:pointer;transition:background .15s,color .15s;
}
button:hover{background:var(--crit);color:#12100f}
button.ghost{color:var(--ink-2);border-color:var(--line)}
button.ghost:hover{background:var(--line);color:var(--ink)}
button:disabled{opacity:.4;cursor:not-allowed}
.log{
  font-size:11.5px;line-height:1.75;color:var(--ink-2);max-height:270px;overflow:auto;
  white-space:pre-wrap;word-break:break-word;
}
.log .l-term{color:var(--crit)} .log .l-notify{color:var(--warn)} .log .l-bal{color:var(--cool)}
.empty{color:var(--ink-3);font-size:12px;padding:6px 0}
.chart{width:100%;height:250px;display:block}
.chart text{font-family:'IBM Plex Mono',monospace;font-size:10px;fill:var(--ink-3)}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .ln{fill:none;stroke:var(--signal);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .area{fill:url(#g);opacity:.5}
.chart .pt{fill:var(--signal)}
.chart .lbl{fill:var(--ink);font-size:11.5px;font-weight:600}
form.note{display:flex;gap:8px;margin-top:11px}
input[type=text],input[type=email],input[type=password]{
  font-family:inherit;font-size:13px;background:var(--panel-2);border:1px solid var(--line);
  color:var(--ink);padding:9px 11px;border-radius:2px;width:100%;
}
input:focus{outline:none;border-color:var(--signal-dim)}
form.note button{color:var(--signal);border-color:var(--signal-dim);white-space:nowrap}
form.note button:hover{background:var(--signal);color:#12100f}
.login{max-width:355px;margin:14vh auto;padding:0 18px}
.login .panel{padding:26px}
.login h1{font-size:17px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:5px}
.login p{color:var(--ink-3);font-size:11.5px;margin-bottom:19px;letter-spacing:.06em}
.login label{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);margin:13px 0 5px}
.login button{width:100%;margin-top:19px;color:var(--signal);border-color:var(--signal-dim);padding:10px}
.login button:hover{background:var(--signal);color:#12100f}
.err{color:var(--crit);font-size:11.5px;margin-top:13px}
.foot{color:var(--ink-3);font-size:11px;letter-spacing:.06em;margin-top:26px;
  padding-top:14px;border-top:1px solid var(--line)}
@media(max-width:640px){
  .wrap{padding:14px 12px 48px} .tile .v{font-size:21px}
  table{font-size:11.5px} .hide-sm{display:none}
}
"""

HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>__TITLE__</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>__CSS__</style></head><body data-mount="__MOUNT__">"""

JS = r"""
const $ = s => document.querySelector(s);
const MOUNT = (document.body.dataset.mount || "/admin");
const asOf = ts => new Date(ts*1000).toLocaleString('en-US',{timeZone:'Asia/Manila',
  month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})
  .replace(',','') + ' GMT+8';
const fmt = (n,d=2) => (n===null||n===undefined||isNaN(n)) ? '--' : Number(n).toFixed(d);
const esc = t => String(t===null||t===undefined?'':t).replace(/[<>&"]/g,
  c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const fmtDur = s => {
  if(s===null||s===undefined||isNaN(s)) return '--';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  if(h>=1) return h+'h '+String(m).padStart(2,'0')+'m';
  if(m>=1) return m+'m '+String(s%60).padStart(2,'0')+'s';
  return s+'s';
};
const num = v => (v===null||v===undefined) ? '--' : Number(v).toLocaleString();
const CSRF = (document.querySelector('input[name=csrf]') || {}).value || '';

function tile(k,v,m,cls){
  return `<div class="tile ${cls||''}"><div class="k">${k}</div><div class="v">${v}</div>`+
         `<div class="m">${m||''}</div></div>`;
}

function renderTiles(s){
  const t = s.training, out = [];
  if (t){
    out.push(tile('Step', `${t.step}<small>${t.total?'/'+t.total:''}</small>`,
      t.pct!==null?`${t.pct}% complete`:'', 'good'));
    out.push(tile('Loss', fmt(t.loss,3), t.note||'training loss'));
    out.push(tile('Pace', t.sec_per_step?`${fmt(t.sec_per_step,1)}<small>s/step</small>`:'--',
      t.eta_h!==null&&t.eta_h!==undefined?`~${fmt(t.eta_h,1)}h remaining`:''));
    out.push(tile('Heartbeat', t.stale?'STALE':'LIVE', `${t.hb_age_s}s ago`,
      t.stale?'hot':'good'));
  } else {
    const p = s.phase;
    out.push(p ? tile('Stage', esc(p.label),
                      p.pct!==null&&p.pct!==undefined ? p.pct+'% of this stage' : 'no progress metric',
                      (p.key==='held'||p.key==='budget_hold')?'hot':'good')
               : tile('Training','IDLE','no active heartbeat'));
  }
  out.push(tile('Burn', `$${fmt(s.burn)}<small>/hr</small>`,
    `${s.pods.length} pod${s.pods.length===1?'':'s'} running`, s.burn>10?'hot':''));
  out.push(tile('Balance', s.balance===null?'--':`$${fmt(s.balance)}`,
    s.runway_h?`~${fmt(s.runway_h,0)}h runway`:'', (s.balance!==null&&s.balance<60)?'hot':''));
  $('#tiles').innerHTML = out.join('');
}

function renderPhase(s){
  const sec = document.querySelector('#phase-sec'), p = s.phase;
  if(!p){ sec.style.display='none'; return; }
  sec.style.display='';
  const strip = p.order.map((k,i)=>{
    const cur = (k===p.key), done = (p.idx!==null && i<p.idx);
    const hold = cur && (k==='held' || k==='budget_hold');
    return '<div class="pstep'+(cur?' cur':'')+(done?' done':'')+(hold?' hold':'')+
           '"><span class="pdot"></span>'+esc(p.labels[i])+'</div>';
  }).join('<span class="parrow">&rsaquo;</span>');

  let bar = '';
  if(p.pct!==null && p.pct!==undefined){
    const w = Math.max(0, Math.min(100, p.pct));
    bar = '<div class="bar big"><span'+(p.stale?' class="hot"':'')+' style="width:'+w.toFixed(1)+'%"></span></div>'+
          '<div class="pmeta">'+num(p.step)+' / '+num(p.total)+' &middot; '+p.pct+'%'+
          (p.eta_s!==null&&p.eta_s!==undefined ? ' &middot; ~'+fmtDur(p.eta_s)+' left' : '')+
          (p.rate_per_s ? ' &middot; '+(p.rate_per_s>=1 ? num(Math.round(p.rate_per_s))+'/s'
                                            : fmt(1/p.rate_per_s,1)+'s per step') : '')+'</div>';
  }

  const g = s.greenlight || {};
  const waiting = (p.key==='held' || p.key==='budget_hold');
  let gl = '';
  if(g.greenlight){
    gl = '<div class="glbox armed">GREENLIGHT ARMED'+(g.by?' by '+esc(g.by):'')+
         (g.ts?' &middot; '+asOf(g.ts):'')+
         (g.ceiling_restored_h?' &middot; ceiling restored to '+g.ceiling_restored_h+'h':'')+
         '<div class="glsub">The pod polls every 30s and starts training on its own. No LLM involved.</div></div>';
  } else if(waiting){
    gl = '<div class="glbox"><button class="go" onclick="armGreenlight(\''+esc(p.pod_id)+'\')">'+
         'Greenlight &mdash; start training</button>'+
         '<div class="glsub">Cancels the dead-man, restores the 54h guard ceiling, and launches the run. '+
         'Works with no LLM in the path.</div></div>';
  }

  let next = '';
  if(p.deadline_ts){
    const left = p.deadline_ts - (Date.now()/1000);
    next = '<div class="pnext hot">Auto-terminates in '+fmtDur(left)+' ('+asOf(p.deadline_ts)+
           ') unless greenlit</div>';
  } else if(p.eta_s!==null && p.eta_s!==undefined){
    next = '<div class="pnext">This stage should finish around '+asOf(s.ts + p.eta_s)+'</div>';
  }

  document.querySelector('#phase-body').innerHTML =
    '<div class="phase-strip">'+strip+'</div>'+
    '<div class="pnow'+(p.stale?' hot':'')+'">'+esc(p.label)+(p.stale?' &mdash; TELEMETRY STALE':'')+'</div>'+
    '<div class="pwhy">'+esc(p.why)+'</div>'+
    (p.note ? '<div class="pnote">'+esc(p.note)+'</div>' : '')+
    bar + next + gl +
    '<div class="pfresh'+(p.stale?' hot':'')+'">telemetry '+fmtDur(p.hb_age_s)+' old &middot; pod '+esc(p.pod_id||'--')+'</div>';
}

function renderChart(series, s){
  const el = $('#chart');
  if(!series.length){ el.innerHTML = '<div class="empty">No heartbeat telemetry yet — the loss curve appears once a run starts posting.</div>'; return; }
  let banner = '';
  if(s && s.focus_pod && !s.focus_live){
    const now = s.phase ? (' The live pod is '+esc(s.phase.label).toLowerCase()+
                (s.phase.pct!==null&&s.phase.pct!==undefined?' ('+s.phase.pct+'%)':'')+'.') : '';
    banner = '<div class="histbar">Historical &mdash; this curve is from pod '+esc(s.focus_pod)+
             (s.focus_note?' ('+esc(s.focus_note)+')':'')+', which is no longer running.'+now+
             ' It is NOT the current run.</div>';
  }
  const W=1000,H=250,ml=52,mr=14,mt=16,mb=30;
  const xs=series.map(p=>p.step), ys=series.map(p=>p.loss);
  const x0=Math.min(...xs), x1=Math.max(...xs,x0+1);
  let y0=Math.min(...ys), y1=Math.max(...ys); const pad=(y1-y0)*0.12||0.1; y0-=pad; y1+=pad;
  const X=v=>ml+(v-x0)/(x1-x0)*(W-ml-mr), Y=v=>mt+(1-(v-y0)/(y1-y0))*(H-mt-mb);
  const d=series.map((p,i)=>`${i?'L':'M'}${X(p.step).toFixed(1)},${Y(p.loss).toFixed(1)}`).join('');
  const area=`M${X(series[0].step).toFixed(1)},${(H-mb).toFixed(1)}`+
    series.map(p=>`L${X(p.step).toFixed(1)},${Y(p.loss).toFixed(1)}`).join('')+
    `L${X(series[series.length-1].step).toFixed(1)},${(H-mb).toFixed(1)}Z`;
  let g='';
  for(let i=0;i<=4;i++){ const v=y0+(y1-y0)*i/4, y=Y(v).toFixed(1);
    g+=`<line class="grid" x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}"/>`+
       `<text x="${ml-8}" y="${(+y+3.5).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text>`; }
  for(let i=0;i<=4;i++){ const v=x0+(x1-x0)*i/4;
    g+=`<text x="${X(v).toFixed(1)}" y="${H-9}" text-anchor="middle">${Math.round(v)}</text>`; }
  const last=series[series.length-1];
  const lx=X(last.step), ly=Y(last.loss), flip=lx>W-140;
  el.innerHTML=banner+`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
    aria-label="Training loss by optimizer step">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffb454" stop-opacity=".26"/>
      <stop offset="100%" stop-color="#ffb454" stop-opacity="0"/></linearGradient></defs>
    ${g}<path class="area" d="${area}"/><path class="ln" d="${d}"/>
    <circle class="pt" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4"/>
    <text class="lbl" x="${(flip?lx-10:lx+10).toFixed(1)}" y="${(ly-9).toFixed(1)}"
      text-anchor="${flip?'end':'start'}">${last.loss.toFixed(3)}</text></svg>
    <div class="mono-dim" style="margin-top:6px">loss vs optimizer step · ${series.length} samples
      · <strong>as of ${asOf(last.ts || Date.now()/1000)}</strong></div>`;
}

function renderPods(s){
  if(!s.pods.length){ $('#pods').innerHTML='<div class="empty">No pods running. Nothing is billing.</div>'; return; }
  const rows = s.pods.map(p=>{
    const pct=Math.min(100,100*p.age_h/p.ceiling_h), hot=pct>80;
    const gpu = `${p.gpu_count>1?p.gpu_count+'&times; ':''}${(p.gpu||'GPU').replace('NVIDIA ','')}`;
    const disk = `${p.disk_gb||'?'}GB disk${p.vol_id?' + vol':''}`;
    return `<tr>
      <td><strong>${p.name}</strong><div class="mono-dim">${p.id}</div></td>
      <td><strong>${gpu}</strong><div class="mono-dim hide-sm">${p.image||''}</div></td>
      <td class="hide-sm">${p.vcpu||'?'} vCPU<div class="mono-dim">${p.ram_gb||'?'}GB RAM<br>${disk}</div></td>
      <td>$${p.cost.toFixed(2)}<span class="mono-dim">/hr</span>
        <div class="mono-dim">$${p.spent.toFixed(2)} spent</div>
        <div class="mono-dim" title="what this pod costs if it runs to its ceiling">
          <span style="color:var(--signal)">$${p.cost_at_ceiling.toFixed(2)}</span> at ceiling</div></td>
      <td>${p.age_h.toFixed(1)}h<div class="mono-dim">ceiling ${p.ceiling_h}h</div>
        <div class="bar"><span class="${hot?'hot':''}" style="width:${pct.toFixed(0)}%"></span></div></td>
      <td><button onclick="killPod('${p.id}','${p.name}')">Terminate</button></td></tr>`;
  }).join('');
  const foot = `<div class="mono-dim" style="margin-top:11px;padding-top:9px;border-top:1px solid var(--line)">
    burn <strong>$${s.burn.toFixed(2)}/hr</strong> &nbsp;·&nbsp; spent so far <strong>$${(s.spent_now||0).toFixed(2)}</strong>
    &nbsp;·&nbsp; max exposure if every pod runs to its ceiling
    <strong style="color:var(--signal)">$${(s.max_exposure||0).toFixed(2)}</strong>
    ${s.balance!==null?` &nbsp;of&nbsp; $${s.balance.toFixed(2)} balance`:''}</div>`;
  $('#pods').innerHTML=`<table><thead><tr><th>Pod</th><th>GPU</th><th class="hide-sm">CPU / RAM / disk</th>
    <th>Cost</th><th>Age / ceiling</th><th></th></tr></thead><tbody>${rows}</tbody></table>${foot}`;
}

function renderLog(s){
  const cls = l => l.includes('TERMINATED')||l.includes('FAILED') ? 'l-term'
    : l.includes('NOTIFY')||l.includes('LOW BALANCE') ? 'l-notify'
    : l.includes('balance $') ? 'l-bal' : '';
  $('#log').innerHTML = s.log.length
    ? s.log.map(l=>`<div class="${cls(l)}">${l.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>`).reverse().join('')
    : '<div class="empty">Guard log is empty — the monitor timer writes here every 5 minutes.</div>';
}

function renderNotes(s){
  $('#notes').innerHTML = s.notes.length
    ? s.notes.map(n=>`<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <span class="mono-dim">${new Date(n.ts*1000).toLocaleString()}</span><br>${
        (n.text||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>`).join('')
    : '<div class="empty">No entries yet. Log what happened, so the next run inherits it.</div>';
}

function renderSynth(s){
  const x = s.synth;
  if(!x){ $('#synth-sec').style.display='none'; return; }
  $('#synth-sec').style.display='';
  const hdr = document.querySelector('#synth-sec h2');
  if(hdr) hdr.innerHTML = 'Synthetic Cebuano &mdash; Ox Alpha window '+
    `<span style="color:var(--ink-3);letter-spacing:.06em;text-transform:none">as of ${asOf(s.ts)}</span>`;
  const stale = x.last_doc_age_s!==null && x.last_doc_age_s > 3600;
  const up = (x.service||'').startsWith('active');
  $('#synth-tiles').innerHTML = [
    tile('Banked', x.kept, `${x.attempted} attempted`, 'good'),
    tile('Rate', x.docs_per_hr!==null&&x.docs_per_hr!==undefined?`${x.docs_per_hr}<small>/hr</small>`:'--',
         x.last_doc_age_s!==null?`last doc ${x.last_doc_age_s<3600?Math.round(x.last_doc_age_s/60)+'m':(x.last_doc_age_s/3600).toFixed(1)+'h'} ago`:'',
         stale?'hot':''),
    tile('QC keep', x.keep_pct!==null?`${x.keep_pct}<small>%</small>`:'--',
         Object.entries(x.verdicts||{}).filter(([k])=>k!=='ok').map(([k,v])=>`${k} ${v}`).join(' · ')||'no rejects'),
    tile('Generator', up?'RUNNING':(x.service||'?').toUpperCase(), up?'supervisor alive':'not running', up?'good':'hot'),
  ].join('');
  const caps = x.caps||{};
  const capBar = (lbl,used,max) => {
    const pct = max?Math.min(100,100*used/max):0;
    return `<div style="margin:9px 0"><div class="mono-dim">${lbl} &nbsp;${used}/${max} calls today</div>
      <div class="bar"><span class="${pct>90?'hot':''}" style="width:${pct.toFixed(0)}%"></span></div></div>`;
  };
  // cumulative production curve from the rolling history
  let curve = '<div class="empty">Production curve appears after ~10 minutes of samples.</div>';
  const h = (x.history||[]).filter(p=>p.kept>0);
  if(h.length>1){
    const W=1000,H=140,ml=52,mr=14,mt=12,mb=24;
    const t0=h[0].ts,t1=Math.max(h[h.length-1].ts,t0+1);
    let y0=Math.min(...h.map(p=>p.kept)), y1=Math.max(...h.map(p=>p.kept));
    if(y1===y0){y1=y0+1;}
    const X=v=>ml+(v-t0)/(t1-t0)*(W-ml-mr), Y=v=>mt+(1-(v-y0)/(y1-y0))*(H-mt-mb);
    const d=h.map((p,i)=>`${i?'L':'M'}${X(p.ts).toFixed(1)},${Y(p.kept).toFixed(1)}`).join('');
    let g='';
    for(let i=0;i<=2;i++){ const v=y0+(y1-y0)*i/2, y=Y(v).toFixed(1);
      g+=`<line class="grid" x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}"/>`+
         `<text x="${ml-8}" y="${(+y+3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`;}
    const hrs=((t1-t0)/3600).toFixed(1);
    curve=`<svg class="chart" style="height:140px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
      role="img" aria-label="Cebuano documents banked over time">${g}<path class="ln" d="${d}"/></svg>
      <div class="mono-dim">documents banked · last ${hrs}h · <strong>as of ${asOf(s.ts)}</strong></div>`;
  }
  // daily contributions, stacked by lane, in estimated tokens (history deltas)
  let bars = '';
  const hh = (x.history||[]).filter(p=>p.tok_oc!=null);
  if(hh.length>1){
    const day = ts => new Date(ts*1000).toISOString().slice(5,10);
    const buckets = [];
    for(const p of hh){
      const k = day(p.ts);
      const last = buckets[buckets.length-1];
      if(last && last.k===k){ last.end=p; } else buckets.push({k, start:p, end:p});
    }
    const rows = buckets.map(b=>({k:b.k,
      oc:Math.max(0,(b.end.tok_oc||0)-(b.start.tok_oc||0)),
      or:Math.max(0,(b.end.tok_or||0)-(b.start.tok_or||0)),
      grok:Math.max(0,(b.end.tok_grok||0)-(b.start.tok_grok||0))}));
    const W=1000,H=170,ml=52,mr=14,mt=12,mb=26;
    const maxV = Math.max(1,...rows.map(r=>r.oc+r.or+r.grok));
    const bw = Math.min(90,(W-ml-mr)/rows.length*0.6), step=(W-ml-mr)/rows.length;
    const LANS=[['oc','#5eb1ef','OC gen'],['or','#a78bfa','OR xlate'],['grok','#34d399','Grok']];
    let g='';
    for(let i=0;i<=2;i++){ const v=maxV*i/2, y=(mt+(1-i/2)*(H-mt-mb)).toFixed(1);
      g+=`<line class="grid" x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}"/>`+
         `<text x="${ml-8}" y="${(+y+3.5).toFixed(1)}" text-anchor="end">${v>=1000?(v/1000).toFixed(0)+'k':Math.round(v)}</text>`;}
    rows.forEach((r,i)=>{
      let y0=H-mb; const x=(ml+i*step+(step-bw)/2).toFixed(1);
      for(const [key,col] of LANS){
        const hh2=(r[key]/maxV)*(H-mt-mb); if(hh2<=0) continue;
        y0-=hh2;
        g+=`<rect x="${x}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh2.toFixed(1)}" fill="${col}"/>`;
      }
      g+=`<text x="${(+x+bw/2).toFixed(1)}" y="${H-mb+14}" text-anchor="middle">${r.k}</text>`;
    });
    const legend = LANS.map(([k,c,l])=>`<span style="color:${c}">■</span> ${l}`).join(' &nbsp; ');
    bars=`<div style="margin-top:16px"><div class="mono-dim" style="margin-bottom:6px">
      EST. TOKENS PER DAY (chars × 0.35) &nbsp; ${legend}</div>
      <svg class="chart" style="height:170px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
        role="img" aria-label="Estimated tokens produced per day by lane">${g}</svg></div>`;
  }
  $('#synth-body').innerHTML = `
    <div style="display:flex;gap:26px;flex-wrap:wrap;margin-bottom:11px">
      <div><div class="mono-dim">LANE SPLIT (docs · est. tokens)</div>
        <div style="font-size:15px">OC gen <strong>${x.lane_oc}</strong> · ${(x.tok_oc||0).toLocaleString()} tok
          &nbsp;·&nbsp; OR xlate <strong>${x.lane_or}</strong> · ${(x.tok_or||0).toLocaleString()} tok
          &nbsp;·&nbsp; Grok <strong>${x.lane_grok||0}</strong> · ${(x.tok_grok||0).toLocaleString()} tok</div></div>
      <div><div class="mono-dim">QUEUE</div>
        <div style="font-size:15px"><strong>${x.queue_total}</strong> chunks</div></div>
      <div><div class="mono-dim">GEN SEQ</div>
        <div style="font-size:15px"><strong>${x.gen_seq!==undefined&&x.gen_seq!==null?x.gen_seq:'--'}</strong></div></div>
    </div>
    ${capBar('OpenCode (generation)', caps.oc||0, caps.oc_max||2000)}
    ${capBar('OpenRouter (translation)', caps['or']||0, caps.or_max||950)}
    <div style="margin-top:13px">${curve}</div>${bars}`;
}

async function armGreenlight(id){
  if(!confirm('GREENLIGHT the training run?\n\npod '+id+'\n\nThis will:\n'+
     '  1. cancel the pod\'s auto-terminate dead-man\n'+
     '  2. restore the guard cost ceiling to 54h\n'+
     '  3. start the full CPT run on the budget already recorded\n\n'+
     'The pod will then bill ~$26/hr for roughly 42 hours. It self-terminates when the\n'+
     'budgeted steps are done. You can still stop it any time with Terminate below.')) return;
  const r = await fetch(MOUNT+'/api/greenlight',{method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({pod_id:id,csrf:CSRF})});
  const j = await r.json().catch(()=>({error:'bad response'}));
  if(j.error){ alert('Failed: '+j.error); return; }
  alert('GREENLIGHT armed.'+(j.ceiling_restored_h?('\nGuard ceiling restored to '+j.ceiling_restored_h+'h.'):'')+
        '\n\nThe pod polls every 30s, so training starts within a minute.');
  refresh(true);
}

async function killPod(id,name){
  if(!confirm(`Terminate ${name}?\n\n${id}\n\nThis is immediate and irreversible. Checkpoints already written to a network volume survive; anything only on the pod's local disk does not.`)) return;
  const r = await fetch(MOUNT+'/api/terminate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pod_id:id,csrf:CSRF})});
  const j = await r.json().catch(()=>({error:'bad response'}));
  if(j.error) alert('Failed: '+j.error); else refresh(true);
}

async function refresh(force){
  try{
    const r = await fetch(MOUNT+'/api/status'+(force?'?force=1':''));
    if(r.status===401){ location.href=MOUNT+'/login'; return; }
    const s = await r.json();
    renderTiles(s); renderPhase(s); renderChart(s.series, s); renderPods(s); renderSynth(s); renderLog(s); renderNotes(s);
    const t=s.training, ph=s.phase;
    const stale = ph ? ph.stale : (t ? t.stale : false);
    const hold = ph && (ph.key==='held' || ph.key==='budget_hold');
    $('#status-dot').className = 'dot '+(!s.pods.length ? '' : (stale?'crit':(hold?'warn':'live')));
    $('#status-txt').textContent = !s.pods.length ? 'idle'
      : stale ? 'telemetry stale'
      : ph ? (ph.label + (ph.pct!==null&&ph.pct!==undefined ? ' '+ph.pct+'%' : ''))
      : 'pods up';
    $('#updated').textContent = new Date(s.ts*1000).toLocaleTimeString();
    if(s.errors && s.errors.length) $('#errors').textContent = s.errors.join(' · ');
    else $('#errors').textContent = '';
  }catch(e){ $('#status-txt').textContent='connection lost'; $('#status-dot').className='dot crit'; }
}
refresh(); setInterval(refresh, 15000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh(); });
"""


def page_dashboard(csrf):
    body = """
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">Hiraia <em>//</em> Mission Control</div>
      <div class="sub">RunPod training telemetry &amp; kill switch</div>
    </div>
    <div class="spacer"></div>
    <span class="pill"><span class="dot" id="status-dot"></span><span id="status-txt">connecting</span></span>
    <span class="pill">upd <span id="updated">--</span></span>
    <form method="post" action="__MOUNT__/logout" style="display:inline">
      <input type="hidden" name="csrf" value="__CSRF__">
      <button class="ghost" type="submit">Sign out</button>
    </form>
  </header>
  <div class="err" id="errors"></div>
  <div class="tiles" id="tiles"></div>
  <section id="phase-sec" style="display:none"><h2>Where the run is right now</h2>
    <div class="panel" id="phase-body"></div></section>
  <section><h2>Loss curve</h2><div class="panel" id="chart"></div></section>
  <section><h2>Pods &amp; kill switch</h2><div class="panel" id="pods"></div></section>
  <section id="synth-sec" style="display:none"><h2>Synthetic Cebuano &mdash; Ox Alpha window</h2>
    <div class="tiles" id="synth-tiles"></div>
    <div class="panel" id="synth-body"></div></section>
  <section><h2>Run log</h2><div class="panel">
    <div id="notes"></div>
    <form class="note" method="post" action="__MOUNT__/note">
      <input type="hidden" name="csrf" value="__CSRF__">
      <input type="text" name="text" placeholder="Record what happened — decisions, verdicts, surprises" required>
      <button type="submit">Log it</button>
    </form>
  </div></section>
  <section><h2>Guard activity</h2><div class="panel"><div class="log" id="log"></div></div></section>
  <div class="foot">
    Guard runs every 5&nbsp;min on this VPS · cost ceiling is unconditional · no LLM in this path.
  </div>
</div>
<script>__JS__</script></body></html>"""
    head = HEAD.replace("__TITLE__", "Hiraia // Mission Control").replace("__CSS__", CSS)
    return (head + body).replace("__CSRF__", csrf).replace("__MOUNT__", MOUNT).replace("__JS__", JS)


def page_login(error=""):
    body = """
<div class="login">
  <div class="panel">
    <h1>Hiraia Control</h1>
    <p>Authorised access only</p>
    <form method="post" action="__MOUNT__/login">
      <label for="e">Email</label>
      <input id="e" type="email" name="email" autocomplete="username" required autofocus>
      <label for="p">Password</label>
      <input id="p" type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      __ERR__
    </form>
  </div>
</div></body></html>"""
    head = HEAD.replace("__TITLE__", "Sign in // Hiraia").replace("__CSS__", CSS)
    err = f'<div class="err">{html.escape(error)}</div>' if error else ""
    return (head + body).replace("__ERR__", err).replace("__MOUNT__", MOUNT)


# ---------------------------------------------------------------------- serve
class Handler(BaseHTTPRequestHandler):
    server_version = "hiraia-admin"

    def _ip(self):
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        raw = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def _json(self, code, obj, extra=None):
        self._send(code, json.dumps(obj), "application/json", extra)

    def _redirect(self, to, extra=None):
        self._send(302, "", "text/plain", [("Location", to)] + (extra or []))

    def _session_ok(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        tok = c["hiraia_sess"].value if "hiraia_sess" in c else ""
        return valid_session(tok, cfg().get("session_secret", ""))

    def _csrf(self):
        secret = cfg().get("session_secret", "")
        return hmac.new(secret.encode(), b"csrf", hashlib.sha256).hexdigest()[:32]

    def _path(self):
        p = urllib.parse.urlparse(self.path)
        return re.sub(r"^" + re.escape(MOUNT), "", p.path).rstrip("/") or "/", urllib.parse.parse_qs(p.query)

    def do_GET(self):
        path, q = self._path()
        if path == "/health":
            return self._send(200, "ok", "text/plain")
        if path == "/login":
            return self._send(200, page_login())
        if path == "/api/greenlight":
            # the POD polls this; it authenticates with the heartbeat token, not a session
            if self.headers.get("X-Token") != cfg().get("hb_token", "\0"):
                return self._json(403, {"error": "bad token"})
            return self._json(200, greenlight_state())
        if path in ("/api/bootstrap", "/api/launcher", "/api/hbvals"):
            # A freshly-created pod fetches its own setup over HTTPS. This is why nothing has
            # to be pre-staged on the volume (which needs a pod to write to -- chicken and egg)
            # and why no SSH private key has to live on this internet-facing box.
            if self.headers.get("X-Token") != cfg().get("hb_token", "\0"):
                return self._json(403, {"error": "bad token"})
            fn = {"/api/bootstrap": "bootstrap.sh", "/api/launcher": "launcher.sh",
                  "/api/hbvals": "hbvals.py"}[path]
            try:
                body = open(os.path.join(PODSCRIPTS, fn)).read()
            except OSError as e:
                return self._json(404, {"error": f"{fn}: {e}"})
            c = cfg()
            body = (body.replace("__RUNPOD_KEY__", c.get("runpod_api_key", ""))
                        .replace("__HB_TOKEN__", c.get("hb_token", ""))
                        .replace("__HF_TOKEN__", c.get("hf_token", "")))
            return self._send(200, body, "text/plain; charset=utf-8")
        if not self._session_ok():
            if path.startswith("/api/"):
                return self._json(401, {"error": "unauthenticated"})
            return self._redirect(f"{MOUNT}/login")
        if path == "/":
            return self._send(200, page_dashboard(self._csrf()))
        if path == "/api/export":
            fmt = (q.get("format", ["md"])[0] or "md").lower()
            notes = tail_jsonl(NOTES, 10000)
            runs = tail_jsonl(RUNS, 500)
            if fmt == "json":
                return self._json(200, {"exported": datetime.now(timezone.utc).isoformat(),
                                        "notes": notes, "runs": runs})
            lines = ["# Hiraia run log",
                     "",
                     f"_Exported {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
                     f"from https://hiraia.b11.dev/admin — {len(notes)} entries._",
                     "",
                     "Newest first. This file is the durable copy; the dashboard is the capture surface.",
                     ""]
            for n in sorted(notes, key=lambda x: -x.get("ts", 0)):
                ts = datetime.fromtimestamp(n.get("ts", 0), timezone.utc)
                lines.append(f"### {ts.strftime('%Y-%m-%d %H:%M UTC')}")
                lines.append("")
                lines.append(n.get("text", "").strip())
                lines.append("")
            body = "\n".join(lines)
            return self._send(200, body, "text/markdown; charset=utf-8",
                              [("Content-Disposition", 'attachment; filename="hiraia-run-log.md"')])

        if path == "/api/status":
            try:
                return self._json(200, gather(force=bool(q.get("force"))))
            except Exception as e:
                return self._json(500, {"error": str(e)})
        self._send(404, "not found", "text/plain")

    def do_POST(self):
        path, _ = self._path()
        cap = 4 * 1024 * 1024 if path == "/api/synth-grok" else 65536
        n = min(int(self.headers.get("Content-Length", 0) or 0), cap)
        raw = self.rfile.read(n).decode() if n else ""

        if path == "/api/hb":                       # training pods post telemetry
            if self.headers.get("X-Token") != cfg().get("hb_token", "\0"):
                return self._json(403, {"error": "bad token"})
            try:
                hb = json.loads(raw)
                assert isinstance(hb, dict) and "pod_id" in hb
            except Exception:
                return self._json(400, {"error": "bad payload"})
            hb["ts"] = time.time()                   # server clock is authoritative
            os.makedirs(STATE_DIR, exist_ok=True)
            with open(HEARTBEATS, "a") as f:
                f.write(json.dumps(hb) + "\n")
            return self._json(200, {"ok": True})

        if path == "/api/synth-grok":               # Grok sidecar posts doc batches
            if self.headers.get("X-Token") != cfg().get("hb_token", "\0"):
                return self._json(403, {"error": "bad token"})
            try:
                data = json.loads(raw)
                kept = data.get("kept") or []
                audit = data.get("audit") or []
                assert isinstance(kept, list) and isinstance(audit, list)
                for d in kept:
                    assert isinstance(d, dict) and isinstance(d.get("text"), str) \
                        and d.get("src") == "grokgen" and str(d.get("src_id", "")).startswith("grokgen:")
            except (json.JSONDecodeError, AssertionError):
                return self._json(400, {"error": "bad payload"})
            os.makedirs(SYNTH_DIR, exist_ok=True)
            with open(GROK_DOCS, "a", encoding="utf-8") as f:
                for d in kept:
                    f.write(json.dumps({"text": d["text"], "src": "grokgen",
                                        "src_id": d["src_id"]}, ensure_ascii=False) + "\n")
            with open(GROK_AUDIT, "a", encoding="utf-8") as f:
                for d in audit:
                    if isinstance(d, dict):
                        f.write(json.dumps(d, ensure_ascii=False) + "\n")
            _synth_cache["sig"] = None             # force re-parse next status call
            return self._json(200, {"ok": True, "kept": len(kept), "audit": len(audit)})

        if path == "/login":
            ip = self._ip()
            if rate_limited(ip):
                return self._send(429, page_login("Too many attempts. Wait 15 minutes."))
            form = urllib.parse.parse_qs(raw)
            email = (form.get("email", [""])[0] or "").strip().lower()
            pw = form.get("password", [""])[0]
            c = cfg()
            if email == (c.get("admin_email", "") or "").lower() and \
               verify_password(pw, c.get("admin_password_hash", "")):
                _rate.pop(ip, None)
                tok = sign_session(email, c.get("session_secret", ""))
                cookie = (f"hiraia_sess={tok}; Path=/admin; Max-Age={SESSION_HOURS*3600}; "
                          f"HttpOnly; Secure; SameSite=Strict")
                return self._redirect(f"{MOUNT}/", [("Set-Cookie", cookie)])
            note_failure(ip)
            time.sleep(1.0)                          # blunt the brute-force edge
            return self._send(401, page_login("Invalid email or password."))

        if not self._session_ok():
            return self._json(401, {"error": "unauthenticated"})

        if path == "/logout":
            return self._redirect(f"{MOUNT}/login", [("Set-Cookie",
                "hiraia_sess=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict")])

        if path == "/api/greenlight":
            try:
                data = json.loads(raw)
            except Exception:
                return self._json(400, {"error": "bad payload"})
            if not hmac.compare_digest(str(data.get("csrf", "")), self._csrf()):
                return self._json(403, {"error": "bad csrf"})
            pod = (data.get("pod_id") or "").strip()
            if not pod:
                return self._json(400, {"error": "pod_id required"})
            _api_cache["t"] = 0
            return self._json(200, set_greenlight(pod, cfg().get("admin_email", "operator")))

        if path == "/api/terminate":
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                return self._json(400, {"error": "bad json"})
            if not hmac.compare_digest(str(data.get("csrf", "")), self._csrf()):
                return self._json(403, {"error": "bad csrf"})
            pod = str(data.get("pod_id", ""))
            if not re.fullmatch(r"[A-Za-z0-9_-]{4,40}", pod):
                return self._json(400, {"error": "bad pod id"})
            try:
                runpod(f"pods/{pod}", method="DELETE")
            except Exception as e:
                return self._json(500, {"error": str(e)})
            with open(MONITOR_LOG, "a") as f:
                f.write(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} "
                        f"TERMINATED {pod}: manual (admin panel)\n")
            _api_cache["t"] = 0
            return self._json(200, {"ok": True})

        if path == "/note":
            form = urllib.parse.parse_qs(raw)
            if not hmac.compare_digest(form.get("csrf", [""])[0], self._csrf()):
                return self._send(403, "bad csrf", "text/plain")
            text = (form.get("text", [""])[0] or "").strip()[:2000]
            if text:
                os.makedirs(STATE_DIR, exist_ok=True)
                with open(NOTES, "a") as f:
                    f.write(json.dumps({"ts": time.time(), "text": text}) + "\n")
                _api_cache["t"] = 0
            return self._redirect(f"{MOUNT}/")

        self._send(404, "not found", "text/plain")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(STATE_DIR, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
