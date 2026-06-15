#!/usr/bin/env bash
# ============================================================================
# measure-ttft.sh — repeatable ON-DEVICE TTFT / decode measurement for Hiraia.
#
# The single hard part of the speed work is getting a REPEATABLE number off the
# phone (docs/OPTIMIZATION.md P0 "definition of done"). This reads the engine's
# own `[perf]` logs over adb logcat, pairs each chat turn with its retrieval, and
# prints a per-turn table — so you can SEE whether the static-system KV-cache hits
# (turn-2 prefill should crater vs turn-1) and where the wall-clock actually goes
# (prefill vs the ~3 tok/s decode).
#
# Console logs from the RN/Hermes app land in logcat; we match on the literal
# markers the engine prints (LocalEngine.ts):
#   [perf] chat: prefill/TTFT <ttft>ms · decode <dec>ms · <n> chunks · <tps> tok/s · total <tot>ms
#   [perf] ragSearch: embed <e>ms · search+R2 <s>ms (re-embed <r>ms) · <h> hits
#   [LocalEngine] warm-up complete (<ms>ms) / semantic hybrid ready (<ms>ms)
#
# USAGE (interactive — the real measurement):
#   packages/mobile/scripts/measure-ttft.sh
#     → it clears logcat, you drive the app (send turn 1, wait for the FULL reply,
#       send a follow-up turn 2, wait), then press ENTER and it reports.
#
# USAGE (parse a saved capture — testable, re-runnable, no device):
#   LOGFILE=/path/to/logcat.txt packages/mobile/scripts/measure-ttft.sh
#
# Tip: send turn 2 as a FOLLOW-UP in the SAME chat (don't start a new one) so the
# KV-cache + history path is exercised the way a real conversation hits it.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGFILE="${LOGFILE:-}"
CAP="$(mktemp -t hiraia-ttft.XXXXXX)"
trap 'rm -f "$CAP" 2>/dev/null' EXIT

parse() {
  python3 - "$1" <<'PY'
import re, sys
lines = open(sys.argv[1], errors='ignore').read().splitlines()
CHAT = re.compile(r'\[perf\] chat: prefill/TTFT (\d+)ms .*? decode (\d+)ms .*? ([\d.]+|\?) tok/s .*? total (\d+)ms')
RAG  = re.compile(r'\[perf\] ragSearch: embed (\d+)ms .*? search\+R2 (\d+)ms.*? (\d+) hits')
WARM = re.compile(r'\[LocalEngine\] warm-up complete \((\d+)ms\)')
SEM  = re.compile(r'\[LocalEngine\] semantic hybrid ready \((\d+)ms\)')
chats=[]; rags=[]; warm=None; sem=None
for ln in lines:
    m=CHAT.search(ln);  r=RAG.search(ln)
    if m: chats.append({'ttft':int(m[1]),'decode':int(m[2]),'tps':m[3],'total':int(m[4])})
    if r: rags.append({'embed':int(r[1]),'search':int(r[2]),'hits':int(r[3])})
    w=WARM.search(ln); s=SEM.search(ln)
    if w: warm=int(w[1])
    if s: sem=int(s[1])
if warm is not None or sem is not None:
    print(f"  init (one-time):  warm-up {warm if warm is not None else '—'}ms · semantic-ready {sem if sem is not None else '—'}ms")
if not chats:
    print("\n  No [perf] chat lines captured. Did the app generate a reply while capturing?")
    print("  Check: adb logcat shows the app's console.log (RN/Hermes). Try sending a message again.")
    sys.exit(3)
print("\n  turn │ retrieval │ prefill/TTFT │ decode │ tok/s │  total(user-perceived)")
print("  ─────┼───────────┼──────────────┼────────┼───────┼───────────────────────")
for i,c in enumerate(chats):
    rag = rags[i] if i < len(rags) else None
    rg = (rag['embed']+rag['search']) if rag else 0
    perceived = rg + c['ttft'] + c['decode']
    rgs = f"{rg}ms" if rag else "  —"
    print(f"   {i+1:>2}  │  {rgs:>7}  │   {c['ttft']:>6}ms   │ {c['decode']:>5}ms│ {str(c['tps']):>5} │  {perceived/1000:>5.1f}s  (TTFT {(rg+c['ttft'])/1000:.1f}s + decode {c['decode']/1000:.1f}s)")
# KV-cache verdict: turn-2 prefill should be far below turn-1
if len(chats) >= 2:
    t1, t2 = chats[0]['ttft'], chats[1]['ttft']
    drop = 100*(t1-t2)/t1 if t1 else 0
    print()
    if drop >= 40:
        print(f"  ✓ KV-CACHE HIT: turn-2 prefill {t2}ms is {drop:.0f}% below turn-1 {t1}ms — the static system prompt is being reused.")
    elif t2 <= t1:
        print(f"  ~ cache maybe partial: turn-2 prefill {t2}ms vs turn-1 {t1}ms ({drop:.0f}% lower). Expected a bigger drop — check warm-up ran + system prompt is byte-identical.")
    else:
        print(f"  ✗ CACHE NOT HITTING: turn-2 prefill {t2}ms ≥ turn-1 {t1}ms. The full prompt is re-prefilling every turn — this is the big TTFT cost. Investigate generateSystemPrompt parity + kvCache:true.")
    avgtps=[float(c['tps']) for c in chats if c['tps'] not in ('?',)]
    if avgtps: print(f"  decode floor: ~{sum(avgtps)/len(avgtps):.1f} tok/s (hardware-bound w/ GPU offload). At this rate a 220-tok reply ≈ {220/(sum(avgtps)/len(avgtps)):.0f}s of decode.")
else:
    print("\n  Only 1 turn captured — send a SECOND follow-up turn to measure the warm-cache (turn-2) prefill.")
PY
}

if [ -n "$LOGFILE" ]; then
  [ -f "$LOGFILE" ] || { echo "ERR: LOGFILE not found: $LOGFILE"; exit 2; }
  echo ">> parsing saved capture: $LOGFILE"
  parse "$LOGFILE"; exit $?
fi

command -v adb >/dev/null || { echo "ERR: adb not on PATH"; exit 2; }
DEV="$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
[ -n "$DEV" ] || { echo "ERR: no Android device on adb. Plug in the phone (usb-debugging) and re-run."; exit 2; }
echo ">> device: $DEV"
echo ">> clearing logcat ..."
adb -s "$DEV" logcat -c 2>/dev/null || true
adb -s "$DEV" logcat -v time > "$CAP" 2>/dev/null &
CAP_PID=$!
cat <<EOF

  ───────────────────────────────────────────────────────────────────────
  Capturing. In the Hiraia app on the phone:
    1. Make sure the model is loaded (the loader finished — warm-up done).
    2. Send your FIRST message; WAIT for the full reply.
    3. Send a SECOND follow-up in the SAME chat; WAIT for the full reply.
       (Use a framed-ish question for one of them to exercise the <think> path.)
  Then come back here and press ENTER to stop + report.
  ───────────────────────────────────────────────────────────────────────
EOF
read -r _
kill "$CAP_PID" 2>/dev/null; wait "$CAP_PID" 2>/dev/null || true
echo ">> captured $(wc -l < "$CAP" | tr -d ' ') logcat lines"
parse "$CAP"
