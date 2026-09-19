#!/bin/bash
# run_ceb_supervisor.sh — keep the synthetic Cebuano generator alive until the
# Ox Alpha free window ends (~Aug 28 2026). Each loop: top up the translation
# queue from the v3 tl final if it runs low, run the generator to exhaustion
# (queue drained or daily lane caps hit), then idle and repeat. Caps reset at
# UTC midnight, so a capped run just burns one fast no-op pass per cycle.
#
# A separate Grok session writes a SIDECAR (docs_ceb_grok.jsonl, src=grokgen).
# This loop does not own that file. See SYNTH-CEB-SPEC.md §10.
cd /Users/luis/Code/hiraia/finetuning/cpt || exit 1
PY=/tmp/sailcraft-local/.venv/bin/python
while true; do
  echo "[supervisor] cycle start $(date -u +%FT%TZ)" >> /tmp/ceb-feed.log
  $PY -u feed_ceb_queue.py --min-remaining 1500 --add 6000 >> /tmp/ceb-feed.log 2>&1
  $PY -u gen_ceb_ox.py >> /tmp/ceb-gen.log 2>&1
  echo "[supervisor] gen exited $(date -u +%FT%TZ)" >> /tmp/ceb-feed.log
  sleep 900
done
