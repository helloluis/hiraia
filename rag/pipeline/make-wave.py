#!/usr/bin/env python3
"""Build a disposable per-wave workflow script from expand-wave.workflow.js,
injecting the wave number + used-beats as literals (args don't thread through
scriptPath, and workflow scripts can't read files). Writes .wave-run.workflow.js.

  python3 rag/pipeline/make-wave.py <wave-number>
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TMPL = os.path.join(HERE, "expand-wave.workflow.js")
BEATS = os.path.join(HERE, ".beats-used.json")
OUT = os.path.join(HERE, ".wave-run.workflow.js")

wave = int(sys.argv[1])
beats = json.load(open(BEATS)) if os.path.exists(BEATS) else []

tmpl = open(TMPL).read()
OLD = (
    "const wave = args?.wave ?? 1\n"
    "const BEATS = args?.beatsThisWave ?? 100\n"
    "const FPB = args?.factsPerBeat ?? 25\n"
    "const usedBeats = args?.usedBeats ?? []"
)
NEW = (
    f"const wave = {wave}\n"
    f"const BEATS = 100\n"
    f"const FPB = 25\n"
    # keep the most recent ~500 beats for de-dup steering (context budget)
    f"const usedBeats = {json.dumps(beats[-500:], ensure_ascii=False)}"
)
assert OLD in tmpl, "config block not found in template — did the generator change?"
open(OUT, "w").write(tmpl.replace(OLD, NEW))
print(f"wrote {OUT}: wave {wave}, {len(beats)} used beats injected")
