# Hiraia

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-dark.svg)](https://github.com/tetherto/qvac)

An offline, on-device AI Science tutor for Filipino grade-school students — powered by local inference on [QVAC](https://qvac.tether.io).

Hiraia brings AI tutoring to kids without requiring an internet connection. The model, the language adapters, the science databank, and the illustrations all ship **inside the APK** and run entirely on the phone. Default language is **Tagalog** (English supported; **Cebuano Bisaya is "coming soon"**).

> **Guiding principle:** if forced to choose, **factual accuracy ranks above perfect Tagalog/Bisaya fluency.** A tutor that is occasionally stiff but always correct beats a fluent one that misleads a child.

## What's in a name?

"Hiraia" is a play on the Filipino word **hiraya** — "hope" or "the fruit of one's dreams, visions, and aspirations" — with **AI** right in the middle.

## Features

- **Offline-first** — all inference runs on-device after the initial model download; no data leaves the phone.
- **Filipino-native** — Tagalog-first, with a LoRA fine-tune for natural, grade-5-level language. English routes through the same adapter; Cebuano is in beta / coming soon.
- **Grounded** — answers are grounded in a curated, verified ~35k-fact Science databank ("Hiraiapedia") via on-device retrieval, not free recall.
- **Illustrated** — the tutor offers a matching picture from a bundled library of **4,200+ individually generated illustrations** when one would help, via on-device image retrieval (not generative).
- **Intent-aware** — understands messy, code-switched (Taglish), mis-framed kid questions ("essay tungkol sa T-rex") and teaches the *real* topic instead of getting distracted.
- **Daily factoid** — an unprompted morning & evening "Alam mo ba na…?" message (see below).

## Target Users

Filipino grade-school students, **targeted at a Grade-5 level by default** (kids are often academically behind, so Grade 5 is the safe floor even for older students). Science first.

## How it works — the architecture

Hiraia is a **retrieval-augmented, intent-distilled** tutor. Everything ships in the APK and runs on-device:

| Piece | What it is |
|---|---|
| **Base model** | `Sailor2-3B-Chat` (Qwen2 architecture, Apache-2.0), `Q4_K_M` GGUF (~2.2 GB resident), run via the QVAC SDK. Targets 6 GB+ devices. |
| **Language adapter** | A bundled LoRA (~106 MB) applied on top of the base — the Filipino fine-tune (the core value). The Tagalog adapter also serves English. |
| **Hiraiapedia (RAG)** | ~35k curated, fact-checked trilingual science facts + bundled **LaBSE** sentence-vectors (768-dim, int8). Retrieval is a **hybrid** of brute-force cosine + lexical (IDF) fusion, with an abstain floor for off-topic queries. |
| **Illustrations** | A bundled library of **4,200+ individually generated, label-free illustrations** + a LaBSE image-vector index. The model emits an `[image: …]` control token; the app embedding-matches it to a bundled picture (tap → lightbox). |

At inference, the static system prompt (persona / grade / language) is cached by QVAC's KV cache, and the per-turn retrieved fact is injected into the **user turn** so only new tokens re-prefill — the TTFT optimization.

## Strategy — intent-distillation + RAG (the bet we shipped)

The hard problem was **query understanding**: a child's question arrives misspelled, code-switched, and wrapped in framing ("may homework po ako tungkol sa…"). Early attempts patched this with hand-coded stopword/regex normalization, which is brittle — it breaks the moment a kid phrases things a way we didn't enumerate.

We evaluated two ways to make the model *reason* about the kid's real intent instead:

- **Path A — bake everything into the weights (parametric).** Inspired by [QVAC MedPsy](https://huggingface.co/blog/qvac/medpsy), which ships no RAG. **Ruled out by our own data:** a LoRA teaches *behavior*, not *facts* — grounding was identical (~3.7/5) on facts the model trained on vs. never saw, i.e. the facts don't stick. Reliable parametric recall would need full fine-tuning at a scale that trades away accuracy, updatability, and the model's multilingual strength.
- **Path B — distill the *skill*, keep RAG for the *facts*. ✅ Shipped.** We fine-tune the model (LoRA) on teacher-generated `<think>` reasoning that (1) sees through framing to the real topic, (2) uses the retrieved fact faithfully, and (3) **ignores a wrong/mismatched retrieval instead of getting hijacked by it**. The verified fact bank remains the source of truth — so facts stay checkable and updatable, and the model stays un-distractible.

The teacher data is generated **AUP-safely**: most facts via Claude (subscription), and the child-body/biology slice via a local Qwen3.5-35B on a GPU pod (that content never touches a hosted classifier). Held-out evaluation of the shipped adapter: **grounding ~5/5 with the right fact in context, ~90% robust to distractor (wrong-fact) retrievals.**

> Historical note: [`knowledge_distillation_strategy.md`](./knowledge_distillation_strategy.md) analyzes a *different*, deferred idea — distilling reasoning *capacity* from a larger teacher — which the benchmark showed we didn't need. The strategy we actually shipped is the **intent-distillation** described above.

## Evaluation

Two separate instruments (see [`finetuning/eval`](./finetuning/eval)):

1. **Regression gate** — `finetuning/eval/harness/run-harness.sh` boots the device-equivalent engine (base GGUF + adapter GGUF + LaBSE retrieval) and runs retrieval + behavioral assertions. **Must be green before any APK build / on-device test.**
2. **Capability benchmark** — `finetuning/eval/capability/run-capability.sh`, a ~130-probe, 0–5 LLM-judged A/B instrument for model changes (deliberately seeded with hard items; headroom is the point).

## Getting Started

The app is built and installed **locally** (not via EAS):

```bash
# 1. Gate must be green first (device-equivalent regression test):
finetuning/eval/harness/run-harness.sh

# 2. Build the release APK (debug-keystore-signed) with JDK 17:
cd packages/mobile/android && ./gradlew assembleRelease

# 3. Install on a connected device:
adb install -r app/build/outputs/apk/release/app-release.apk
```

## Project Structure

```
hiraia/
├── packages/
│   ├── shared/       # Shared logic: prompts (system + grounding format), tutor-engine interface, RAG store
│   ├── mobile/       # Expo React Native app (the shipping Android APK) — bundles model, adapters, RAG, images
│   ├── web/          # Next.js web demo (hosted QVAC)
│   ├── images/       # 4,200+ individually generated illustrations + retrieval index
│   └── factoids/     # Daily "Alam mo ba na…?" auto-message (see below)
├── finetuning/       # LoRA training + the intent-distillation pipeline + eval harnesses
│   ├── distill/      #   intent-distillation: dataset build, teacher gen, eval
│   └── eval/         #   regression gate + capability benchmark
├── rag/              # The Hiraiapedia pipeline: fact bank, hygiene, embedding, retrieval-stress
└── deploy/           # VPS web-demo deploy + local llama.cpp / GGUF tooling
```

See [IMPLEMENTATION.md](./IMPLEMENTATION.md) and [ENGINEERING-LOG.md](./ENGINEERING-LOG.md) for deeper history.

## Roadmap — experience & engagement (current focus)

The core strategy above is **locked** — from here the work is making the tutor faster and more delightful, not changing the approach (though that may still involve retraining the adapter for style/behavior). The execution-ready breakdown lives in [`docs/OPTIMIZATION.md`](./docs/OPTIMIZATION.md).

- **Speed / TTFT** — reduce time-to-first-token and decode latency on-device (KV-cache verification, shorter reasoning traces, quantization/decode tricks).
- **Conversation history** — a scrollable list of past chats; dated page-break dividers in the thread so kids can scan to old exchanges.
- **More engaging voice** — richer, warmer formatting (emojis, colored bold/italics) and more proactive offers of illustrations.
- **Visual integration** — illustrations that feel part of the chat bubble (blended, tappable) rather than pasted in.
- **Databank growth & freshness** — continue expanding/curating Hiraiapedia; explore over-WiFi databank refresh.

## Daily factoid message (`@hiraia/factoids`)

An unprompted message the tutor sends each student **every morning and evening**:
a random ~50-word science factoid plus its matching picture, in the fixed format
**`Alam mo ba na <hook>? <body>`** (`Did you know that…?` / `Nahibaw-an ba nimo
nga…?`). Full docs: [`packages/factoids/README.md`](./packages/factoids/README.md).

**Correctness model.** The on-device model is small and can hallucinate, so factoids
are **not** generated live. They come from a **curated + verified bank** (authored
and fact-checked offline, stored `verified: true`; runtime only ever serves
verified ones) and are **image-anchored** (each factoid is tied to a real subject
in `packages/images`, so the picture is a guaranteed lookup, not a fuzzy search).

**Timezone.** "07:00" and "20:00" must be the **student's** zone (a morning message
should land in *their* morning). Default is **`Asia/Manila` (GMT+8)**; pass a
per-student IANA zone to override. Slot evaluation is DST-correct via `Intl`.

**Regenerating the bank (scales with the language fine-tunes).** The pipeline is
idempotent/incremental and model-pluggable (any OpenAI-compatible endpoint via
`HIRAIA_LLM_*`). It separates **fact from phrasing** — `source` is the verified
claim (English, language-neutral); `hook`/`body` `{tl,en,ceb}` are per-language
renderings that can be re-run freely as the fine-tunes improve, **without
re-verifying any fact**.

```bash
cd packages/factoids
node scripts/generate-factoids.mjs --mode translate --lang ceb --force  # refresh a language
node scripts/generate-factoids.mjs --mode draft --limit 30 --subject biology  # grow the bank → staging
node scripts/verify-bank.mjs           # fact-check gate: staging PASS → bank (verified:true)
node scripts/verify-bank.mjs --recheck # audit live facts with a stronger model
```

## Deployment

The web demo runs on a VPS (`main` is the single source of truth). See
[deploy/README.md](./deploy/README.md) for first-time setup; to redeploy the latest
`main` it's one command on the server:

```bash
/root/hiraia/deploy/update.sh   # sync origin/main → build web → restart pm2 (hiraia-web)
```

## Hackathon

Built for the [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail) on DoraHacks, **Mobile** track.

## License

TBD — likely Apache 2.0 (matching QVAC).
