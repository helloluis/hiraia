# SailCraft — Filipino (tl + ceb) configs

Committable, **proven** Tagalog + Cebuano config for [`sail-sg/sailcraft`](https://github.com/sail-sg/sailcraft),
the 4-stage data-cleaning pipeline for the CPT flagship plan
([`CPT-FLAGSHIP-PLAN.md`](../../../CPT-FLAGSHIP-PLAN.md) §5/§5a, Stage 0).

**Status: validated end-to-end 2026-06-22.** All 4 stages ran on real
MADLAD-400 v1.5 `fil`(=tl) + `ceb` data (3,000-doc heads each), ~$0, CPU-only,
on macOS (Apple Silicon). This directory is the day-1 starting point so the work
does not have to be re-derived.

> SailCraft itself, the corpus, and model weights are **not** committed — only
> these small text configs/patches. Run SailCraft from a fresh clone in `/tmp`.

---

## What's here

| File | What |
|---|---|
| `snippets/*.tl_ceb.py` | The tl/ceb additions as **standalone, paste-able** snippets (version-proof). |
| `patches/*.patch` | The same edits as `git diff` against upstream `main` (apply with `git apply`). |
| `requirements-clean.txt` | Py3.11 deps for the data-cleaning stages (1 & 4), repinned off the rotted 2022 pins. |
| `requirements-dedup.txt` | Py3.11 deps for near-dedup (stage 2) — **separate venv**, `text-dedup==0.4.0`. |
| `fetch_sample.py` | Pull a tl+ceb sample to SailCraft's input dir (MADLAD default; CulturaX opt). |
| `derive_ceb_stopwords.py` | Rebuild the Cebuano stopword list from a corpus head + function-word prior. |
| `run_filipino_pipeline.sh` | Executable end-to-end driver (all 4 stages, both langs) — the recipe as code. |
| `ceb-stopwords.derived.json` | The 161-word Cebuano stopword list this run produced (provenance asset). |
| `stopwords-tl.txt` | 146 Tagalog stopwords from `stopwords-iso/stopwords-tl` (MIT). |
| `filipino-badwords.json` | 97 flagged words from `jromest/filipino-badwords-list` (MIT). |

---

## Day-1 data recipe (validated)

```bash
SAILCRAFT=/tmp/sailcraft-run
git clone --depth 1 https://github.com/sail-sg/sailcraft "$SAILCRAFT"

# 1. Python 3.11 — the #1 gotcha. uv is the cleanest way (no brew/pyenv needed):
curl -LsSf https://astral.sh/uv/install.sh | sh        # if not installed
cd "$SAILCRAFT"
uv venv --python 3.11 .venv                            # cleaning stack
uv venv --python 3.11 .venv-dedup                      # text-dedup stack (separate!)
uv pip install --python .venv/bin/python       -r .../requirements-clean.txt
uv pip install --python .venv-dedup/bin/python -r .../requirements-dedup.txt

# 2. Apply the tl/ceb configs (either patches OR snippets):
git apply .../patches/*.patch          # clean against upstream main
#   …or paste each snippets/*.tl_ceb.py into the matching code/data_cleaning/*.py

# 3. fastText LID model (stages 1 & 4 need it; lid.176 already supports tl + ceb):
mkdir -p lm_resource && curl -L -o lm_resource/lid.176.bin \
  https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin

# 4. Rust toolchain (stage 3 only):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 5. Pull a real tl+ceb sample (MADLAD-400 v1.5, ungated):
HF_TOKEN=hf_... .venv/bin/python .../fetch_sample.py --n 3000 --out_dir data/data_input

# 6. Run all 4 stages on both languages:
SAILCRAFT=$SAILCRAFT bash .../run_filipino_pipeline.sh
```

---

## Config decisions (the actual additions)

Added to four files in `code/data_cleaning/`:

- **`languages_id.py`** — `tl` and `ceb` rows. `stopwords_id`/`flagged_words_id`/`fasttext_id`
  point at the new lists; **`sentencepiece_id` and `kenlm_id` are empty `""`** so the model
  loaders return `None` and the perplexity filter is skipped (no tl/ceb KenLM exists yet).
- **`parameters_filtering.py`** — `parameters_filtering_tl` / `parameters_filtering_ceb`,
  seeded from the shipped `default` dict, then registered in the `parameters_filtering` map.
  Changes vs `default`:
  - `cond_check_perplexity = False` (skip the KenLM this pass).
  - `cond_check_lang_id = True`, `lang_id_min_cutoff = 0.70` — with perplexity off, fastText
    LID is the main quality gate. For `ceb` this also helps suppress Lsjbot Cebuano-Wikipedia
    bot-noise (templated, lower-confidence under LID).
  - `cond_check_flagged_words = True`, `flagged_words_max_cutoff = 0.01` (tighter than the
    default 0.1) — matches the SEA configs (`ms`) and is appropriate for child-facing data.
- **`stopwords.py`** — `'tl'` (146 words, `stopwords-iso/stopwords-tl`, MIT) and `'ceb'`
  (161 words, **corpus-derived** — no native list exists; see `derive_ceb_stopwords.py`).
- **`flagged_words.py`** — `"tl"` and `"ceb"` = `english_flagged_words` + the 97
  `jromest/filipino-badwords-list` terms (`ceb` reuses the tl list as a placeholder; many
  terms are shared. Extend with native ceb profanity when a list is curated).

### Required upstream fixes (also in the patches)

These are upstream bugs/rot that bite the moment you add a partially-resourced language:

1. **`filtering.py` NaN-guard** — an empty config cell becomes `NaN` (a *truthy* float) →
   `KeyError: nan`. Guarded all five `LoadParameters.load_*` lookups with
   `pd.notna(x) and x`.
2. **`filtering.py` lazy `kenlm`** — `import kenlm` moved inside `load_kenlm_model` (only runs
   when a real LM is configured). `kenlm==0.2.0` does not build on modern CPython, and we
   skip perplexity, so we never import it.
3. **`parameters_filtering.py` emoji 2.x API** — `emoji.UNICODE_EMOJI["en"]` was removed;
   use `emoji.EMOJI_DATA` (with a `<2.0` fallback).

---

## Validated results (3,000-doc MADLAD-400 v1.5 heads, per-stage doc counts)

| stage | tl in→out | ceb in→out |
|---|---|---|
| ① initial clean | 3000 → **2418** | 3000 → **2406** |
| ② near-dedup (MinHash) | 2418 → **2418** | 2406 → **2399** |
| ③ exact-dedup (suffix-array) | 2418 → **3329**\* | 2399 → **3312**\* |
| ④ second clean | 3329 → **2958** | 3312 → **2774** |

\* **Exact-dedup raises the doc count by design.** It removes duplicate *byte-ranges*
(≥100 bytes) *within* documents and re-segments at the cut points, so it splits rather than
drops. The meaningful signal is the removed-substring volume:
**tl = 74,471** duplicate byte-ranges, **ceb = 78,341** (ceb higher — consistent with the
Cebuano-Wikipedia templating/repetition concern). Stage ④ then re-cleans the fragments.

### Top stage-① filter reasons (from the runtime PrettyTable; `_filter_cases.xlsx` logs the texts)

| reason | tl | ceb |
|---|---|---|
| flagged_words | 307 | 307 |
| lang_id | 99 | **234** |
| character_repetition | 146 | 5 |
| word_repetition | 30 | 45 |
| stopwords | 0 | 2 |
| perplexity | 0 (skipped) | 0 (skipped) |

`ceb`'s much higher **lang_id** rejection (234 vs 99) is expected and healthy: it's the LID
gate dropping non-Cebuano / mixed-language / bot-templated docs — exactly the Cebuano-noise
filter we wanted, now doing real work in the absence of a perplexity LM.

> The `_filter_cases.xlsx` reason logs land in `code/data_cleaning/filtering_logs/`. Note the
> shipped logger only stores ~2 example texts per reason (a sampled reason→example log); the
> authoritative per-reason **counts** are the PrettyTable printed at the end of each stage.

---

## Open items for the funded run (unchanged from §5a, now confirmed)

- **Perplexity LM (optional).** Train a SentencePiece + 5-gram KenLM on tl and ceb (cc_net
  recipe), drop into `lm_resource/{tl,ceb}.{sp.model,arpa.bin}`, set the `sentencepiece_id`/
  `kenlm_id` cells back to `tl`/`ceb`, flip `cond_check_perplexity=True`, and **re-calibrate
  `perplexity_max_cutoff` to your own LM** (the shipped per-lang cutoffs were tuned to cc_net's
  LMs and will not transfer). Most valuable for catching Cebuano-Wikipedia bot-noise.
- **Cebuano stopwords** are coarse (corpus top-freq + a function-word prior). Re-derive on a
  larger ceb sample and have a native speaker prune. Native ceb flagged-words still TODO.
- **Threshold tuning.** All cutoffs were copied from `default`/`ms`. Tune against the
  `_filter_cases.xlsx` logs on a larger sample (esp. `lang_id_min_cutoff` and
  `flagged_words_max_cutoff`).
- **Scale-out.** This was a single-machine CPU run (HF `datasets.map` across cores). For the
  full corpus, provision the Memory-Optimized CPU box from §8 and shard the input JSONL.

## Gotchas hit and fixed (so you don't re-hit them)

- **CulturaX is gated** — a valid HF token still 403s until the account is on the authorized
  list (a manual web click). We sourced from **MADLAD-400 v1.5** instead (ungated, a §5 source).
  `fetch_sample.py` defaults to MADLAD; pass `--source culturax` once access is granted.
- **Tagalog is the `fil` folder in MADLAD-400**, not `tl`. (Cebuano is `ceb`.)
- **`text-dedup` Python split.** 0.4.1 needs Python ≥3.12 and a changed CLI; on the
  recommended 3.11 you **stay on 0.4.0**. In 0.4.0 the `--local` flag means *load_from_disk
  (Arrow)* — so when feeding a `.jsonl` use `--path json --data_files ... ` and **omit
  `--local`** (the upstream `run_example.sh` is already correct here; just don't "fix" it to
  add `--local`). Install text-dedup in a **separate venv** — its deps conflict with the
  pinned `transformers==4.37.2`/`datasets==2.19.0` of the cleaning stage.
- **`fasttext` build.** Use `fasttext-wheel==0.9.2` (prebuilt); the source `fasttext==0.9.2`
  often fails to compile on modern toolchains.
- The legacy `tensorflow==2.9.0` block in upstream `requirements.txt` is **not needed** — exact
  -dedup is the native Rust binary; those TF pins are vestigial from Google's dedup repo and
  won't install on 3.11 anyway. Dropped.
