# SYNTH-CEB — Synthetic Cebuano Corpus Generation via Ox Alpha (Product Spec)

Status: LIVE since 2026-08-23. Written for the cloud-automation/admin-dashboard
workstream. All paths are absolute and current as of this writing.

## 1. Goal

Exploit the free preview window of the stealth LLM **Ox Alpha** (available via
two gateways, both free until ~2026-08-28) to mass-produce clean, pedagogical
Cebuano (Sinugbuanong Binisaya) text for Hiraia continued pre-training. Two
production strategies run in parallel ("lanes"), plus an automated QC gate and
a self-healing supervisor. Target: maximize banked documents before the free
window closes; zero-dollar budget.

## 2. Architecture overview

```
run_ceb_supervisor.sh  (infinite loop: feed -> generate -> sleep 900s)
 ├─ feed_ceb_queue.py  (tops up the translation queue from the v3 TL final)
 └─ gen_ceb_ox.py      (two lanes + QC gate + resume + daily caps)
     ├─ Lane OR: OpenRouter  stealth/ox-alpha   -> TRANSLATION, batch=4
     └─ Lane OC: OpenCode Go ox-alpha-free      -> GENERATION, short-form

Lane GROK (sidecar, NOT in this loop — see §10):
  in-session Grok generation → synth-ceb/docs_ceb_grok.jsonl
  Does not share OC/OR caps, keys, or the VPS live bank.
```

Everything currently runs on the user's Mac (Darwin, arm64). No cloud
dependencies except the two LLM gateways. Python interpreter for all three
scripts: `/tmp/sailcraft-local/.venv/bin/python` (has `fasttext`, `datasets`).

### Script files (absolute paths)

| File | Role |
|---|---|
| `/Users/luis/Code/hiraia/finetuning/cpt/run_ceb_supervisor.sh` | Supervisor loop (bash). Cycles: feeder → generator → sleep 900s. Survives generator crashes; daily-cap exhaustion just idles until the UTC-midnight reset. |
| `/Users/luis/Code/hiraia/finetuning/cpt/gen_ceb_ox.py` | Core generator: lanes, QC gate, resume, daily caps, stats. |
| `/Users/luis/Code/hiraia/finetuning/cpt/feed_ceb_queue.py` | Queue feeder: appends Tagalog chunks when the un-attempted remainder < 1500. |
| `/Users/luis/Code/hiraia/finetuning/cpt/build_ceb_queue.py` | Original queue builder (LRMDS + science + v3 edu samples). Not in the loop; run once. |

### Data files (absolute paths)

| File | Contents |
|---|---|
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/docs_ceb.jsonl` | **THE PRODUCT (OC/OR).** Kept docs, one JSON per line: `{text, src, src_id}`. |
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/docs_ceb_all.jsonl` | Audit trail: every model output incl. rejects, with `lid`, `lid_conf`, `bleed`, `verdict`. |
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/docs_ceb_grok.jsonl` | **GROK SIDECAR.** Same `{text, src, src_id}` schema. `src=grokgen`. Not written by this supervisor. See §10. |
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/SIDECAR-GROK.md` | Pointer for anyone inspecting this directory: a third lane exists; do not merge until packaging. |
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/queue.jsonl` | Translation queue (Tagalog chunks, ≤3,500 chars, `{text, src, src_id}`). |
| `/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb/gen-state.json` | Per-lane daily call counters keyed by UTC day + OC generation seq. |
| `/Users/luis/Code/hiraia/finetuning/cpt/local-v3-run/final_tl_v3.jsonl` | Feeder source: 15M-doc Tagalog pool (5.47GB) used to top up the queue. |
| `/tmp/sailcraft-local/lm_resource/lid.176.bin` | fastText language-ID model (176 langs) used by the QC gate. |
| `/tmp/ceb-gen.log`, `/tmp/ceb-feed.log`, `/tmp/ceb-supervisor.log` | Runtime logs (volatile, /tmp). |

### Credentials

Read at runtime from `/Users/luis/Code/hiraia/.env.local`:
- `OPENROUTER_API_KEY` — OpenRouter (lane OR).
- `OPENCODE_API_KEY` — OpenCode Go subscription key (lane OC).

## 3. Lane OR — OpenRouter translation

- Endpoint: `https://openrouter.ai/api/v1/chat/completions`, model
  `stealth/ox-alpha`, via Python `urllib` (Cloudflare does not block this host).
- Task: translate Tagalog educational text → natural Cebuano for elementary
  children. System prompt demands faithful meaning/structure, output only.
- **Batching: 4 chunks per call** with `[N]` markers; responses split on the
  markers (`split_batch`). The free tier caps requests/day, not tokens, so
  batching multiplies daily yield ~4x. `max_tokens` 16000 (reasoning model —
  must leave headroom for hidden reasoning tokens).
- Daily cap: 950 calls (account's free tier is 1000/day; margin kept).
- Timeout 600s; typical good-window latency ~3.5 min/batch.
- Workers: 4 concurrent (`OR_CONC`).
- Backoff: 4 attempts/call; HTTP 429 → 120/240/360/480s (upstream congestion
  lasts for long stretches — short retries just burn the daily cap); other
  HTTP errors → 10/20/30s. Failed batches are NOT marked done, so resume
  re-queues them next cycle.

## 4. Lane OC — OpenCode generation

- Endpoint: `https://opencode.ai/zen/go/v1/chat/completions`, model
  `ox-alpha-free`.
- **Transport: real `curl` via `subprocess`, never urllib.** opencode.ai's
  Cloudflare bot-ban (error 1010, then silent 503s) rejects urllib even with a
  spoofed UA (TLS fingerprint); genuine curl passes.
- **Load-bearing constraint: the gateway sheds any request that runs longer
  than ~4 minutes** (503 at ~256s, or a silent hang past 600s). Long
  translation batches die every time; short generations succeed. This is why
  the lane generates instead of translating.
- Task: short-form GENERATION — ~200-word Cebuano pieces: stories with a
  moral, lessons with questions, expository paragraphs, poems, dialogues,
  essays, folk tales; 30+ topics (rice planting, fishing, family, hygiene,
  fiestas, animals, school life…) × 7 formats × grades 1–6, randomized per
  call (`make_gen_prompt`). `max_tokens` 2500, timeout 240s, ~50s/call.
- Daily cap: 2000 calls (`CAP_OC`; no documented limit — self-imposed
  politeness cap).
- Workers: 2 concurrent (`OC_CONC`); more trips the burst-shed.
- Backoff: per-call 4 attempts, 30/60/90s + 0–10s jitter on any non-2xx;
  lane-level escalation on repeated failure (60→300s cap, reset on success).
- Output `src_id` namespace: `ocgen:<seq>` (seq persisted in `gen-state.json`).

## 5. QC gate (the "judge")

Inbound documents are judged **algorithmically, inline, before being kept** —
no LLM judge. Per candidate doc (`process_item` in `gen_ceb_ox.py`):

1. **Minimum length** — <100 chars → `fail`.
2. **Language ID** — fastText `lid.176.bin` on the first 2,000 chars; must be
   `ceb` with confidence ≥ 0.70, else verdict `lid`.
3. **Tagalog-bleed heuristic** — fraction of words matching Tagalog-DISTINCTIVE
   function words (`ay, ng, nang, iyon, natin/atin, upang, kahit, din/rin, po,
   sana, daw/raw, ito, kasi, …`); > 0.04 → verdict `bleed`. (The marker list is
   deliberately tl-only: shared words like `ang/sa/na/kung/ba` are excluded —
   an earlier version used them and dropped 23/30 good outputs.)
4. Verdict `ok` → appended to `docs_ceb.jsonl`. **Every** candidate, kept or
   not, is appended to `docs_ceb_all.jsonl` with its scores for audit.

Observed QC rates: ~80% keep, ~19% LID drop, ~1% bleed drop.

Historical note for the dashboard spec: the strategy itself was green-lit by an
agent-side quality review of early output (2026-08-23 morning) — natural,
fluent, grade-appropriate Cebuano with correct pedagogical register — before
volume production was allowed to start.

## 6. Resume, caps, and failure semantics

- **Resume:** on startup, all `src_id`s in `docs_ceb.jsonl` are skipped when
  re-reading the queue. Killing/relaunching the generator loses only in-flight
  API calls. (Note: resume reads the *kept* file, so QC-rejected chunks are
  retried on the next cycle — mildly wasteful, deliberately simple.)
- **Daily caps** live in `gen-state.json` under `calls["YYYY-MM-DD:<lane>"]`,
  UTC day. A capped lane stops calling; when both lanes are capped the
  generator exits, the supervisor sleeps 15 min and relaunches (a capped
  relaunch is a cheap no-op), real work resumes at UTC midnight.
- **Feeder:** each supervisor cycle, if un-attempted queue remainder < 1500
  chunks, `feed_ceb_queue.py` random-offset-samples the 15M-doc TL final
  (50% pedagogical-marker docs, 50% general LID-verified Tagalog), chunks to
  ≤3,500 chars, appends with fresh `v3xedu:`/`v3xgen:` src_ids, deduped against
  everything queued or attempted.

## 7. Observed production behavior (day 1, 2026-08-23)

- ~690 docs banked in the first ~22 hours (~25–35/hr steady state).
- Split: ~78% OC generation / ~22% OR translation. OC is the reliable
  workhorse; OR is feast-or-famine behind upstream free-tier congestion
  (multi-hour 429 windows are normal).
- QC: 80% ok / 19% lid / 1% bleed.
- Failure modes seen and handled: Cloudflare 1010 (urllib UA), burst-shed on
  >2 concurrent OC calls, ~256s long-call shed, OR multi-hour 429 congestion,
  OC upstream "Endpoint is unavailable" 503 waves.

## 8. Cloud-migration notes (for the automation workstream)

- Stateless-ish: the only durable state is `synth-ceb/` (4 files) +
  `gen-state.json`. Sync these to cloud storage (or run the whole thing on a
  cloud VM) and the Mac can go offline freely.
- Hard runtime dependencies: Python 3 with `fasttext`, the 126MB
  `lid.176.bin`, `curl` on PATH, both API keys. No GPU needed.
- If the feeder is wanted in the cloud, it also needs
  `local-v3-run/final_tl_v3.jsonl` (5.47GB) — or point `V3` at a cloud copy.
  Without it the queue simply stops topping up after ~7k chunks.
- Everything is nohup-safe; there is no IPC, no sockets, no cron dependency —
  the supervisor loop is self-contained. Monitoring greps for
  `[gen] kept=…` lines in `/tmp/ceb-gen.log`.
- Packaging at end-of-window (pool_ceb_v4): dedup + Qwen3.5 token measure of
  `docs_ceb.jsonl`, then push to RunPod volume `hiraia-cpt-expansion`
  (US-NE-1) alongside pool_ceb_v2/v3. Do NOT touch volume `1atl7503ky` or
  pods `hiraia-probe-cpt`/`hiraia-probe-helper` (live training).

---

## 9. Cloud migration — DONE 2026-08-24

Production moved off the Mac to the Vultr VPS (`hiraia.b11.dev`) so a laptop
going offline (flight) can't stop the free-window clock. The Mac supervisor is
stopped; **the VPS is now the sole producer** (running both would double-consume
the same per-account daily API caps).

| On the VPS | Path |
|---|---|
| venv (`fasttext`, **`numpy<2`**) | `/opt/synth-ceb/venv` |
| scripts | `/opt/synth-ceb/scripts/{gen_ceb_ox.py,feed_ceb_queue.py,run_ceb_supervisor_vps.sh}` |
| LID model | `/opt/synth-ceb/lm_resource/lid.176.bin` |
| API keys (mode 600) | `/opt/synth-ceb/env` |
| **durable state (the product)** | `/var/lib/synth-ceb/{docs_ceb.jsonl,docs_ceb_all.jsonl,queue.jsonl,gen-state.json}` |
| logs | `/var/log/synth-ceb/{gen,feed,service}.log` |
| service | `systemctl {status,restart} synth-ceb` (Restart=always, enabled at boot) |

**Script changes:** all hardcoded Mac paths are now env-overridable —
`SYNTH_CEB_DIR`, `LID_MODEL`, `SYNTH_ENV_FILE`, `SYNTH_CPT_DIR`, `SYNTH_V3`.
Defaults are unchanged, so the Mac copy still runs as before.

**Gotcha found in migration:** fastText 0.9.x calls `np.array(..., copy=False)`,
which **raises under NumPy 2.x** — every QC call dies and nothing is ever kept.
Pin `numpy<2` in any environment running the QC gate.

**Feeder:** the 5.47GB `final_tl_v3.jsonl` was NOT uploaded, so the supervisor
skips the feeder and the queue does not top up. This only limits **lane OR**
(translation), which drains the 7,485-chunk queue in ~2 days at 950 calls/day.
**Lane OC (generation, ~78% of output) needs no queue and runs indefinitely.**
To restore feeding, copy a slice of the v3 TL pool to the VPS and set `SYNTH_V3`.

**Monitoring:** live at https://hiraia.b11.dev/admin — banked/attempted counts,
QC keep-rate with verdict breakdown, OC/OR lane split, queue depth, per-lane
daily cap bars, generator service status, and a cumulative production curve.
The guard (`monitor.py`, every 5 min) emails if no new doc is written for >3h,
since idle hours inside the free window are unrecoverable.

**Consolidation (still to do at window close):** dedup + Qwen3.5 token measure of
`/var/lib/synth-ceb/docs_ceb.jsonl` **plus** the Grok sidecar
(`finetuning/cpt/synth-ceb/docs_ceb_grok.jsonl`, `src_id` prefix `grokgen:`),
then push as `pool_ceb_v4` to RunPod volume `hiraia-cpt-expansion` (US-NE-1)
alongside pool_ceb_v2/v3.

---

## 10. Lane GROK — in-session sidecar (not this supervisor)

A third generation lane runs **in a separate Grok Build session**, writing
Cebuano stories without OpenRouter / OpenCode / xAI API keys. It exists so
this free-window job can pick up extra short-form Cebuano without sharing
OC/OR daily caps or touching the VPS live bank.

| | |
|---|---|
| Who | Separate session (not `synth-ceb.service`) |
| Task | Same as Lane OC: ~200-word elementary Cebuano, `GEN_FORMATS` × `GEN_TOPICS` × grades 1–6 |
| Product file | `finetuning/cpt/synth-ceb/docs_ceb_grok.jsonl` |
| Audit file | `finetuning/cpt/synth-ceb/docs_ceb_grok_all.jsonl` |
| Schema | `{text, src, src_id}` — `src` = `grokgen`, `src_id` = `grokgen:<n>` |
| QC | Same gate: `len≥100`, fastText `ceb≥0.70`, Tagalog-bleed `≤0.04` |
| Pointer | `finetuning/cpt/synth-ceb/SIDECAR-GROK.md` |

**Do not:** append Grok output into `/var/lib/synth-ceb/docs_ceb.jsonl` while
`synth-ceb.service` is running; reuse `ocgen:` / OR / `lrmds:` / `v3x*` ids;
start a second Mac supervisor.

**Do:** leave the sidecar on the Mac repo until window-close packaging, then
`cat` it into the VPS bank and run the existing dedup + token measure. Resume
on OC/OR is unaffected because `src_id` namespaces never overlap. After every
batch, POST the new rows to the dashboard ingest endpoint
(`POST /admin/api/synth-grok`, `X-Token` header, payload
`{"kept":[...],"audit":[...]}` — full instructions in `SIDECAR-GROK.md`) so the
admin panel can chart Grok next to OC/OR; the VPS copy at
`/var/lib/synth-ceb/docs_ceb_grok.jsonl` is canonical once acknowledged.

---

## 11. Lane FW — DeepSeek V4 Flash (Fireworks), VPS, paid

Fourth generation lane, **own systemd unit** (`synth-ceb-fw.service`), so a
Mac going offline does not stop it and it does not share the OC/OR process or
`docs_ceb.jsonl` writer.

| | |
|---|---|
| Model | `accounts/fireworks/models/deepseek-v4-flash-0731` |
| Script | `/opt/synth-ceb/scripts/gen_ceb_fw.py` + `run_ceb_fw.sh` |
| Product | `/var/lib/synth-ceb/docs_ceb_fw.jsonl` `src=fwgen` `src_id=fwgen:<n>` |
| Audit | `/var/lib/synth-ceb/docs_ceb_fw_all.jsonl` |
| Spend | `/var/lib/synth-ceb/fw-state.json` — **$10/UTC day**, stops itself |
| Window | `FW_UNTIL_UTC` default `2026-08-31T00:00:00Z` (end of week) |
| QC | same gate as OC |
| Dashboard | `/admin` Flash tile + amber stacked bar |

Pointer: `finetuning/cpt/synth-ceb/SIDECAR-FW.md`. Do not reuse `ocgen:` /
`grokgen:` / OR / `lrmds:` / `v3x*` ids. Merge at packaging.

## 11. Window CLOSED — 2026-08-26 (two days early)

Every request from ~13:55 UTC returned `"Thank you for participating in the Stealth Ox Alpha
testing period. This model was…"` (HTTP 404); 233 retries hit it before the supervisor was
stopped. **Final bank: 4,134 QC-passed Cebuano documents (6.1 MB).** Service stopped and
disabled on the VPS.

Archived, sha256-verified after re-download, to the PRIVATE HF dataset repo
`Cryptopop/hiraia-cpt-corpus-archive` at `pool_ceb_v4/synth-ceb-2026-08-26.tar.gz`
(`docs_ceb.jsonl` + `docs_ceb_all.jsonl` audit trail + `history.jsonl`).

**Status vs. the plan:** the same day, the SFT v1 routing test showed the Cebuano→Tagalog leak
is an SFT-data gap, not a corpus gap (`SFT-V1-ROUTING-FINDING.md`). So this corpus is *not*
needed for SFT v2 and does not gate anything. It is banked for a future CPT refresh, where
4,134 docs (~1.4M tokens) is a modest but clean Cebuano addition.
