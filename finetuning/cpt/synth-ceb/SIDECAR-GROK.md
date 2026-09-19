# Grok sidecar — not the OC/OR bank

This directory's live product is `docs_ceb.jsonl`, written by `gen_ceb_ox.py`
(OpenRouter translation + OpenCode generation) on the VPS
(`synth-ceb.service` → `/var/lib/synth-ceb/`).

**A third lane runs in a separate Grok Build session** (no API keys, no
supervisor). It writes:

| File | Role |
|---|---|
| `docs_ceb_grok.jsonl` | Kept docs. `{text, src, src_id}` with `src=grokgen`, `src_id=grokgen:<n>` |
| `docs_ceb_grok_all.jsonl` | Audit (same QC fields as `docs_ceb_all.jsonl`) |

Do **not** append those rows into `docs_ceb.jsonl` while the VPS generator is
running. Merge at window-close packaging (`pool_ceb_v4`), after dedup.

Spec: `../SYNTH-CEB-SPEC.md` §10.

## Push to the dashboard (REQUIRED after every batch)

After writing each batch locally, POST the NEW rows to mission control so the
admin panel can chart Grok alongside OC/OR:

X-Token: NlWCqd8zN_T_AjskYCjxOiuziSLHjRP5

```
curl -sS https://hiraia.b11.dev/admin/api/synth-grok \
  -H 'Content-Type: application/json' \
  -H X-Token:NlWCqd8zN_T_AjskYCjxOiuziSLHjRP5 \
  -d '{"kept": [<doc objects>], "audit": [<audit objects>]}'
```

- Send only rows not yet acknowledged by the endpoint (it appends; it does not
  dedup). Payload cap 4MB — split big batches.
- A `{"ok": true, "kept": N, "audit": M}` reply means the VPS has the rows; the
  canonical sidecar copy is `/var/lib/synth-ceb/docs_ceb_grok.jsonl` on the VPS.
  Local Mac copies remain the fallback.
- If the POST fails, keep the rows locally and include the backlog next fire.

## Paseo heartbeat (fills this sidecar while Luis is away)

| | |
|---|---|
| Id | `95519735` (was `7e418fc2` / `de9710b0` / `9a8e7142`; re-armed 2026-08-26) |
| Name | `synth-ceb grok sidecar` |
| Cadence | `*/15 * * * *` Asia/Manila (every 15 min) |
| Batch | **~50** pieces/fire |
| Expires | 2026-08-29 10:20 UTC (~80 runs max) |
| Stop | create `STOP-GROK` in this directory (next fire no-ops; does not delete the heartbeat) |
| Delete heartbeat | Paseo `delete_heartbeat` id `95519735` |

**Retired 2026-08-27:** `STOP-GROK` is in this directory; heartbeat `95519735` deleted.
VPS `synth-ceb.service` (OpenCode + OpenRouter) was already inactive/disabled
(2026-08-26 15:15 UTC). Flash lane `synth-ceb-fw.service` stopped and disabled
the same day.

Running total: **8374 kept** (grokgen:1–8375; last fire +50 kept / 0 lid / 0 bleed; LID unchecked).
