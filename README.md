# Hiraia

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-dark.svg)](https://github.com/tetherto/qvac)

An offline-capable AI Science tutor for Filipino students — powered by local inference on [QVAC](https://qvac.tether.io).

Hiraia brings AI tutoring to grade school and high school kids without requiring an internet connection. It speaks English, Tagalog, and Cebuano Bisaya naturally, and dynamically generates visuals to help explain scientific concepts.

## What's in a name?

"Hiraia" is a play on the Filipino word **hiraya** — meaning "hope" or "the fruit of one's dreams, visions, and aspirations" — with **AI** right in the middle.

## Features

- **Offline-first** — all AI inference runs on-device after initial model download
- **Multilingual** — English, Tagalog, and Cebuano Bisaya with LoRA fine-tuned adapters for natural language generation
- **Dynamic visuals** — generates educational diagrams and illustrations on-demand using Stable Diffusion (optional)
- **Curriculum-aligned** — grounded in the Philippine DepEd K-12 Science curriculum via RAG
- **Privacy-preserving** — student data never leaves the device

## Target Users

Grade school (Grade 3–6) and high school (Grade 7–10) students in the Philippines, starting with Science.

## Tech Stack

- **AI Runtime:** [QVAC SDK](https://github.com/tetherto/qvac) (`@qvac/sdk`)
- **LLM:** Qwen3.5-2B (Gated DeltaNet hybrid architecture, Apache 2.0)
- **Language adapters:** LoRA fine-tuned for Tagalog and Cebuano
- **Visual generation:** Stable Diffusion v2.1 (optional)
- **Mobile:** Expo (React Native) / TypeScript
- **Web demo:** Next.js / TypeScript
- **RAG:** GTE embeddings over DepEd Science curriculum content

## Getting Started

> Project is in early development. Setup instructions will be added as the codebase takes shape.

## Project Structure

```
hiraia/
├── packages/
│   ├── shared/       # Shared logic (prompts, curriculum, tutor engine interface)
│   ├── mobile/       # Expo React Native app (Android APK)
│   ├── web/          # Next.js web demo
│   ├── server/       # Hosted QVAC server config for web demo
│   ├── images/       # Educational illustration library + retrieval index
│   └── factoids/     # Daily "Alam mo ba na…?" auto-message (see below)
├── finetuning/       # LoRA training scripts and datasets
├── rag/              # RAG pipeline (chunking, embedding, indexing)
├── references/       # Raw curriculum materials (gitignored)
└── docs/             # Project documentation
```

See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for the full project specification and architecture decisions.

## Deployment

The web demo runs on a VPS (`main` is the single source of truth). See
[deploy/README.md](./deploy/README.md) for first-time setup; to redeploy the latest
`main` it's one command on the server:

```bash
/root/hiraia/deploy/update.sh   # sync origin/main → build web → restart pm2 (hiraia-web)
```

## Daily factoid message (`@hiraia/factoids`)

An unprompted message the tutor sends each student **every morning and evening**:
a random ~50-word science factoid plus its matching picture, in the fixed format
**`Alam mo ba na <hook>? <body>`** (`Did you know that…?` / `Nahibaw-an ba nimo
nga…?`). Full docs: [`packages/factoids/README.md`](./packages/factoids/README.md).

**Correctness model.** The on-device model is small and hallucinates, so factoids
are **not** generated live. They come from a **curated + verified bank** (authored
and fact-checked offline, stored `verified: true`; runtime only ever serves
verified ones) and are **image-anchored** (each factoid is tied to a real subject
in `packages/images`, so the picture is a guaranteed lookup, not a fuzzy search).

**Timezone.** "07:00" and "20:00" are timezone-dependent and must be the
**student's** zone (a morning message should land in *their* morning). The
default is **`Asia/Manila` (GMT+8)** since Hiraia is Filipino-centric; pass a
per-student IANA zone to override (`runScheduledMessage({ timeZone })` /
`--tz`). Slot evaluation is DST-correct via `Intl`, never the server clock.

**Regenerating the bank (scales with the language fine-tunes).** The pipeline is
idempotent/incremental and model-pluggable (any OpenAI-compatible endpoint via
`HIRAIA_LLM_*` env — point it at the sidecar running your best adapter; `--mock`
for offline plumbing). It separates **fact from phrasing**:

- `source` = the verified factual claim (English, language-neutral) — what the
  verifier checks.
- `hook`/`body` `{tl,en,ceb}` = per-language renderings — re-runnable freely as
  the Tagalog/Cebuano fine-tunes improve, **without re-verifying any fact**.
- `provenance.langMeta` = which adapter rendered each language, and when.

```bash
cd packages/factoids
# 1. Refresh a language as a better fine-tune lands (the common case):
node scripts/generate-factoids.mjs --mode translate --lang ceb --force
# 2. Grow the bank with new factoids → staging (verified:false):
node scripts/generate-factoids.mjs --mode draft --limit 30 --subject biology
# 3. Fact-check the gate: staging PASS → bank (verified:true), FAIL stays staged:
node scripts/verify-bank.mjs
# 4. Audit live facts with a stronger model:
node scripts/verify-bank.mjs --recheck
```

Because translations are renderings of an already-verified fact, improving them is
cheap and safe — re-run `translate --lang ceb --force` whenever the Cebuano
adapter improves and ship the new phrasing without touching the truth gate.

## Hackathon

This project is being built for the [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail) on DoraHacks, targeting the **Mobile** track.

## License

TBD — likely Apache 2.0 (matching QVAC).
