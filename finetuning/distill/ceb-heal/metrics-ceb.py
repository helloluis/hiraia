#!/usr/bin/env python3
"""
metrics-ceb.py — AUP-safe quality metrics over generated Cebuano output.
Reads an outputs jsonl ({text, ntok, ...}) and emits ONLY aggregate numbers (JSON) —
never any text. Detects Tagalog-drift (the main failure: Sailor2 drifting ceb→tl) via
distinctive function-word markers, plus length/empty/repetition stats.

Usage: python metrics-ceb.py out/ceb-shard-0.jsonl
"""
import sys, json, re

# Distinctive markers (lowercased, space-padded). Cebuano-distinctive vs Tagalog-distinctive.
CEB = [" ug ", " kini ", " mao ", " dili ", " gikan ", " kanunay ", " adunay ", " gamay ", " kaayo ", " naa ", " unsa ", " kung "]
TL  = [" ng ", " mga ", " ay ", " hindi ", " ito ", " naman ", " dahil ", " yung ", " ngayon ", " kasi "]

def markers(t, ms):
    t = " " + t.lower() + " "
    return sum(t.count(m) for m in ms)

def main():
    path = sys.argv[1]
    n = empty = ceb_ok = tl_drift = short = 0
    toks = []
    seen = {}
    dup = 0
    for ln in open(path, encoding="utf-8"):
        ln = ln.strip()
        if not ln: continue
        try: r = json.loads(ln)
        except Exception: continue
        n += 1
        t = (r.get("text") or "").strip()
        nt = r.get("ntok", 0); toks.append(nt)
        if not t: empty += 1; continue
        if nt < 40: short += 1
        c = markers(t, CEB); l = markers(t, TL)
        # cebuano-dominant if it has ceb markers and not more tl-distinctive markers
        if c >= 2 and c >= l: ceb_ok += 1
        if l >= 2 and l > c: tl_drift += 1
        key = t[:80]
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1: dup += 1
    toks.sort()
    p = lambda q: toks[int(q*len(toks))] if toks else 0
    out = {
        "n": n, "empty": empty, "short_lt40tok": short,
        "ceb_dominant_ratio": round(ceb_ok / max(1, n - empty), 3),
        "tl_drift_ratio": round(tl_drift / max(1, n - empty), 3),
        "dup_prefix_ratio": round(dup / max(1, n), 3),
        "tok_p50": p(0.50), "tok_p90": p(0.90), "tok_mean": round(sum(toks)/max(1,len(toks)), 1),
        "total_tok": sum(toks),
    }
    print(json.dumps(out))

if __name__ == "__main__":
    main()
