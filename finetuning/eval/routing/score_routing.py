#!/usr/bin/env python3
"""Score a template-routing benchmark result: expected-language rate by mode and by input variant.

  python3 score_routing.py routing-sft-v1.json [routing-sft-v2.json ...]

Reply language is fastText lid.176 (labels: tl, ceb, en), applied pod-side. A reply "routes
correctly" iff its lid label equals the mode's language. Low-confidence labels (<0.5) are
counted but also reported separately, since short or code-switched replies confuse lid.
"""
import json, sys, collections
EXP={"tagalog":"tl","cebuano":"ceb","english":"en"}
for path in sys.argv[1:]:
    d=json.load(open(path,encoding="utf-8")); rs=d["results"]
    print(f"=== {d.get('label',path)}  n={len(rs)}  samples={d.get('samples')}  T={d.get('temperature')} ===")
    def rate(rows):
        ok=sum(1 for r in rows if r["lid"]==EXP[r["mode"]]); return f"{ok}/{len(rows)} ({100*ok/len(rows):.0f}%)" if rows else "—"
    print(f"{'mode':10}"+"".join(f"{v:>16}" for v in sorted({r['variant'] for r in rs}))+f"{'ALL':>12}")
    for m in ("tagalog","cebuano","english"):
        row=[r for r in rs if r["mode"]==m]
        print(f"{m:10}"+"".join(f"{rate([r for r in row if r['variant']==v]):>16}" for v in sorted({r['variant'] for r in rs}))+f"{rate(row):>12}")
    low=[r for r in rs if r["lid_conf"]<0.5]; print(f"  low-confidence lid (<0.5): {len(low)}/{len(rs)}")
    wrong=collections.Counter((r["mode"],r["lid"]) for r in rs if r["lid"]!=EXP[r["mode"]])
    print("  wrong-language replies went to:", dict(wrong.most_common(6)))
    print("  examples of misrouted replies:")
    for r in [r for r in rs if r["lid"]!=EXP[r["mode"]]][:4]:
        print(f"    [{r['mode']}] typed={r['typed']!r} -> lid={r['lid']} : {r['answer'][:80]!r}")
    print()
