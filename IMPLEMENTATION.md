# Hiraia — Implementation Plan

> Last updated: 2026-05-29

## 1. Project Overview

**Hiraia** is an offline-capable AI Science tutor for Filipino grade school and high school students. Named after the Filipino word "hiraya" (hope/dream) with "AI" embedded in the middle, it brings locally-installed inference to students in the Philippines and, eventually, the broader Global South.

The tutor speaks English, Tagalog, and Cebuano Bisaya. It uses fine-tuned LoRA adapters for natural-sounding Filipino language generation. It dynamically generates visuals (diagrams, illustrations, analogies) to help students understand tricky scientific concepts.

### Hackathon Submission

- **Hackathon:** QVAC Hackathon I — Unleash Edge AI
- **Platform:** [DoraHacks](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail)
- **Track:** Mobile
- **Prize Pool:** $21,000 USD
- **Submission Opens:** May 31, 2026
- **Deadline:** June 21, 2026 (23:59)
- **Requirements:** GitHub/GitLab/Bitbucket link + Demo video

---

## 2. Core Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Base model | **Qwen3-1.7B** (Q4_K_M quantization) | Fully supported for LoRA fine-tuning in QVAC. Qwen3.5-2B lacks LoRA support due to Gated DeltaNet architecture limitations. |
| Language | English, Tagalog, **Cebuano Bisaya** | Cebuano is the most widely spoken Bisaya variant (~20M speakers across Visayas and Mindanao) |
| LoRA strategy | **Two separate adapters** (Tagalog + Cebuano) | Cleaner training signal, independent iteration, easy load/unload. English uses base model (no adapter). |
| Visual generation | **Dynamic** (Stable Diffusion), **async**, **optional Visual Pack download** | Pre-generated diagrams are too rigid — student creativity should drive visuals (e.g., "explain gravity using anime characters") |
| Platform | **Android APK** via Expo/React Native | Android dominates Philippines (~85%+ market share) and the Global South. QVAC SDK natively supports Expo for mobile. |
| Hackathon track | **Mobile** only | Focused submission, strongest narrative for our use case |
| Curriculum data | Public DepEd materials: MATATAG CG, K-12 CG, LRMDS Self-Learning Modules | No private curriculum data available. DepEd materials are freely downloadable for educational use. |
| Web demo | Yes — connected to hosted QVAC server | Judges/visitors can try Hiraia instantly in a browser without installing an APK |
| P2P classroom server | Vision/stretch goal, **not** for hackathon submission | Powerful narrative for Global South but out of scope for 25-day timeline |

---

## 3. Architecture

### High-Level

```
┌─────────────────────────────────────────────────────────┐
│                    Shared App Layer                      │
│   (UI components, prompts, curriculum, chat logic,      │
│    language detection, visual triggers)                  │
├──────────────────────┬──────────────────────────────────┤
│   Mobile (Expo/RN)   │         Web (Next.js)            │
│                      │                                  │
│   TutorEngine:       │   TutorEngine:                   │
│   @qvac/sdk direct   │   HTTP → QVAC server             │
│   (on-device)        │   (OpenAI-compatible API)        │
│                      │                                  │
│   loadModel()        │   fetch("/v1/chat/completions")  │
│   completion()       │   fetch("/v1/images/generations")│
│   diffusion()        │                                  │
└──────────────────────┴──────────────────────────────────┘
```

### TutorEngine Abstraction

A single `TutorEngine` interface that both platforms implement:

```typescript
interface TutorEngine {
  chat(messages: Message[]): AsyncIterable<string>;
  generateVisual(prompt: string): Promise<ImageResult>;
  embed(text: string): Promise<number[]>;
  ragSearch(query: string, topK: number): Promise<RagResult[]>;
}
```

- **Mobile:** `LocalEngine` — calls `@qvac/sdk` directly (on-device inference)
- **Web:** `RemoteEngine` — calls QVAC HTTP server (OpenAI-compatible REST API)

### Project Structure

```
hiraia/
├── packages/
│   ├── shared/              # Shared between mobile and web
│   │   ├── engine/          # TutorEngine interface + types
│   │   ├── prompts/         # System prompts (EN/TL/BIS)
│   │   ├── curriculum/      # DepEd Science topic mappings
│   │   ├── tutor-logic/     # Visual triggers, grade detection, etc.
│   │   └── types/           # TypeScript types
│   ├── mobile/              # Expo React Native app (hackathon submission)
│   │   ├── engine/          # LocalEngine (QVAC SDK direct)
│   │   ├── screens/         # Chat, Onboarding, Settings
│   │   └── components/      # ChatBubble, VisualPanel, LanguageToggle
│   ├── web/                 # Next.js web app (demo for judges)
│   │   ├── engine/          # RemoteEngine (HTTP API)
│   │   ├── app/             # Next.js pages/app router
│   │   └── components/      # Web UI components
│   └── server/              # Hosted QVAC demo server config
│       ├── docker/
│       └── deploy/
├── finetuning/              # LoRA training scripts and datasets
│   ├── datasets/            # Tagalog/Cebuano chat JSONL files
│   ├── scripts/             # Training, evaluation, export
│   └── README.md
├── rag/                     # RAG pipeline
│   ├── sources/             # DepEd Science content (processed)
│   ├── scripts/             # Chunking, embedding, index building
│   └── README.md
├── references/              # Raw reference materials (gitignored)
│   ├── curriculum/          # DepEd curriculum guides (PDFs)
│   ├── modules/             # Self-Learning Modules (PDFs)
│   └── README.md
├── docs/                    # Project documentation
├── IMPLEMENTATION.md        # This file
├── README.md
├── .gitignore
└── package.json             # Root workspace (Turborepo)
```

---

## 4. Model Strategy

### LLM (Text Generation)

| Concern | Detail |
|---|---|
| **Primary model** | Qwen3-1.7B Q4_K_M (~1.5GB quantized) |
| **Architecture** | Standard Transformer with RoPE |
| **Context window** | 32K native; use ~2-4K on mobile to conserve RAM |
| **License** | Apache 2.0 |
| **Format** | GGUF (llama.cpp-compatible) |
| **QVAC support** | Full LoRA fine-tuning support via qvac-fabric-llm.cpp |

**Why not Qwen3.5-2B?** Qwen3.5 uses Gated DeltaNet hybrid attention (3:1 linear/full ratio), which requires custom backward passes for LoRA training. QVAC's fine-tuning framework currently supports Qwen3 but not Qwen3.5. Using Qwen3-1.7B ensures we can fine-tune Tagalog/Cebuano adapters immediately.

### LoRA Adapters

| Adapter | Language | Training Mode | Notes |
|---|---|---|---|
| `hiraia-tagalog-v1.gguf` | Tagalog | SFT (`assistantLossOnly: true`) | ~20MB adapter file |
| `hiraia-cebuano-v1.gguf` | Cebuano Bisaya | SFT (`assistantLossOnly: true`) | ~20MB adapter file |

**Training pipeline:**
1. Curate tutoring dialogue datasets in Tagalog and Cebuano (JSONL, HuggingFace chat format)
2. Data sources: DepEd module content → synthetic dialogues generated by a larger model → human review by native speakers
3. Train on GPU-equipped desktop/laptop using QVAC's `finetune()` API
4. Output: small `.gguf` adapter files bundled with the app
5. At inference: loaded via `modelConfig.lora`

**LoRA training config** (see Section 9.2 for the rationale behind each value):
```typescript
finetune({
  modelId,
  options: {
    trainDatasetDir: "./datasets/tagalog/science-chat-v2.jsonl",
    validation: { type: "split", fraction: 0.1 },
    outputParametersDir: "./output/tagalog",
    numberOfEpochs: 3,
    learningRate: 1e-4,
    lrScheduler: "cosine",
    lrMin: 1e-8,          // MUST be > 0, else AdamW alpha hits 0 and asserts
    warmupRatio: 0.1,
    contextLength: 1024,  // >= longest conversation, else examples are skipped
    batchSize: 512,       // token counts (llama.cpp -b / -ub), NOT sequence counts
    microBatchSize: 128,
    loraRank: 16,
    loraAlpha: 32,
    loraModules: "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down",
    assistantLossOnly: true,
  }
});
```

**Risk:** Qwen3.5's Gated DeltaNet layers differ from standard attention — LoRA module targeting may need adjustment. Fallback: Qwen3-1.7B (standard transformer, fully supported).

### Image Generation (Visuals)

| Concern | Detail |
|---|---|
| **Model** | Stable Diffusion v2.1 (smallest quantization available, ~1.8GB) |
| **Delivery** | Optional "Visual Pack" download (~1.8GB) |
| **Trigger** | Tutor detects concept that benefits from a visual (molecular structures, food chains, forces, etc.) |
| **Flow** | Async: text response streams immediately → visual generates in background → slides in when ready |
| **Prompt style** | Educational illustrations — diagrams, labeled diagrams, simple explanatory visuals |

### RAG (Curriculum Knowledge)

| Concern | Detail |
|---|---|
| **Embedding model** | GTE (via QVAC `embed()`) |
| **Knowledge base** | DepEd Science curriculum documents + Self-Learning Modules, chunked and embedded |
| **Purpose** | Ground the tutor in actual Philippine curriculum standards; prevent off-topic hallucinations |

---

## 5. Install Size Breakdown

```
Hiraia Base Install (~2.5GB)
├── App shell (Expo/RN)              ~80MB
├── Qwen3.5-2B Q4                    ~1.5GB
├── Tagalog LoRA adapter             ~20MB
├── Cebuano LoRA adapter             ~20MB
├── Science RAG index                ~200MB
├── Embeddings model (GTE)           ~150MB
└── App code, prompts, assets        included

Hiraia Visual Pack (~1.8GB) — optional
└── Stable Diffusion v2.1 Q4         ~1.8GB
```

Total with Visual Pack: **~4.3GB**. Students on 4GB RAM phones get the text tutor. Students on 6GB+ can enable visual generation.

---

## 6. Target Devices

### Primary Target Phones (2020-2021 Midrange)

These devices represent the typical hardware students in the Philippines would have access to:

| Phone | Release | RAM | Storage | Processor | GPU | Android | Price (2020-21) |
|---|---|---|---|---|---|---|---|
| **Samsung Galaxy A31** | June 2020 | 6GB | 128GB | MediaTek Helio P65 (12nm) | Mali-G52 MC2 | 10 → 13 | ₱14,990 |
| **Samsung Galaxy A51** | Feb 2020 | 6-8GB | 128GB | Exynos 9611 (10nm) | Mali-G72 MP3 | 10 → 13 | ₱17,990 |
| **Samsung Galaxy A32 (4G)** | Feb 2021 | 6-8GB | 128GB | MediaTek Helio G80 (12nm) | Mali-G52 MC2 | 11 → 13 | ₱13,990 |
| **Vivo V20** | Oct 2020 | 8GB | 128GB | Snapdragon 720G (8nm) | Adreno 618 | 10 → 11 | ₱19,990 |
| **Xiaomi Redmi Note 9 Pro** | May 2020 | 6-8GB | 128GB | Snapdragon 720G (8nm) | Adreno 618 | 10 → 12 | ₱12,990 |

### Minimum Requirements (Hiraia Base)

- **RAM:** 4GB minimum (6GB+ recommended)
- **Storage:** 8GB free space for app + models
- **Android:** 12+ (API 29+)
- **Architecture:** arm64-v8a

### Performance Expectations

| Configuration | Model | RAM Usage | Expected Speed |
|---|---|---|---|
| **Low-end (4GB)** | Qwen3-1.7B Q4 | ~1.5GB | 8-12 tok/sec |
| **Mid-range (6-8GB)** | Qwen3-1.7B Q4 + Visual Pack | ~3.5GB | 12-18 tok/sec |
| **High-end (8GB+)** | Qwen3-1.7B Q4 + Visual Pack + larger context | ~4GB | 15-22 tok/sec |

---

## 7. Curriculum Data

### Sources (all publicly available, free for educational use)

| Source | URL | Content |
|---|---|---|
| MATATAG Science CG | [deped.gov.ph](https://www.deped.gov.ph/matatagcurriculumk147/) | Grade 4 & 7: content standards, learning competencies, performance tasks per quarter |
| K-12 Science CG | [deped.gov.ph PDF](https://www.deped.gov.ph/wp-content/uploads/2019/01/Science-CG_with-tagged-sci-equipment_revised.pdf) | Grade 3–10: full competency lists with tagged equipment |
| MATATAG Science CG 2023 | [academ-e.ph](https://www.academ-e.ph/wp-content/uploads/2023/09/Science-CG-2023.pdf) | Revised MATATAG curriculum guide |
| DepEd LRMDS Portal | [lrmds.deped.gov.ph](https://lrmds.deped.gov.ph/k_to_12) | Thousands of Self-Learning Modules (PDFs) by grade and subject |

### Pipeline

1. Download and parse curriculum guide PDFs → structured JSON (grade → quarter → domain → competencies)
2. Download Science SLMs from LRMDS portal (Grades 3–10)
3. Extract lesson text, chunk into semantic segments
4. Embed chunks using GTE model → build RAG index
5. Build grade→topic→competency mapping (JSON) for tutor context injection
6. Use content to generate synthetic tutoring dialogues for LoRA training

### Storage

Raw reference materials stored in `references/` (gitignored). Processed/embeddable content in `rag/sources/`.

---

## 7. Tutor Behavior

### System Prompt Design

The tutor's system prompt is dynamically composed based on:
- **Selected language** (English / Tagalog / Cebuano)
- **Student's grade level** (set during onboarding)
- **Current topic context** (from RAG retrieval based on conversation)
- **Pedagogical mode** (Socratic questioning, direct explanation, analogy generation, etc.)

### Core Pedagogical Principles

- **Socratic method** — ask guiding questions rather than just giving answers
- **Age-appropriate vocabulary** — calibrate complexity to grade level
- **Encouraging tone** — celebrate effort, normalize mistakes as part of learning
- **Visual triggers** — when the tutor detects a concept that benefits from a visual, it generates a description prompt and triggers image generation
- **Cultural context** — use Filipino examples, settings, and references (e.g., "Imagine you're at a sari-sari store..." or "Think about the typhoons we get...")
- **Curriculum alignment** — ground explanations in DepEd learning competencies

### Language Handling

- QVAC's `@qvac/langdetect-text` detects the student's language
- Manual language toggle available in the UI
- On language switch, the appropriate LoRA adapter is loaded/unloaded
- English is the default (no adapter needed — base model handles it natively)

---

## 8. Mobile App (Hackathon Submission)

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo (React Native) + TypeScript |
| AI Runtime | `@qvac/sdk` ^0.11.0 |
| State management | Zustand or similar |
| Navigation | Expo Router |
| Min Android | Android 12+ (API 29), arm64, Vulkan |
| RAM | ~3-4GB free for base experience |
| Storage | ~2.5GB base, ~4.3GB with Visual Pack |
| Build tooling | `npx expo run:android --device` |

### QVAC SDK Setup

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "android": { "minSdkVersion": 29 } }],
      "@qvac/sdk/expo-plugin"
    ]
  }
}
```

### Screens

1. **Onboarding** — name, grade level, preferred language, download models
2. **Chat** — main tutoring conversation with inline visual generation
3. **Topics** — browse curriculum topics by grade/quarter/domain
4. **Settings** — language toggle, model management, visual pack download

### Key Constraint

QVAC does **not** run on Android emulators — physical device required for all testing.

---

## 9. Web App (Demo for Judges)

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js + TypeScript |
| AI Backend | QVAC HTTP server (OpenAI-compatible API) |
| Styling | Tailwind CSS |
| State | Zustand or similar |

### Deployment

- Hosted QVAC server on a GPU-equipped machine (dev PC or cloud VM)
- Web app connects to the server's OpenAI-compatible endpoint
- Anyone can try Hiraia in their browser — no install required
- For the demo video: show both mobile APK and web demo side by side

---

## 9.1 Web Demo Inference Backend — QVAC Node Sidecar (`packages/server`)

This section documents the concrete inference backend that powers the web demo and
the local development loop. It replaces an earlier throwaway Python/PyTorch dev
server that was **not** hackathon-compliant (rules require all inference go through
`@qvac/sdk`) and was a poor performance proxy (FP16 PyTorch on x86 CPU is far
slower and heavier than how the model actually runs on a phone).

### Decision

Run the **real QVAC SDK** in a standalone **Node sidecar process** that exposes an
OpenAI-compatible, SSE-streaming `/v1/chat/completions` endpoint. The Next.js web
app's existing `RemoteEngine` talks to it over HTTP — no web code rewrite needed.

| Option considered | Verdict |
|---|---|
| Raw PyTorch on CPU (previous) | ❌ Not QVAC-compliant; unrepresentative; slow |
| QVAC SDK bundled into the browser | ❌ Impossible — QVAC uses the **Bare runtime** + native `.bare` addons; cannot run in a browser/webpack bundle |
| **QVAC SDK in a Node sidecar** | ✅ Chosen — real QVAC (llama.cpp + Q4 GGUF), faithful behavior, keeps the fast browser dev loop |

The same QVAC engine code is shared with the mobile app's `LocalEngine`, so the web
sidecar and the on-device mobile deliverable stay in sync.

### Architecture

```
Browser (localhost:3000)
   │  HTTP / SSE
   ▼
Next.js  ──(RemoteEngine: fetch /v1/chat/completions)──►  QVAC Node Sidecar (packages/server)
                                                              │  @qvac/sdk (Node RPC client)
                                                              ▼
                                                          Bare worker process  (spawn "bare")
                                                              │  custom LLM-only worker entry
                                                              ▼
                                                          llama.cpp (.bare addon) + Qwen3-1.7B Q4_0 GGUF
```

- The sidecar mirrors the mobile `LocalEngine` flow: `loadModel(QWEN3_1_7B_INST_Q4)`
  → `completion({ stream: true })` → stream tokens out as SSE.
- Model is downloaded once from the QVAC/HF registry and cached at
  `~/.qvac/models/` (≈1 GB for `Qwen3-1.7B-Q4_0.gguf`).

### Custom LLM-only worker

QVAC's default Bare worker (`@qvac/sdk/dist/server/worker.js`) eagerly registers
**every** built-in plugin (LLM, embeddings, whisper, parakeet, NMT, TTS, OCR,
diffusion), forcing each native addon to load at startup. We ship a custom worker
that registers **only** the LLM plugin and point the SDK at it via the
`QVAC_WORKER_PATH` environment variable (an officially supported override):

```js
// packages/mobile/qvac/worker.entry.mjs  (LLM-only Bare worker)
import { initializeWorkerCore, ensureRPCSetup } from "@qvac/sdk/worker-core"
import { registerPlugin } from "@qvac/sdk/plugins"
import { llmPlugin } from "@qvac/sdk/llamacpp-completion/plugin"

const { hasRPCConfig } = initializeWorkerCore()
registerPlugin(llmPlugin)
if (hasRPCConfig) ensureRPCSetup()
```

This both reduces native surface and avoids the Windows `MAX_PATH` failure
described below (the whisper addon's pnpm path exceeds 260 chars).

### Disabling "thinking"

Qwen3 emits a verbose `<think>…</think>` reasoning block by default. For a snappy
tutor we disable it via the completion's thinking flag so the model answers
directly. (Mirrors the earlier `enable_thinking=False` behavior.)

### Windows desktop integration (BYOH dev host)

Getting QVAC's native engine to run in Node on a Windows x64 dev host required
three fixes. These are **dev-host setup steps**, not changes to the mobile
deliverable, but are documented here for full reproducibility.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `bare-runtime: No binaries found for target 'win32-x64'` | pnpm lockfile was resolved on another OS, so the Windows Bare interpreter optional dep was never materialized | Add `pnpm.supportedArchitectures` (`os: [win32, current]`, `cpu: [x64]`) to root `package.json`, then `pnpm install --force` |
| 2 | Addon load fails: `The specified module could not be found` (loading `embed-llamacpp` / `llm-llamacpp` `.bare`) | The native `.bare` addons link against **OpenSSL 3** (`libcrypto-3-x64.dll`, `libssl-3-x64.dll`), which Windows doesn't ship and the package doesn't bundle | Copy the two DLLs (available from Git for Windows `mingw64\bin`) **next to each `@qvac/*` `prebuilds/win32-x64/*.bare`** addon (the Bare loader searches the addon's own directory) |
| 3 | `The filename or extension is too long` (error 206) loading the **whisper** addon | pnpm's deeply-nested path to the whisper addon exceeds Windows `MAX_PATH` (260) | Use the **LLM-only custom worker** (above) so whisper/TTS/OCR/etc. never load |

> Native addons depend on `vulkan-1.dll` and the MSVC runtime (`VCRUNTIME140*.dll`),
> which are already present on typical Windows 10/11 systems with GPU drivers.

### Durability

The fixes in #1–#2 live inside `node_modules` and would be wiped by a clean
reinstall. A `postinstall` script (`packages/server` / root) will reapply them
automatically (ensure win32 Bare runtime present; copy OpenSSL DLLs beside each
win32-x64 addon) so the setup survives reinstalls and works for teammates/CI.

### Verified result (dev host)

A standalone Node smoke test (`packages/mobile/qvac-smoke-test.mjs`) confirmed the
full path end-to-end on Windows x64:

- Model loaded (incl. first-run ~1 GB download) in ~35 s; subsequent loads use the cache.
- Completion streamed at **~70 tok/s**, first token ~2.5 s — dramatically faster than the previous PyTorch CPU path.

> Note: desktop throughput is **not** a proxy for phone speed (different CPU/SIMD,
> and the desktop may use the Vulkan GPU backend). The sidecar gives faithful QVAC
> **behavior/quality** for the web demo; real latency targets come from on-device
> testing (Section 6).

---

## 9.2. LoRA Fine-tuning with QVAC `finetune()` (implemented)

The base Qwen3-1.7B produces weak, unnatural Tagalog. To fix this we fine-tune a
LoRA adapter **using QVAC's own `finetune()` API** — the same `qvac-fabric-llm.cpp`
(llama.cpp) engine that serves inference. This keeps the whole pipeline on QVAC:
**we use QVAC for both inference and training**, and the output drops straight into
the runtime with no format conversion.

### Why QVAC `finetune()` (vs. HuggingFace PEFT)

| Option | Verdict |
|---|---|
| HF PEFT (transformers) → safetensors → convert to GGUF | ❌ Off-brand for the hackathon; produces a `safetensors` adapter that is **not** loadable by QVAC/llama.cpp without a separate conversion step |
| **QVAC `finetune()`** | ✅ Chosen — on-brand (QVAC end-to-end), outputs a **GGUF adapter directly**, runs through the same SDK/worker we already proved on Windows |

The `finetune` handler is part of the **LLM (llamacpp-completion) plugin**, so our
existing **LLM-only Bare worker** (Section 9.1) already supports training — no extra
plugin or native addon is needed. Training reuses the exact proven Windows setup
(win32 Bare runtime + co-located OpenSSL DLLs + LLM-only worker).

### Trainer

`packages/server/src/train.mjs` (`npm run train` in `packages/server`) runs the job:

```
loadModel(QWEN3_1_7B_INST_Q4, { modelType: "llm", modelConfig: { device, ctx_size } })
  → finetune({ modelId, options })           // streams per-step loss/accuracy
  → GGUF adapter written to outputParametersDir
```

It runs in `packages/server` (not `finetuning/`, which is a separate npm install) so
it inherits the patched native environment. Datasets are read from
`finetuning/datasets/<lang>/` and adapters are written to `finetuning/output/<lang>/`.

### Correctness findings (non-obvious QVAC/llama.cpp training behavior)

Three issues surfaced during the first runs; all are now handled by the trainer's
defaults and documented so they don't recur:

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Training crawled (~500 min ETA), `loss 0.0000`, then `GGML_ASSERT(opt_pars.adamw.alpha > 0.0f)` | `batchSize` / `microBatchSize` are **token counts** (the llama.cpp `-b` / `-ub` flags), **not** sequence counts. Tiny values (4/1) made it step one token at a time | Use token-scale batches (defaults `batchSize: 512`, `microBatchSize: 128`) |
| 2 | Run always died at the **last step** with `GGML_ASSERT(opt_pars.adamw.alpha > 0.0f)` | The cosine LR scheduler anneals `lr` toward `lrMin`; with the default `lrMin = 0`, the final step's AdamW alpha hits exactly 0 and asserts | Set `lrMin > 0` (`lrScheduler: "cosine"`, `lrMin: 1e-8`, `warmupRatio: 0.1` — QVAC's recommended recipe) |
| 3 | `GGML_ASSERT(ndata > 0)` and `Skipping conversation N: too long (… > ctx)` | `contextLength` was smaller than the conversations; **every** example was silently skipped, leaving an empty dataset | Set `contextLength` ≥ the longest conversation (and/or keep answers concise — see dataset below) |

### Dataset rebuild

The earlier `tagalog/science-chat-expanded.jsonl` (400 lines) was low quality: answers
**didn't match their questions** and every one ended with the same boilerplate padding
("Mahalagang maunawaan natin ang X… Sa Grade 7…"). Training on it would only reinforce
generic, mismatched filler.

It was replaced with **`tagalog/science-chat-v2.jsonl`** — 49 hand-authored, grounded
dialogues that:

- answer the actual question, in **natural conversational Taglish** (Tagalog with
  English science terms where natural: `photosynthesis`, `gravity`, `molecule`),
  matching the app's tutor persona (`generateSystemPrompt`, Section 7);
- use Filipino context (bagyo, bulkang Taal/Pinatubo, sari-sari examples, PHIVOLCS,
  Pacific Ring of Fire) and a Socratic follow-up question;
- are **concise** (avg ~116 words, max ~206 tokens) — better pedagogy *and* far faster
  training (every example fits a 1024-token context vs. the old 800–1100-token answers);
- cover biology, chemistry, physics, and Earth/space, incl. multi-turn follow-ups.

### Adapter wiring (inference)

A trained GGUF adapter is applied at model load via llama.cpp's LoRA support. The
sidecar reads an optional `HIRAIA_LORA_ADAPTER` env var and, when set, passes
`modelConfig.lora = <path>` to `loadModel`; otherwise it serves the plain base model.
The active adapter is reflected in `MODEL_LABEL` and the `/health` response. The mobile
`LocalEngine` uses the same `modelConfig.lora` mechanism, so the web demo and the
on-device app load identical adapters.

---

## 10. Timeline

| Week | Dates | Focus |
|---|---|---|
| **Week 1** | May 27 – Jun 3 | Project scaffolding, Expo + QVAC setup, basic chat UI, LLM integration (English), curriculum data collection and parsing |
| **Week 2** | Jun 4 – Jun 10 | LoRA dataset curation (Tagalog + Cebuano), fine-tuning pipeline, RAG setup with Science curriculum content |
| **Week 3** | Jun 11 – Jun 17 | Multilingual integration, visual generation (Stable Diffusion), pedagogical prompt engineering, UI polish, web demo |
| **Week 4** | Jun 18 – Jun 21 | Testing on physical Android device, bug fixes, demo video recording, hackathon submission |

---

## 11. Open Items & Future Decisions

These items are deferred until they become relevant during implementation:

- [x] **Qwen3.5 LoRA compatibility** — CONFIRMED: Not supported by QVAC fine-tuning framework. Gated DeltaNet architecture requires custom backward passes not yet implemented. Using Qwen3-1.7B instead.
- [ ] **Physical device procurement** — Need a budget Android phone (4GB RAM) for testing. Ideally test on multiple devices listed in Section 6.
- [~] **LoRA dataset quality** — Old templated/mismatched synthetic data replaced with a hand-authored, grounded Tagalog set (`science-chat-v2.jsonl`, 49 dialogues). Native-speaker review and scale-up (Cebuano + more Tagalog) still pending.
- [ ] **Model download UX** — First-run experience for downloading ~2.5GB of models needs careful design (progress, resumption, storage warnings).
- [ ] **Stable Diffusion quality on mobile** — SD v2.1 at small quantization may produce low-quality images. Evaluate and potentially adjust.
- [ ] **Web demo hosting** — Determine where to host the QVAC server for the hackathon demo (local machine with tunnel, cloud VM, etc.).

---

## 12. Lobbying for Qwen3.5 LoRA Support

### Current Status

QVAC's `qvac-fabric-llm.cpp` supports LoRA fine-tuning for Qwen3 (standard Transformer) but **not** Qwen3.5 (Gated DeltaNet hybrid). The fine-tuning framework explicitly lists Qwen3 (0.6B, 1.7B, 4B) as supported, while Qwen3.5's hybrid attention architecture requires custom backward pass implementations for the linear attention layers that haven't been built yet.

### Who to Contact

| Channel | Link | Best For |
|---|---|---|
| **Discord** | [discord.com/invite/tetherdev](https://discord.com/invite/tetherdev) | Real-time discussion with QVAC team |
| **Feature Requests** | [Discord #feature-requests](https://discord.com/channels/1425125849346216029/1488513739492954313) | Official feature request channel |
| **Feedback Portal** | [qvacbytether.featurebase.app](https://qvacbytether.featurebase.app/) | Upvoteable feature requests |
| **GitHub Issues** | [github.com/tetherto/qvac/issues](https://github.com/tetherto/qvac/issues) | Technical discussion with maintainers |
| **Twitter/X** | [@QVAC](https://x.com/QVAC) | Public visibility |
| **Partnership form** | [qvac.tether.io](https://qvac.tether.io/) → Contact Us | Formal partnership/inquiry |

### Key People to Reach

Based on the repository contributor list, the most relevant contacts:
- **Proletter** — Top contributor, likely tech lead
- **simon-iribarren** — Active contributor
- **jpgaribotti** — Active contributor (infrastructure)
- **yuranich** — Active contributor
- **tamer-hassan-tether** — Tether team member

### Pitch Angle

Frame the request around the hackathon and the Global South education use case:
1. We're building an offline AI tutor for Filipino students using QVAC
2. Qwen3.5-2B would be ideal for its memory efficiency on budget phones
3. We need LoRA fine-tuning to make Tagalog and Cebuano sound natural
4. This is a compelling showcase of QVAC's education impact
5. We're happy to test and provide feedback on any beta implementation

---

## 13. Change Log

Track all directional changes to this plan here.

| Date | Change | Reason |
|---|---|---|
| 2026-05-27 | Initial plan created | Project kickoff |
| 2026-05-27 | Base model changed from Qwen3.5-2B to **Qwen3-1.7B** | Qwen3.5 LoRA fine-tuning not supported by QVAC (Gated DeltaNet architecture). Qwen3-1.7B has full LoRA support. |
| 2026-05-27 | Added Section 6: Target Devices | Defined target phones (2020-2021 midrange) with specs and performance expectations |
| 2026-05-27 | Added Section 12: Lobbying for Qwen3.5 LoRA Support | Documented contact channels and pitch strategy for requesting Qwen3.5 support from QVAC team |
| 2026-05-29 | Added Section 9.1: Web Demo Inference Backend — QVAC Node Sidecar | Replaced the non-compliant Python/PyTorch dev server with a real `@qvac/sdk` Node sidecar; documented the LLM-only custom worker, thinking-disable, and the three Windows-x64 integration fixes (win32 Bare runtime via `supportedArchitectures`, OpenSSL DLL co-location, MAX_PATH workaround). Verified ~70 tok/s end-to-end. |
| 2026-05-29 | Added Section 9.2: LoRA Fine-tuning with QVAC `finetune()` | Implemented training via QVAC's native `finetune()` (QVAC end-to-end, GGUF adapter out, no PEFT/conversion). Added `packages/server/src/train.mjs`; corrected the Section 4 config (token-scale batch sizes, `lrMin > 0` to avoid the AdamW alpha=0 assert, `contextLength` ≥ conversation length). Rebuilt the Tagalog dataset (`science-chat-v2.jsonl`, 49 grounded Taglish dialogues) and wired adapter loading into the sidecar via `HIRAIA_LORA_ADAPTER` → `modelConfig.lora`. |
