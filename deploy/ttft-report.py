#!/usr/bin/env python3
"""TTFT / response-time report from llama-server (pm2 hiraia-llm) timing logs.

llama-server logs three `print_timing` lines per request, keyed by task id:
  prompt eval time = X ms / N tokens   <- time to digest the prompt
  eval time        = X ms / N tokens   <- generation
  total time       = X ms / N tokens

Server-side TTFT ≈ "prompt eval time": the first token streams right after the
prompt is processed. On the single-slot (-np 1) box, queue wait ≈ 0, so this is a
faithful time-to-first-token. (It does NOT include nginx/network/browser — for true
end-to-end, instrument the client.)

Usage (on the VPS):
  python3 /root/hiraia/deploy/ttft-report.py            # last 50 completed requests
  python3 /root/hiraia/deploy/ttft-report.py --n 200
  python3 /root/hiraia/deploy/ttft-report.py --log /root/.pm2/logs/hiraia-llm-error.log
"""
import re, argparse

DEFAULT_LOG = "/root/.pm2/logs/hiraia-llm-error.log"
LINE = re.compile(
    r"task\s+(\d+)\s+\|\s+(prompt eval time|eval time|total time)\s+=\s+([0-9.]+)\s+ms\s+/\s+([0-9]+)\s+tokens"
)

def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50, help="how many recent completed requests to summarize")
    ap.add_argument("--log", default=DEFAULT_LOG)
    a = ap.parse_args()

    reqs = {}
    order = []
    for line in open(a.log, errors="ignore"):
        m = LINE.search(line)
        if not m:
            continue
        tid, metric, ms, tok = m.group(1), m.group(2), float(m.group(3)), int(m.group(4))
        if tid not in reqs:
            reqs[tid] = {}
            order.append(tid)
        r = reqs[tid]
        if metric == "prompt eval time":
            r["ttft_ms"], r["ptok"] = ms, tok
        elif metric == "eval time":
            r["gen_ms"], r["gtok"] = ms, tok
        elif metric == "total time":
            r["total_ms"] = ms

    done = [reqs[t] for t in order if "total_ms" in reqs[t] and "ttft_ms" in reqs[t]][-a.n:]
    if not done:
        print("No completed requests found in", a.log)
        return

    ttft = [r["ttft_ms"] for r in done]
    total = [r["total_ms"] for r in done]
    print(f"Requests analyzed: {len(done)}  (server-side; TTFT = prompt-eval time)")
    print(f"  TTFT ms:   p50={pct(ttft,.5):>7.0f}  p90={pct(ttft,.9):>7.0f}  p95={pct(ttft,.95):>7.0f}  max={max(ttft):>7.0f}")
    print(f"  total ms:  p50={pct(total,.5):>7.0f}  p90={pct(total,.9):>7.0f}  p95={pct(total,.95):>7.0f}  max={max(total):>7.0f}")
    # split cold (cache miss, big prompt eval) vs warm (cache hit, tiny prompt eval)
    warm = [r for r in done if r.get("ptok", 0) <= 32]
    cold = [r for r in done if r.get("ptok", 0) > 32]
    if warm and cold:
        print(f"  cold turns (prompt>32 tok): {len(cold)}  TTFT p50={pct([r['ttft_ms'] for r in cold],.5):.0f} ms")
        print(f"  warm turns (cache reuse):   {len(warm)}  TTFT p50={pct([r['ttft_ms'] for r in warm],.5):.0f} ms")

    print(f"\nLast {min(15, len(done))} requests  (TTFT | total | prompt tok | gen tok | gen tok/s):")
    for r in done[-15:]:
        gtps = (r.get("gtok", 0) / (r["gen_ms"] / 1000)) if r.get("gen_ms") else 0
        print(f"  TTFT={r['ttft_ms']:>8.0f} ms   total={r['total_ms']:>9.0f} ms   ptok={r.get('ptok',0):>5}   gtok={r.get('gtok',0):>4}   {gtps:>5.1f} t/s")

if __name__ == "__main__":
    main()
