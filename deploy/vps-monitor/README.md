# hiraia mission control — always-on guard + telemetry panel

**Live:** https://hiraia.b11.dev/admin

**Why this exists.** On 2026-08-24 a probe-CPT run trained to 92% and lost every checkpoint.
The pod's final artifact sync failed; the driver was written to *refuse* self-termination in
that case (preserve artifacts over cost); the on-pod watchdog was written to *respect* that
refusal; and the off-pod babysitter that would have caught the runaway died on an unrelated
credit pool. An $26.32/hr pod billed unattended until the account hit $0, and RunPod's
zero-balance cleanup took the pod's local disk — and all ten checkpoints — with it.

The lesson isn't "add another guard." It's that **every guard could be talked out of firing,
and all of them lived inside systems that can themselves disappear.** This one can't: it runs
on a VPS that stays up, needs nothing but the RunPod API, and its cost ceiling accepts no
arguments from anybody.

## What runs

| Component | What it does |
|---|---|
| `monitor.py` | The guard. systemd timer, every 5 min. Three rules (below). |
| `admin_app.py` | Mission control at `/admin` — telemetry, loss curve, kill switch, run log. Also receives pod heartbeats. |

Both are **stdlib-only Python** — no pip, no venv, nothing to rot. They read one config at
`/opt/hiraia-monitor/config.json` (mode 600; holds the RunPod key and the password hash).

## The three guard rules

| Guard | Needs the pod's cooperation? | Catches |
|---|---|---|
| **1. Cost ceiling** | **No** — pure control plane | Anything leaving a pod running: failed self-terminate, wedged SSH, dead driver, forgotten pod |
| **2. Liveness** | Yes — heartbeats | Training dead or stalled while the pod happily bills |
| **3. Balance floor** | No | Approaching $0, where RunPod can **reclaim network volumes** (the corpus lives there) |

Guard 1 is the one that matters, precisely because it asks nothing of the thing it guards. A
pod past its ceiling is terminated — no training-side logic, sync failure, or "but the
artifacts" reasoning may veto it. **Artifacts are protected by writing checkpoints to a
network volume in the pod's own datacenter** (they outlive the pod), never by keeping
expensive hardware alive.

Ceilings are per-name with `prefix*` patterns and a 6h default, so a pod nobody named is
still capped. Set a run's ceiling to its projected wall-clock plus margin; if a run
legitimately needs longer, raise it deliberately — never remove it.

## The panel

Dark instrument-panel UI, readable on a phone at 3am, auto-refreshing every 15s:

- **Tiles** — step/total, loss, pace, heartbeat freshness, burn rate, balance + runway
- **Loss curve** — SVG, scoped to one run and sorted by step (mixing pods draws nonsense)
- **Pods & kill switch** — every live pod with age against its ceiling, and a confirm-gated
  **Terminate** button
- **Run log** — free-text entries for documenting decisions and verdicts as they happen
- **Guard activity** — the monitor's own log tail

Auth is a single account: PBKDF2-SHA256 hash (never plaintext on disk), HMAC-signed session
cookie (HttpOnly/Secure/SameSite=Strict, 72h), per-IP login rate limiting, CSRF on every
state-changing POST, and the RunPod key never reaching the browser.

> **Security note.** This panel can terminate GPU pods and is internet-facing. Use a strong
> password. Rotate with:
> `ADMIN_PASSWORD='...' ./install.sh` (re-runs are idempotent), or edit
> `admin_password_hash` in the config using `hash_password()` from `admin_app.py`.

## Install

```bash
cd ~/Code/hiraia && set -a && . ./.env.local && set +a   # leading ./ — zsh gotcha
ADMIN_PASSWORD='...' ./deploy/vps-monitor/install.sh root@45.76.180.229
```

Additive and reversible; nginx is backed up and the reload is gated on `nginx -t`. It does not
touch other sites, pm2, or llama-server. Uninstall instructions are in the script header.

## Wiring a training run to it

Add to any driver once the pod ID is known — heartbeats give the panel its live numbers and
arm Guard 2:

```bash
( while true; do
    STEP=$(grep -aoE '"global_step/max_steps": "[0-9]+' "$LOG" | tail -1 | grep -oE '[0-9]+$')
    LOSS=$(grep -aoE '"loss": "[0-9.]+' "$LOG" | tail -1 | grep -oE '[0-9.]+$')
    SIT=$(grep -aoE '"train_speed\(s/it\)": "[0-9.]+' "$LOG" | tail -1 | grep -oE '[0-9.]+$')
    curl -s -m 10 -X POST https://hiraia.b11.dev/admin/api/hb \
      -H "X-Token: $HB_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"pod_id\":\"$RUNPOD_POD_ID\",\"step\":${STEP:-0},\"loss\":${LOSS:-0},\
\"sec_per_step\":${SIT:-0},\"total_steps\":1225,\"kind\":\"train\",\"note\":\"probe run 3\"}" >/dev/null
    sleep 60
  done ) &
```

Heartbeats go over HTTPS through nginx — no extra port, no firewall change. The server stamps
its own receive time; the pod's clock is never trusted.

**Always set `kind`.** `"train"` feeds the loss curve and the headline tiles; anything else
(`"eval"`, `"convert"`, …) is recorded and drives Guard 2 liveness but is kept *out* of the
chart. This matters: an eval job posting perplexities (10–40) into the same stream as training
loss (1–4) renders a meaningless curve and hijacks the tiles — which is exactly what happened
on 2026-08-24 before the separation existed. Legacy heartbeats with no `kind` are treated as
training unless their `note` starts with "eval".

## The run log — where it lives, and keeping it for posterity

**The dashboard is the capture surface; git is the durable store.** Entries typed into the
Run log land in `/var/lib/hiraia-monitor/notes.jsonl` on the VPS — one box, no RAID, no
snapshot. Fine for reading at 3am, **not** fine as the only copy of a project record.

Export it into the repo (this is the durable copy — git pushes off-box to GitHub):

```bash
cd ~/Code/hiraia
curl -s -c /tmp/c -o /dev/null -d "email=<you>&password=<pw>" https://hiraia.b11.dev/admin/login
curl -s -b /tmp/c "https://hiraia.b11.dev/admin/api/export?format=md" \
  -o finetuning/cpt/RUN-LOG.md
git add finetuning/cpt/RUN-LOG.md && git commit -m "run log: export $(date +%F)"
```

`?format=json` gives the raw entries (with timestamps) if you'd rather post-process them.
Do this after any milestone worth keeping — a gate verdict, a run outcome, a surprise.

**What belongs where:** one-line events and decisions go in the dashboard log (fast to write
from a phone, shows up in the timeline). Full findings — the Gate 4 write-up, probe results,
consolidation numbers — belong in their own committed markdown under `finetuning/cpt/`, with a
one-line pointer in the dashboard so the timeline stays readable.

## Operating notes

- Terminations and low-balance events email `notify_email` and can POST to `notify_webhook`.
- `drain_pods_below_floor` terminates everything when the balance is under the floor **and**
  under 2h of runway — losing a run beats losing the corpus.
- RunPod 403s urllib's default User-Agent; both scripts set one. Don't remove it.
- Logs `/var/log/hiraia-monitor.log`; state `/var/lib/hiraia-monitor/` (heartbeats, notes, state).
