# Illustration audit and regeneration (21–22 Sep 2026)

About fifteen hours of model scoring, ChatGPT Image 2.0 redraws, and pack rebuild. Nothing here is a human art sign-off.

## What we scored

Qwen 3.8 Omni Flash (`qwen3.8-omni-flash`, thinking off) reviewed the frozen 35,645-image inventory: one **visual** job per unique PNG, one **alignment** job per illustrated card. A known-bad headless carabao fixture had to anatomy-reject before the corpus ran. Throughput was ~96–128 in-process workers against DashScope.

First full pass: 76,629 jobs. About 1,196 came back as API/import errors (mangled `job_id`, markdown-fenced JSON, missing braces, DashScope output inspection). 891 of those were salvaged from saved streams without a second POST; 305 were requeued; 146 stayed errors.

## What we redrew

Visual reject / uncertain / leftover-error images that still had generation prompts went to **gpt-image-2** (low, 1024², opaque, engraving style):

| Batch | n | Role |
|---|---:|---|
| 1–2 | 5,485 | First redraw of the review pile |
| 3 | 1,729 | Later `ffct-*` / `qa-*` prompts found on a second pass |
| 4 | 3,532 | Prompt-rewritten leftovers after Qwen still flagged them |

Outputs were extracted, run through `packages/images/to-card-png.mjs` (512px, grayscale, 8-color indexed PNG, ~15 KB), and written over `cards-png/` and `assets-png/` with the same slugs. A few dozen ids never came back from OpenAI.

Qwen then scored the new bytes: snapshot `2026-09-22-regen` (7,168 images) then `2026-09-22-batch4` (3,518 prompt-fixed files). After overlaying those verdicts on the original inventory, the live corpus was **34,123 pass / 919 uncertain / 564 reject / 39 error**.

## What shipped vs what we pulled

**Rejected (564 unique PNGs).** Moved to `packages/images/quarantine-qwen-reject/` (binaries gitignored; slug list in `tools/image-audit/qwen-reject-slugs.json`). Cleared `slug` on 631 cards in `cardsPool.app.json` so they print as posters. Rebuilt `cards.db` / `cardsIndex`. Removed three dangling `assets-png/flagged/` symlinks whose targets had moved.

**Accepted remainder.** Re-cut the 140 MB bundled head and download tail:

- 12,149 bundled + 22,932 downloadable = 35,081 images still in circulation
- 42 packs, manifest version `14d7c42699fd80bd`
- Grade 3–10 coverage: 0 missing required images
- `pnpm qa:images` green

Packs were **not** published to R2. Uncertain images stay in circulation. Prompt rewrites for the 3,532 leftovers live in `packages/images/qwen-queue/audit-regen/prompt-rewrites.jsonl`.
