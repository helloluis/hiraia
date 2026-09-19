#!/bin/bash
# run_ceb_fw.sh — VPS DeepSeek V4 Flash lane. Independent of synth-ceb.service
# (OC/OR). Writes docs_ceb_fw.jsonl. Stops calling after UTC daily $ cap or
# FW_UNTIL_UTC (end of week). Restart=always; this loop just idles when capped.
set -u
export SYNTH_CEB_DIR=/var/lib/synth-ceb
export LID_MODEL=/opt/synth-ceb/lm_resource/lid.176.bin
export SYNTH_ENV_FILE=/opt/synth-ceb/env
export FW_BUDGET_USD="${FW_BUDGET_USD:-10}"
export FW_UNTIL_UTC="${FW_UNTIL_UTC:-2026-08-31T00:00:00Z}"
export FW_CONC="${FW_CONC:-3}"
PY=/opt/synth-ceb/venv/bin/python
cd /opt/synth-ceb/scripts || exit 1
set -a; . /opt/synth-ceb/env; set +a
LOG=/var/log/synth-ceb
mkdir -p "$LOG" "$SYNTH_CEB_DIR"
while true; do
  echo "[fw-supervisor] cycle $(date -u +%FT%TZ)" >> "$LOG/fw.log"
  $PY -u gen_ceb_fw.py >> "$LOG/fw.log" 2>&1
  rc=$?
  echo "[fw-supervisor] gen exited rc=$rc $(date -u +%FT%TZ)" >> "$LOG/fw.log"
  # Capped or past-until: wait 5 min (UTC midnight spend reset). Crash: 30s.
  if [ "$rc" -eq 0 ]; then
    sleep 300
  else
    sleep 30
  fi
done
