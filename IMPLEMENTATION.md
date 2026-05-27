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
| Base model | **Qwen3.5-2B** (primary), 0.8B (low-end fallback), 4B (high-end option) | Gated DeltaNet hybrid architecture: faster inference, lower memory, 262K context. 2B hits the quality/speed sweet spot on budget Android phones. |
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
| **Primary model** | Qwen3.5-2B Q4 (~1.5GB quantized) |
| **Low-end fallback** | Qwen3.5-0.8B Q4 (~1GB quantized) |
| **High-end option** | Qwen3.5-4B Q4 (~3GB quantized) |
| **Architecture** | Gated DeltaNet hybrid (3:1 linear/full attention) — O(n) memory scaling |
| **Context window** | 262K native; use ~2-4K on mobile to conserve RAM |
| **License** | Apache 2.0 |
| **Format** | GGUF (llama.cpp-compatible) |
| **QVAC support** | SDK v0.11.0+ — auto-detected Qwen3.5 tool-call dialect, reasoning_budget knob |

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

## 6. Curriculum Data

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

- [ ] **Qwen3.5 LoRA compatibility testing** — Verify that QVAC's fine-tuning works with Gated DeltaNet layers. If not, fall back to Qwen3-1.7B.
- [ ] **Physical device procurement** — Need a budget Android phone (4GB RAM) for testing. Ideally test on multiple devices.
- [ ] **LoRA dataset quality** — Synthetic dialogue generation + native speaker review pipeline needs to be set up.
- [ ] **Model download UX** — First-run experience for downloading ~2.5GB of models needs careful design (progress, resumption, storage warnings).
- [ ] **Stable Diffusion quality on mobile** — SD v2.1 at small quantization may produce low-quality images. Evaluate and potentially adjust.
- [ ] **Web demo hosting** — Determine where to host the QVAC server for the hackathon demo (local machine with tunnel, cloud VM, etc.).

---

## 12. Change Log

Track all directional changes to this plan here.

| Date | Change | Reason |
|---|---|---|
| 2026-05-27 | Initial plan created | Project kickoff |
