#!/usr/bin/env python3
"""
hiraia-monitor — the always-on guard for RunPod training runs.

Runs on the Vultr VPS (hiraia.b11.dev) from cron. Owes nothing to Claude, Paseo,
a laptop, or an SSH session staying alive — that dependency is exactly what let a
runaway 8xH100 pod drain the account on 2026-08-24.

Two independent guards, in priority order:

  1. COST CEILING (needs zero cooperation from the pod).
     Polls the RunPod control plane. Any pod older than its configured limit is
     terminated. UNCONDITIONAL — no training-side logic, sync failure, or
     "preserve the artifacts" reasoning may veto it. This is the rule whose
     absence cost ~$550.

  2. LIVENESS (needs the pod to post heartbeats; see hb_server.py).
     If a pod has ever posted a heartbeat and then goes quiet, or its step
     counter stops advancing, it is terminated as hung.

Plus a balance floor that alerts (and optionally drains) before hitting $0,
because at $0 RunPod can reclaim network volumes — i.e. the corpus.

Exit code is always 0 unless the config itself is broken; transient API errors
are logged and retried on the next tick rather than killing the timer.
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

CONF = os.environ.get("HIRAIA_MONITOR_CONF", "/opt/hiraia-monitor/config.json")
STATE_DIR = os.environ.get("HIRAIA_MONITOR_STATE", "/var/lib/hiraia-monitor")
STATE = os.path.join(STATE_DIR, "state.json")
HEARTBEATS = os.path.join(STATE_DIR, "heartbeats.jsonl")
LOG = os.environ.get("HIRAIA_MONITOR_LOG", "/var/log/hiraia-monitor.log")
REST = "https://rest.runpod.io/v1"
UA = "hiraia-monitor/1.0"  # RunPod 403s urllib's default User-Agent
GQL = "https://api.runpod.io/graphql"


def log(msg):
    line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def api(path, key, method="GET"):
    req = urllib.request.Request(f"{REST}/{path}", method=method,
                                 headers={"Authorization": f"Bearer {key}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode() or "{}"
    return json.loads(body) if body.strip() else {}


def balance(key):
    payload = json.dumps({"query": "query { myself { clientBalance currentSpendPerHr } }"}).encode()
    req = urllib.request.Request(f"{GQL}", data=payload,
                                 headers={"Content-Type": "application/json", "User-Agent": UA,
                                          "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        me = json.load(r)["data"]["myself"]
    return float(me["clientBalance"]), float(me.get("currentSpendPerHr") or 0)


def notify(cfg, subject, body):
    log(f"NOTIFY: {subject}")
    to = cfg.get("notify_email")
    if to and shutil_which("mail"):
        try:
            subprocess.run(["mail", "-s", f"[hiraia-monitor] {subject}", to],
                           input=body.encode(), timeout=30, check=False)
        except Exception as e:  # notification must never break the guard
            log(f"  mail failed: {e}")
    hook = cfg.get("notify_webhook")
    if hook:
        try:
            urllib.request.urlopen(urllib.request.Request(
                hook, data=json.dumps({"subject": subject, "body": body}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": UA}), timeout=20)
        except Exception as e:
            log(f"  webhook failed: {e}")


def shutil_which(x):
    from shutil import which
    return which(x)


def terminate(key, pod_id, why, cfg, dry):
    if dry:
        log(f"DRY-RUN would terminate {pod_id}: {why}")
        return
    try:
        api(f"pods/{pod_id}", key, method="DELETE")
        log(f"TERMINATED {pod_id}: {why}")
        notify(cfg, f"terminated pod {pod_id}", why)
    except Exception as e:
        log(f"TERMINATE FAILED {pod_id}: {e}")
        notify(cfg, f"TERMINATE FAILED {pod_id}", f"{why}\n\nerror: {e}")


def age_hours(pod, state):
    """Pod age in hours. RunPod's timestamp fields vary, so fall back to
    first-seen time recorded in our own state — a pod we have never seen is
    treated as new, which is safe (it only delays the ceiling by one tick)."""
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
    first = state.get("first_seen", {}).get(pod["id"])
    return (time.time() - first) / 3600 if first else 0.0


def limit_for(name, cfg):
    limits = cfg.get("max_pod_hours", {})
    if name in limits:
        return float(limits[name])
    for pat, hrs in limits.items():
        if pat.endswith("*") and name.startswith(pat[:-1]):
            return float(hrs)
    return float(cfg.get("default_max_pod_hours", 6))


def last_heartbeat(pod_id):
    if not os.path.exists(HEARTBEATS):
        return None
    best = None
    try:
        with open(HEARTBEATS) as f:
            for line in f:
                try:
                    hb = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if hb.get("pod_id") == pod_id and (best is None or hb.get("ts", 0) > best.get("ts", 0)):
                    best = hb
    except OSError:
        return None
    return best


def main():
    dry = "--dry-run" in sys.argv
    with open(CONF) as f:
        cfg = json.load(f)
    key = cfg["runpod_api_key"]
    os.makedirs(STATE_DIR, exist_ok=True)
    state = {}
    if os.path.exists(STATE):
        try:
            state = json.load(open(STATE))
        except (json.JSONDecodeError, OSError):
            state = {}
    state.setdefault("first_seen", {})
    state.setdefault("last_step", {})

    try:
        pods = api("pods", key) or []
    except Exception as e:
        log(f"pod list failed (will retry next tick): {e}")
        return 0

    now = time.time()
    live_ids = set()
    for pod in pods:
        pid, name = pod["id"], pod.get("name", "?")
        live_ids.add(pid)
        state["first_seen"].setdefault(pid, now)
        hrs, lim = age_hours(pod, state), limit_for(name, cfg)
        cost = float(pod.get("costPerHr") or 0)
        log(f"pod {name} ({pid}) age={hrs:.1f}h limit={lim}h ${cost}/hr")

        # GUARD 1 — unconditional cost ceiling
        if hrs > lim:
            terminate(key, pid, f"age {hrs:.1f}h exceeds ceiling {lim}h (${cost}/hr)", cfg, dry)
            continue

        # GUARD 2 — liveness, only for pods that have ever checked in
        hb = last_heartbeat(pid)
        if hb:
            stale_min = (now - float(hb.get("ts", 0))) / 60
            step = hb.get("step")
            if stale_min > float(cfg.get("heartbeat_stale_minutes", 20)):
                terminate(key, pid, f"no heartbeat for {stale_min:.0f} min (last step {step})", cfg, dry)
                continue
            prev = state["last_step"].get(pid)
            if prev and step is not None and step == prev["step"] and \
               (now - prev["ts"]) / 60 > float(cfg.get("step_stall_minutes", 45)):
                terminate(key, pid, f"step {step} unchanged for {(now-prev['ts'])/60:.0f} min", cfg, dry)
                continue
            if step is not None and (not prev or step != prev["step"]):
                state["last_step"][pid] = {"step": step, "ts": now}

    for gone in [p for p in list(state["first_seen"]) if p not in live_ids]:
        state["first_seen"].pop(gone, None)
        state["last_step"].pop(gone, None)

    # GUARD 4 — synthetic-Cebuano liveness (the Ox Alpha free window is finite;
    # a silently dead generator wastes irreplaceable hours). Alert only — never
    # auto-restart, since a wedged upstream is not something we can fix remotely.
    synth_dir = os.environ.get("SYNTH_CEB_DIR", "/var/lib/synth-ceb")
    docs_f = os.path.join(synth_dir, "docs_ceb.jsonl")
    if os.path.exists(docs_f):
        try:
            stale_h = (now - os.path.getmtime(docs_f)) / 3600
            n = sum(1 for _ in open(docs_f, errors="replace"))
            limit = float(cfg.get("synth_stale_hours", 3))
            log(f"synth-ceb {n} docs, last write {stale_h:.1f}h ago (alert >{limit}h)")
            last_alert = state.get("synth_alert_ts", 0)
            if stale_h > limit and now - last_alert > 6 * 3600:
                notify(cfg, f"synth-ceb stalled ({stale_h:.1f}h)",
                       f"No new Cebuano docs for {stale_h:.1f}h (banked {n}).\n"
                       f"Check: systemctl status synth-ceb; tail /var/log/synth-ceb/gen.log\n"
                       f"The Ox Alpha free window closes ~2026-08-28 — idle hours are unrecoverable.")
                state["synth_alert_ts"] = now
        except OSError as e:
            log(f"synth-ceb check failed: {e}")

    # GUARD 3 — balance floor (at $0 RunPod can reclaim volumes = the corpus)
    try:
        bal, spend = balance(key)
        floor = float(cfg.get("balance_floor_usd", 50))
        hrs_left = (bal / spend) if spend > 0.001 else 999
        log(f"balance ${bal:.2f} spend ${spend:.3f}/hr (~{hrs_left:.1f}h runway)")
        if bal < floor:
            notify(cfg, f"LOW BALANCE ${bal:.2f}",
                   f"Balance ${bal:.2f} below floor ${floor}. Spend ${spend:.3f}/hr, "
                   f"~{hrs_left:.1f}h runway.\nAt $0 RunPod can reclaim network volumes "
                   f"(the corpus lives there). Top up.")
            if cfg.get("drain_pods_below_floor") and hrs_left < 2:
                for pod in pods:
                    terminate(key, pod["id"], f"balance ${bal:.2f}, runway {hrs_left:.1f}h", cfg, dry)
    except Exception as e:
        log(f"balance check failed: {e}")

    state["last_tick"] = now
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
