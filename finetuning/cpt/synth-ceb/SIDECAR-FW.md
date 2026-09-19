# Fireworks Flash sidecar — Lane FW

Fourth Cebuano generation lane. **Not** the OC/OR bank (`docs_ceb.jsonl`) and
**not** the Grok sidecar. Runs on the VPS as `synth-ceb-fw.service`.

| | |
|---|---|
| Model | `accounts/fireworks/models/deepseek-v4-flash-0731` |
| Product | `/var/lib/synth-ceb/docs_ceb_fw.jsonl` `{text, src:fwgen, src_id:fwgen:<n>}` |
| Audit | `/var/lib/synth-ceb/docs_ceb_fw_all.jsonl` |
| Spend state | `/var/lib/synth-ceb/fw-state.json` |
| Budget | **$10/UTC day** (Fireworks Standard: $0.22 in / $0.66 out per 1M) |
| Window | until `FW_UNTIL_UTC` default **2026-08-31T00:00:00Z** |
| QC | same gate as OC: len≥100, fastText ceb≥0.70, tl_bleed≤0.04 |
| Do not | write `docs_ceb.jsonl`, reuse `ocgen:`/`or:`/`grokgen:`/`lrmds:`/`v3x*` ids |

Merge at window-close packaging (`pool_ceb_v4`) after dedup, with OC/OR + Grok.

**Retired 2026-08-27:** VPS `synth-ceb-fw.service` stopped and disabled.
Bank left in place (`docs_ceb_fw.jsonl` 19821 kept / `docs_ceb_fw_all.jsonl` 23378).
