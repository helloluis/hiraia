# K3 sidecar — not the OC/OR bank

This directory's live product is `docs_ceb.jsonl`, written by `gen_ceb_ox.py`
(OpenRouter translation + OpenCode generation) on the VPS
(`synth-ceb.service` → `/var/lib/synth-ceb/`).

**A fourth lane runs in the Kimi K3 corpus session** (no API keys, no
supervisor — Paseo heartbeat drives an in-session agent). It writes:

| File | Role |
|---|---|
| `docs_ceb_k3.jsonl` | Kept docs. `{text, src, src_id}` with `src=k3gen`, `src_id=k3gen:<n>` |
| `docs_ceb_k3_all.jsonl` | Audit (same QC fields as `docs_ceb_all.jsonl`) |

QC runs **at write time** on this host (fastText available), unlike the Grok
sidecar — only gate-passing rows enter the kept file.

Do **not** append those rows into `docs_ceb.jsonl` while the VPS generator is
running. Merge at window-close packaging (`pool_ceb_v4`), after dedup.

## Push to the dashboard (automatic per batch)

Each batch is pushed by `../k3_sidecar.py` to
`POST https://hiraia.b11.dev/admin/api/synth-k3` (`X-Token` header, payload
`{"kept":[...],"audit":[...]}`, cap 4MB). The canonical copy after a successful
push is `/var/lib/synth-ceb/docs_ceb_k3.jsonl` on the VPS; local Mac copies are
the fallback. The endpoint appends and does not dedup — only send each row once.

## Paseo fleet (fills this sidecar)

| | |
|---|---|
| Main | heartbeat `d79425c7` (corpus session itself), 24 docs/fire at `:06/:21/:36/:51` Manila, untagged ids `k3gen:<n>` |
| Worker b | schedule `f7121a04`, fresh `kimi-code/k3` agent per fire at `:02/:17/:32/:47`, ids `k3gen:b:<n>` |
| Worker c | schedule `07b95c39`, fresh `kimi-code/k3` agent per fire at `:09/:24/:39/:54`, ids `k3gen:c:<n>` |
| Worker d | schedule `7b87dcb2`, fresh `kimi-code/k3` agent per fire at `:12/:27/:42/:57`, ids `k3gen:d:<n>` |
| Batch | 24 pieces per fire (~8–9k est. tokens), 150–300 words each |
| Mechanism | agent writes candidates → `../k3_sidecar.py <file> [tag]` QC + seq + push |
| Ceiling | 4 producers × 24 docs × 96 fires/day ≈ 3.2M est. tokens/day (realistic ~1.5–2.5M after QC drops/coalescing) |
| Expires | end of the Ox Alpha free window (~2026-08-28/29) |
| Stop | `delete_heartbeat` the main + `delete_schedule` b/c/d |

Spec: `../SYNTH-CEB-SPEC.md` §10 (Grok pattern; K3 mirrors it).
