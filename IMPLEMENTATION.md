# Hiraia — Implementation Plan

> Last updated: 2026-05-27

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

**LoRA training config:**
```typescript
finetune({
  modelId,
  options: {
    trainDatasetDir: "./datasets/tagalog-science-chat.jsonl",
    validation: { type: "split", fraction: 0.1 },
    outputParametersDir: "./lora-output",
    numberOfEpochs: 3,
    learningRate: 1e-4,
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
- [ ] **LoRA dataset quality** — Synthetic dialogue generation + native speaker review pipeline needs to be set up.
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
