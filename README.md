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
│   └── server/       # Hosted QVAC server config for web demo
├── finetuning/       # LoRA training scripts and datasets
├── rag/              # RAG pipeline (chunking, embedding, indexing)
├── references/       # Raw curriculum materials (gitignored)
└── docs/             # Project documentation
```

See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for the full project specification and architecture decisions.

## Hackathon

This project is being built for the [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail) on DoraHacks, targeting the **Mobile** track.

## License

TBD — likely Apache 2.0 (matching QVAC).
