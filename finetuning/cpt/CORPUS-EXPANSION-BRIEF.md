# Corpus expansion brief — build corpus-v2 (handoff doc)

**For:** the corpus-expansion agent (separate session). **Written 2026-08-22** by the probe-path
session. Context: `CPT-FLAGSHIP-PLAN.md` §5/§5b, `PROBE-CPT-CONFIG.md`, project memory
(`hiraia-runpod-cgroup-quota`, `hiraia-cpt-flagship-plan`).

## Mission — **now load-bearing, not optional** (measured 2026-08-22)

v1 measured with the real Qwen tokenizer (3.20 chars/token tl, 3.12 ceb):
**tl = ~1.53B tokens, ceb = ~167M tokens.** The full 25B run wants ~15.6B tl at ≤4 epochs —
v1 alone yields 6.1B (a 10-epoch corpus is not defensible). **Your target: ≥2.5B new distinct
clean tl tokens (stretch: 4B+)**, which puts v1+v2 at ≥4B → ≤4 epochs for the full run.
Cebuano: every real token counts — v1's cleaned pool is under half the June inventory estimate.

## YOUR volume (isolation is physical, not conventional)

- **Your volume: `hiraia-cpt-expansion` (`6er6skgoyb`, US-NE-1, 300GB).** All your pods attach
  THIS volume, mounted at `/workspace`. You build everything from a fresh clone/venv on it
  (repo has all configs: `finetuning/cpt/sailcraft-filipino/` + `deploy_sailcraft_scale.sh`
  as the setup template — it documents the full venv/patch/LID bootstrap).
- **The v1 volume `hiraia-cpt-corpus` (`1atl7503ky`) is OFF-LIMITS. Never attach it, never
  pass its id to any API call.** This is the probe session's working volume; isolation is the
  point of your separate volume. Anything you need from v1 you re-derive from HF (pinned
  revisions below) or request from the probe session via SendMessage.
- v1 reference numbers (for your targets, not your inputs): finals tl 3,487,659 docs / 4.7GB
  (~1.5–2B Qwen tokens), ceb 340,960 / 509MB. v1 MADLAD pull revision: `9d886a76bd8f` —
  **re-pull MADLAD `data/fil/*` noisy files from HF at that exact revision** (free ingress,
  ~7GB; do NOT try to read them off the v1 volume).
- Merge protocol: your deliverable stays on YOUR volume; the probe session pulls the finals
  pod-to-pod at mix time. You never write to v1 paths because you never see them.

## Source priority (expected yield)

1. **MADLAD-400 `fil` NOISY split** — the big lever (likely 2–4× the clean split's volume; the
   ceb pass already validated noisy-mining: the LID-0.70 gate + filters did the QC). Re-pull
   `data/fil/*` from HF at revision `9d886a76bd8f` onto YOUR volume and use only the
   `*noisy*` files for `pool_tl_v2` (v1 already consumed the clean split).
2. **BloomLibrary** ceb+tl books — small but high-quality child-register text (exactly our
   domain). Harvest method: memory `bloomlibrary-cebuano-access` (Parse API + S3, CC-licensed).
3. **OPUS** tl+ceb (Tatoeba, wikimedia, GNOME/Ubuntu are sentence-level — lower CPT value;
   prefer document-level corpora like OpenSubtitles carefully or skip. Judgement call: don't
   spend more than an hour here.)
4. **Tagalog Wikipedia** (tl.wikipedia.org dump — the REAL one; the ceb-Wikipedia Lsjbot trap
   does not apply to tl, but still run it through SailCraft).
5. FineWeb-2 `fil_Latn` "removed" config — investigate briefly; likely skip (it's what FW2's
   own filters rejected).

## Method (all patterns proven; deviations = your risk)

1. Pull: extend the `pull_corpus.py` SOURCES pattern (new sources → `corpus/raw/<name>/`,
   revision-pinned manifest entries). hf_xet ≥1.6 works direct from HF.
2. Pools: `prep_pools.py` pattern → `pool_tl_v2.jsonl` = NEW material only (v2 is additive;
   cross-v1/v2 dedup happens later at tokenization mix time — do NOT re-clean v1).
   **Shuffle the pool file before the pipeline** (`shuf`), always.
3. SailCraft: reuse the repo template `finetuning/cpt/run_sailcraft_stages.sh` (volume paths,
   `--num_proc` quota-sized, direct `main_filtering.py` call for stage 4) — adapt aliases and
   language id (`tl` / `ceb`). Bootstrap the SailCraft clone+venvs per
   `deploy_sailcraft_scale.sh`'s remote-setup block.
4. Measure the yield with the Qwen3.5 tokenizer (sample-based is fine: tokenize 10k random
   docs, extrapolate by bytes) and report tokens, not GB.

## Hard rules

- **`num_proc` = (cgroup quota − 2), NEVER `nproc`.** Read `/sys/fs/cgroup/cpu.max` (22.1 cores
  on a 1×H100 SXM pod; `nproc` lies with the host's 208). This cost us a whole evening.
- **Own pod** (don't touch the probe session's pods): US-NE-1, volume **`6er6skgoyb`** (yours),
  `supportPublicIp: true`, cheapest available tier is fine (this is CPU work; MIG slice or
  H100). Launcher pattern: `finetuning/cpt/deploy_sailcraft_scale.sh` (swap in your volume id).
- **Self-terminating driver**: the driver's last act is
  `curl -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID`
  (pass the key via pod env at creation; `$RUNPOD_POD_ID` is set by RunPod automatically).
  Never leave shutdown to a session loop — sessions die overnight (cost $25 on 08-21).
- Keep ≥80GB free on the volume; `rm` pipeline intermediates (`near_dedup_output`,
  `exact_dedup_output`, caches) after each pool's final output is verified.
- Venv paths: SailCraft stage scripts call bare `python` — export
  `PATH="/workspace/sailcraft-run/.venv/bin:$PATH"` when running drivers. uv venvs have **no
  pip binary** — install with `uv pip install --python <venv>/bin/python`.
- Env sourcing: `. ./.env.local` with the leading `./` (zsh silently no-ops without it);
  `scp` uses capital `-P` for port.
- Log pods + $ to `corpus/LEDGER.md` (reimbursement accounting).

## Definition of done

`final_output/pool_tl_v2/data_clean.jsonl` (+ `pool_ceb_v2` if sources landed) verified
(line count + full-line JSON parse of head/tail), measured token yield reported, intermediates
cleaned, pod self-terminated, summary appended to `corpus/EXPANSION-REPORT.md` on the volume
AND committed to this repo as an update to this file's **Results** section. Optionally message
the probe session (`ListAgents` → `SendMessage`) when the corpus lands.

## Results (filled in 2026-08-22 by the corpus-expansion session)

**Deliverables (on `hiraia-cpt-expansion` `6er6skgoyb`, verified, pod self-terminated):**

- `final_output/pool_tl_v2/data_clean.jsonl` — **2,229,505 docs / 4.83 GB / ≈1.49B Qwen3.5
  tokens** (10k-doc sample, 0.3084 tok/B; `corpus/TOKEN-YIELD.v2.json`). Line count + head/tail
  JSON parse: OK.
- `final_output/pool_ceb_v2/data_clean.jsonl` — 25 docs / ~15k tokens (symbolic only).
- `corpus/EXPANSION-REPORT.md` + `corpus/LEDGER.md` on the volume; copies of the v2 scripts
  committed to this repo (`finetuning/cpt/{pull_corpus_v2,prep_pools_v2,harvest_bloom,
  measure_tokens}.py`, `driver_v2.sh`, `deploy_expansion_v2.sh`).

**Headline: the ≥5–6B tl target was NOT met.** v2 tl ≈ 1.49B tokens; combined with v1's
~1.5–2B the total is ≈3–3.5B clean tl. The noisy split's *input* was the predicted ~3× of clean
(15.0 GB pool, 4.21M docs vs v1's 4.7 GB/3.49M), but near+exact dedup removed ~⅔ of those bytes
as redundancy — MADLAD `fil` noisy is heavily near-duplicate. Post-clean it lands at ~1× v1, not
2–4×. To actually reach 5–6B, more *distinct* sources are needed (OPUS document-level, FW2
`fil_Latn` removed-config mining, CommonCrawl re-extract) or the epoch budget has to rise.

**Source outcomes:** MADLAD `data/fil/*` re-pulled at pinned rev `9d886a76bd8f…ee5a5` (7.0 GB,
4 min). BloomLibrary: tl 667/682 books kept (4.7 MB), ceb 423/425 (0.46 MB) — CC-only, Parse API
+ S3 (`<baseUrl><FolderName>.htm`; old books key S3 by uploader-email, new by objectId —
`harvest_bloom.py` handles both). tlwiki: 49,170 articles extracted. Skipped per plan: OPUS,
FW2-removed, ceb.wikipedia. ceb note: SailCraft filtered Bloom ceb 423→25 docs (word_repetition
211, lang_id 145 — picture-book repetition + English credit lines); the gate works, the source
is just tiny.

**Run facts:** pod `6xy1ddwk4g6nap` (H100 SXM, US-NE-1), 07:53→10:22 local ≈ 2.5h wall
(~$8); inspect pod `kqe2owhz2x13td` ~10 min. Stage timings (tl): clean-1 ~20 min, minhash ~5 min,
exact-dedup ~25 min, clean-2 ~7 min. Intermediates removed; raws kept (madlad 6.7G, tlwiki 173M,
bloom ~8M); volume ~35 GB used of 300 GB.

**New lessons (beyond the brief's hard rules):**
- RunPod pod `env:` does NOT reach SSH sessions on `runpod/pytorch` images (even
  `RUNPOD_POD_ID` is empty over ssh) — self-termination creds must go via a root-only file the
  driver sources (`/root/.driver-env`; deploy script does this).
- Empty `HF_TOKEN` env → huggingface_hub sends `Bearer ` → httpx `LocalProtocolError`. Coerce
  `""`→`None` (fixed in `pull_corpus_v2.py`).
- `pkill -f <pattern>` over ssh self-matches the invoking shell's own cmdline — kills the shell
  before it kills the target. Use explicit PIDs or `[.]`-class patterns.
- SailCraft exact-dedup (stage 3) reads host `nproc` (208) for `--num-threads`, not the cgroup
  quota — oversubscribes ~10×. Works, just slow; patch `code/exact_dedup/run_example.sh` if a
  re-run happens.
- `nohup … &` over ssh needs `< /dev/null` or ssh hangs on the open channel.
- Bloom: `bloomdigital/index.htm` from the old probe 404s on current books; and Bloom ceb/tl
  books are multilingual — extract per-`lang`-tag text only.
