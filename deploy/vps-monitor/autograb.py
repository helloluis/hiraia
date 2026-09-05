#!/usr/bin/env python3
"""
hiraia-autograb — claim scarce GPU capacity the moment it appears, then get out of the way.

Why this exists. On 2026-08-24 an 8xH100 run was deliberately held for an operator
greenlight. The greenlight arrived 12 minutes after the hold expired, the pod had already
self-terminated as instructed, and by the time we went to relaunch, AP-IN-2 8xH100 stock had
gone from "Low" to zero. The corpus volume is datacenter-locked, so there was nowhere else to
go. The window had been open for roughly ten minutes.

Nobody can watch for a ten-minute window by hand across a flight. This does, from the VPS,
needing nothing but the RunPod API.

It is deliberately a ONE-SHOT. It fires once, disarms itself, and never fires again without a
human re-arming it. An auto-provisioner that can fire repeatedly is a machine for spending
money you did not agree to spend.

Guardrails, all of which must pass before anything is created:
  * armed flag in config (a human sets it)
  * no pod already exists on the account   -- never race a live run
  * not already fired                      -- one shot, then disarm
  * quoted price <= max_rate_usd_hr        -- refuse a panic-priced slot
  * balance >= min_balance_usd             -- do not start what cannot finish
and AFTER creation the real billing rate is re-checked against the ceiling; if the pod came
back more expensive than quoted it is terminated immediately rather than left running.

The created pod bootstraps itself over HTTPS (see the dockerArgs below) and starts training on
the greenlight that is already armed. Guard 1's cost ceiling and the balance floor in
monitor.py still apply to it exactly as they would to a hand-made pod.
"""
import base64, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

CONF = os.environ.get("HIRAIA_MONITOR_CONF", "/opt/hiraia-monitor/config.json")
STATE_DIR = os.environ.get("HIRAIA_MONITOR_STATE", "/var/lib/hiraia-monitor")
STATE = os.path.join(STATE_DIR, "autograb.json")
LOG = os.environ.get("HIRAIA_AUTOGRAB_LOG", "/var/log/hiraia-monitor.log")
REST = "https://rest.runpod.io/v1"
GQL = "https://api.runpod.io/graphql"
UA = "hiraia-autograb/1.0"          # RunPod 403s urllib's default User-Agent


def log(msg):
    line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} [autograb] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def gql(query, key):
    req = urllib.request.Request(
        GQL, data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def rest(path, key, method="GET"):
    req = urllib.request.Request(f"{REST}/{path}", method=method,
                                 headers={"Authorization": f"Bearer {key}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        body = r.read().decode() or "{}"
    return json.loads(body) if body.strip() else {}


def notify(cfg, subject, body):
    log(f"NOTIFY: {subject}")
    to = cfg.get("notify_email")
    if to:
        try:
            import subprocess
            from shutil import which
            if which("mail"):
                subprocess.run(["mail", "-s", f"[hiraia-autograb] {subject}", to],
                               input=body.encode(), timeout=30, check=False)
        except Exception as e:
            log(f"  mail failed: {e}")
    hook = cfg.get("notify_webhook")
    if hook:
        try:
            urllib.request.urlopen(urllib.request.Request(
                hook, data=json.dumps({"subject": subject, "body": body}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": UA}), timeout=20)
        except Exception as e:
            log(f"  webhook failed: {e}")


def note(text):
    """Write to the dashboard run log so the timeline records what fired unattended."""
    try:
        with open(os.path.join(STATE_DIR, "notes.jsonl"), "a") as f:
            f.write(json.dumps({"ts": time.time(), "text": text}) + "\n")
    except OSError:
        pass


def state_read():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def state_write(d):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
    os.replace(tmp, STATE)


def disarm(cfg_path=CONF):
    """One shot. Flip armed=false in the config so a stuck timer cannot fire twice."""
    try:
        with open(cfg_path) as f:
            c = json.load(f)
        c.setdefault("autograb", {})["armed"] = False
        tmp = cfg_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(c, f, indent=2)
        json.load(open(tmp))
        os.replace(tmp, cfg_path)
        os.chmod(cfg_path, 0o600)
        return True
    except Exception as e:
        log(f"DISARM FAILED (dangerous - fix by hand): {e}")
        return False


def all_datacenters(key):
    try:
        return [d["id"] for d in gql("query { dataCenters { id } }", key)["data"]["dataCenters"]]
    except Exception as e:
        log(f"datacenter list failed: {e}")
        return []


def find_capacity(key, dcs, gpu_ids, count):
    """First (dc, gpu_id, price) with real stock, honouring both preference orders.

    Datacenter order matters more than GPU order: AP-IN-2 holds the mix and the tokenised
    cache, so a hit there starts training in ~40 min, while anywhere else has to pull the
    mix from the HF archive and re-tokenise first.
    """
    for dc in dcs:
        q = ('query { gpuTypes { id displayName lowestPrice(input:{gpuCount:%d, '
             'dataCenterId:"%s"}) { stockStatus uninterruptablePrice } } }' % (count, dc))
        try:
            data = gql(q, key)["data"]["gpuTypes"]
        except Exception as e:
            log(f"availability query failed for {dc} (will retry): {e}")
            continue
        avail = {}
        for g in data:
            lp = g.get("lowestPrice") or {}
            stock, price = lp.get("stockStatus"), lp.get("uninterruptablePrice")
            if stock and str(stock).lower() not in ("none", "null") and price:
                avail[g["id"]] = float(price)
        for gid in gpu_ids:                  # honour the GPU preference order
            if gid in avail:
                return dc, gid, avail[gid]
    return None


def main():
    dry = "--dry-run" in sys.argv
    with open(CONF) as f:
        cfg = json.load(f)
    key = cfg["runpod_api_key"]
    a = cfg.get("autograb") or {}

    if not a.get("armed"):
        return 0                              # silent: this runs every few minutes
    st = state_read()
    if st.get("fired"):
        log(f"already fired at {st.get('fired_utc')} (pod {st.get('pod_id')}) - disarming")
        disarm()
        return 0

    prefer = a.get("prefer_datacenters") or ["AP-IN-2"]
    gpu_ids = a.get("gpu_ids") or ["NVIDIA H100 80GB HBM3"]
    count = int(a.get("gpu_count", 8))
    max_rate = float(a.get("max_rate_usd_hr", 30))
    min_bal = float(a.get("min_balance_usd", 400))

    try:
        pods = rest("pods", key) or []
    except Exception as e:
        log(f"pod list failed (will retry): {e}")
        return 0
    if pods:
        log(f"{len(pods)} pod(s) already running - standing down this tick")
        return 0

    try:
        me = gql("query { myself { clientBalance } }", key)["data"]["myself"]
        bal = float(me["clientBalance"])
    except Exception as e:
        log(f"balance check failed (will retry): {e}")
        return 0
    if bal < min_bal:
        log(f"balance ${bal:.2f} below autograb floor ${min_bal} - refusing to start")
        return 0

    dcs = list(prefer)
    if a.get("search_all_datacenters", True):
        dcs += [d for d in all_datacenters(key) if d not in dcs]
    hit = find_capacity(key, dcs, gpu_ids, count)
    if not hit:
        return 0                              # the common case; stay quiet
    dc, gid, price = hit
    log(f"CAPACITY FOUND: {count}x {gid} in {dc} at ${price}/hr (ceiling ${max_rate})")
    if price > max_rate:
        log(f"  quoted ${price} exceeds ceiling ${max_rate} - declining")
        return 0
    if dry:
        log("  DRY-RUN: would create the pod here")
        return 0

    img = a.get("image", "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04")
    name = a.get("pod_name", "hiraia-fullrun")
    vol = a["network_volume_id"]
    vol_dc = a.get("network_volume_dc", "AP-IN-2")
    tok = cfg.get("hb_token", "")

    # Network volumes are datacenter-locked. In the volume's own DC we attach it and the pod
    # restores the tokenised cache (fast path). Anywhere else we must CREATE a volume there --
    # never run without one, because checkpoints on a pod's local disk is precisely what
    # destroyed run 2 and ~$550. The pod then pulls the mix from the HF archive instead.
    if dc == vol_dc:
        use_vol, fresh = vol, False
    else:
        gb = int(a.get("new_volume_gb", 300))
        vq = ('mutation { createNetworkVolume(input: { name: "hiraia-fullrun-%s", '
              'size: %d, dataCenterId: "%s" }) { id } }' % (dc, gb, dc))
        try:
            vres = gql(vq, key)
            use_vol = ((vres.get("data") or {}).get("createNetworkVolume") or {}).get("id")
        except Exception as e:
            log(f"volume create in {dc} failed: {e}")
            return 0
        if not use_vol:
            log(f"volume create in {dc} returned no id: {json.dumps(vres)[:200]}")
            return 0
        fresh = True
        log(f"created {gb}GB volume {use_vol} in {dc} (no local copy of the mix there)")

    # dockerArgs is a GraphQL string containing a shell command; nesting quotes inside it is a
    # reliable way to produce an unparseable mutation. Base64 has no quotes at all, so the
    # fetch script (which does need double quotes for the auth header) survives intact.
    inner = (f'curl -s -m 120 -H "X-Token: {tok}" '
             f'"https://hiraia.b11.dev/admin/api/bootstrap?fresh={int(fresh)}" '
             '-o /root/bootstrap.sh && chmod +x /root/bootstrap.sh && '
             'bash /root/bootstrap.sh')
    b64 = base64.b64encode(inner.encode()).decode()
    boot = (f"bash -c 'echo {b64} | base64 -d > /root/boot0.sh; "
            "setsid nohup bash /root/boot0.sh >/dev/null 2>&1 & exec /start.sh'")
    q = ('mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, '
         f'gpuCount: {count}, gpuTypeId: "{gid}", dataCenterId: "{dc}", '
         f'networkVolumeId: "{use_vol}", volumeMountPath: "/workspace", '
         'containerDiskInGb: 200, minVcpuCount: 24, minMemoryInGb: 200, '
         f'supportPublicIp: true, imageName: "{img}", ports: "22/tcp", '
         f'startSsh: true, name: "{name}", dockerArgs: "{boot}" }}) {{ id }} }}')
    try:
        res = gql(q, key)
    except urllib.error.HTTPError as e:
        log(f"create failed HTTP {e.code}: {e.read().decode()[:300]}")
        return 0
    except Exception as e:
        log(f"create failed: {e}")
        return 0
    if res.get("errors"):
        log(f"create errors: {json.dumps(res['errors'])[:300]}")
        return 0
    pod_id = ((res.get("data") or {}).get("podFindAndDeployOnDemand") or {}).get("id")
    if not pod_id:
        log(f"create returned no id: {json.dumps(res)[:300]}")
        return 0

    log(f"CREATED {pod_id} ({count}x {gid} in {dc})")
    state_write({"fired": True, "fired_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "pod_id": pod_id, "gpu": gid, "dc": dc, "volume": use_vol,
                 "fresh_volume": fresh, "quoted_rate": price})
    disarm()

    # Re-check the REAL rate. A quote is not a bill; if it came back dearer than the ceiling,
    # kill it now rather than discover it 40 hours later.
    real = None
    for _ in range(10):
        time.sleep(6)
        try:
            p = rest(f"pods/{pod_id}", key)
            real = float(p.get("costPerHr") or 0)
            if real:
                break
        except Exception:
            continue
    if real and real > max_rate:
        log(f"ACTUAL rate ${real}/hr exceeds ceiling ${max_rate} - terminating {pod_id}")
        try:
            rest(f"pods/{pod_id}", key, method="DELETE")
        except Exception as e:
            log(f"  terminate failed: {e}")
        notify(cfg, f"autograb terminated {pod_id} (over-priced)",
               f"Quoted ${price}/hr but billed ${real}/hr, over the ${max_rate} ceiling. "
               f"Pod terminated. Autograb is now DISARMED; re-arm by hand to try again.")
        note(f"AUTOGRAB created {pod_id} then terminated it: billed ${real}/hr over the "
             f"${max_rate}/hr ceiling. Disarmed.")
        return 0

    msg = (f"Claimed {count}x {gid} in {dc} at ${real or price}/hr (pod {pod_id}).\n"
           f"It is bootstrapping itself now: restore the tokenised cache from the volume, "
           f"rebuild the stack, then start training on the armed greenlight.\n"
           f"Expect ~40 min of setup before step 1. Watch https://hiraia.b11.dev/admin\n"
           f"Autograb has DISARMED itself and will not fire again.")
    log(msg.replace("\n", " | "))
    notify(cfg, f"autograb claimed {count}x {gid}", msg)
    note(f"AUTOGRAB fired unattended: claimed {count}x {gid} in {dc} at "
         f"${real or price}/hr as pod {pod_id}. Bootstrapping, then training starts on the "
         f"already-armed greenlight. Autograb disarmed itself.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
