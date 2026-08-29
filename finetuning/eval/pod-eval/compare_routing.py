#!/usr/bin/env python3
"""Tabulate the 12-probe routing test across eval-answer files (v1 vs v2 vs ...).

  python3 compare_routing.py finetuning/cpt/sft-v1-eval-answers.json /tmp/sft-v2-eval-answers.json

Prints one row per probe with the reply language per model, then the Cebuano-mode score
(n/8) per model, split into Cebuano-worded (4) and language-neutral (4). The neutral column is
the synth-ceb decision: it was 0/4 on v1 and is what the v2 suppression bucket targets.
"""
import json, re, sys
CEB = re.compile(r"\b(mao|nga|kaayo|naghimo|gikan|usa ka|ilang|atong|og|dili|kini|kana|pinaagi|tungod|unsa|maayong|nindot)\b")
NEUTRAL = {"route-ceb-tubig", "route-ceb-ambig1", "route-ceb-ambig2", "route-ceb-ambig3"}

def load(path):
    d = json.load(open(path, encoding="utf-8"))
    out = {}
    for r in d["routing"]:
        ans = r.get("answer") or ""
        ceb = r.get("reply_is_ceb")
        if ceb is None: ceb = bool(CEB.search(ans[:140]))
        out[r["id"]] = (ceb, ans)
    return d.get("label") or path.split("/")[-1].replace("-eval-answers.json", ""), out

runs = [load(p) for p in sys.argv[1:]]
ids = [i for i in runs[0][1]]
print(f"{'probe':24} " + " ".join(f"{lab:>8}" for lab, _ in runs) + "   (Cebuano-mode probes only score)")
for i in ids:
    cells = []
    for _, r in runs:
        ceb, _ = r.get(i, (None, ""))
        cells.append("  —  " if ceb is None else ("  CEB " if ceb else "  TL  "))
    tag = " neutral" if i in NEUTRAL else (" worded" if i.startswith("route-ceb") else " tl-ctrl")
    print(f"{i:24} " + " ".join(f"{c:>8}" for c in cells) + tag)
print()
for lab, r in runs:
    cm = [i for i in r if i.startswith("route-ceb")]
    worded = [i for i in cm if i not in NEUTRAL]; neutral = [i for i in cm if i in NEUTRAL]
    s = lambda ks: sum(1 for k in ks if r[k][0])
    print(f"{lab:>8}: Cebuano-mode {s(cm)}/{len(cm)}   worded {s(worded)}/{len(worded)}   NEUTRAL {s(neutral)}/{len(neutral)}")
print("\nSample neutral answers (the probes that decide it):")
for lab, r in runs:
    for i in sorted(NEUTRAL):
        if i in r: print(f"  [{lab}] {i:18} {'CEB' if r[i][0] else 'TL '}  {r[i][1][:88]!r}")
