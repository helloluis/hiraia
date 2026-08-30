# Remote APIs

Hiraia is an **offline, on-device** AI Science tutor. After a one-time setup download,
the app does **all inference locally** (QVAC / llama.cpp) and needs no network. There is
**no telemetry, no analytics, and no remote inference** — nothing the student types or the
model generates ever leaves the device.

This document is the single, authoritative list of every remote endpoint the project
touches, split into what the **shipped app** calls at runtime versus what is only used by
**development / evaluation tooling**.

---

## 1. Runtime remote APIs (the shipped mobile app)

All of these are **static file downloads over HTTPS** (plain GET, byte-range supported),
fetched **once** on first run and then cached on disk for fully-offline use. They are
served from a self-hosted nginx mirror (`https://hiraia.b11.dev/models/`). There are no
request bodies, no auth, and no per-user data — only model weights are transferred.

| # | Endpoint | What it is | Required? | Referenced in |
|---|----------|-----------|-----------|---------------|
| 1 | `https://hiraia.b11.dev/models/Sailor2-3B-Chat.Q4_K_M.gguf` (~3.23 GB) | Base LLM. Verifiable mirror of the public HF model. | Yes | `packages/mobile/src/config/model.ts` (`ACTIVE_MODEL.modelSrc`) |
| 2 | `https://hiraia.b11.dev/models/labse.Q4_K_M.gguf` (~384 MB) | LaBSE semantic embedder for hybrid RAG retrieval. | Optional — falls back to lexical-only RAG if absent | `packages/mobile/src/config/model.ts` (`EMBEDDER.modelSrc`) |
| 3 | `https://hiraia.b11.dev/models/adapter-tagalog-v11.gguf` (~107 MB) | Tagalog LoRA fine-tune. Also serves English (`LocalEngine.resolveAdapterPath`). | **Yes**, for Tagalog/English — the engine REFUSES to load without it | `packages/mobile/src/config/model.ts` (`REMOTE_ASSETS.adapterTagalog`) |
| 4 | `https://hiraia.b11.dev/models/adapter-bisaya-v11.gguf` (~107 MB) | Bisaya/Cebuano LoRA fine-tune. | **Yes**, for Bisaya — same refusal | `packages/mobile/src/config/model.ts` (`REMOTE_ASSETS.adapterBisaya`) |

That is the whole list. One adapter is fetched per active language, so a first run costs
**~3.33 GB** (base + one adapter) plus the optional ~384 MB embedder; the second adapter is
only fetched if the child switches to the other Filipino language.

**A proxy allowlist needs all four.** Rows 3 and 4 are not optional extras: if the adapter
cannot be fetched and verified, `LocalEngine` throws rather than quietly running the raw
base model (it scores 1.78/5 vs 3.75/5 on the capability probes and fabricates science at a
child), and the tutor reports itself unavailable. A school proxy that whitelists only rows
1–2 therefore hard-fails the app.

The list used to be four rows for a different reason: the app shipped a second "kitten" tier
(Sailor2-1B on 4 GB devices) that pulled its own base GGUF from HuggingFace and its own
Tagalog adapter from the mirror. **That tier is retired** — one device target, 6 GB+ RAM,
Sailor2-3B. The `adapter-kitten-tagalog-v7.gguf` file still sits on the VPS; nothing in the
app requests it any more.

Notes:

- **The Filipino LoRA adapters are DOWNLOADED, not bundled.** They used to be Metro-bundled
  assets inside the APK. Externalising them takes 213.5 MB off every install and — the real
  reason — subjects them to the same declared size + MD5 gate as every other downloaded
  byte, which a bundled asset never needed and a QVAC-fetched one cannot have
  (`modelConfig.lora` is a bare string the llama.cpp plugin never resolves). The filenames
  are version-suffixed (`-v11`) because the on-device cache keys on filename: shipping new
  adapter weights means a new name, not new bytes at the old one.
- **Why self-hosted, not HuggingFace directly:** HuggingFace migrated large GGUFs to its
  "Xet" CDN (302 → `cas-bridge.xethub.hf.co`), which QVAC's downloader reproducibly fails
  to finish (~85 %). The mirror is a **verifiable copy of the public base model**; inference
  stays 100 % on-device, so the privacy story is unchanged. See `hiraia-hf-xet-recheck` —
  if HF/Xet is fixed we switch back to the HF URL and retire the mirror.
- **Download mechanism:** `packages/mobile/src/engine/modelDownload.ts`
  (`ensureRemoteAsset()`) — a single resumable HTTP-Range stream per asset, serialised so
  one file is never transferred twice at once, with a 60 s stall watchdog, resume-from-disk
  across app launches (the `.part` file IS the resume state, so an interrupted 3.23 GB
  transfer never restarts from byte 0), and a **declared size + MD5 gate**: nothing reaches
  the final path without matching the digests pinned in `src/config/model.ts`
  (`REMOTE_ASSETS`). A captive-portal login page, a truncated body or a 0-byte 200 is
  rejected and deleted rather than cached forever as "the model".
- **No fallback to a remote model on failure:** if the weights can't be downloaded the
  app surfaces an error; it never silently routes inference to a remote server.

### Data leaving the device at runtime

| Direction | Payload | Endpoint |
|-----------|---------|----------|
| **Download** | Model weights (GGUF files) only | mirror / HuggingFace (above) |
| **Upload** | **None** — no prompts, no completions, no telemetry, no analytics | — |

---

## 2. Development / evaluation only (NOT in the shipped app)

These exist for authoring, benchmarking, and the web demo. They are **not compiled into or
called by** the mobile app the student installs.

| Endpoint | What it is | Used by |
|----------|-----------|---------|
| `https://hiraia.b11.dev` llama-server (`:8080`, pm2 `hiraia-llm`) | Server-side Sailor2-3B + LoRA for the **web demo** and eval harnesses. | `packages/web`, `finetuning/eval/*` (see `IMPLEMENTATION.md`) |
| Local `llama-server` (`http://localhost:8088`) | Device-equivalent engine booted by the regression gate / capability benchmark / audit demo. | `finetuning/eval/harness/run-harness.sh`, `finetuning/eval/audit/` |
| OpenAI-compatible LLM endpoint (configurable; Claude subscription / local model) | Offline **content-authoring** pipelines: factoid generation, dataset distillation, the LLM-judge. | `@hiraia/factoids`, `finetuning/distill/*`, eval judges |

None of the section-2 endpoints are reachable from, or required by, the installed mobile
app — they are build-time and research tooling.

---

## 3. Verifying this claim

- Network call sites in the app are confined to `packages/mobile/src/engine/modelDownload.ts`
  (downloads) and the model/embedder source URLs in `packages/mobile/src/config/model.ts`.
- There is no analytics/telemetry SDK in `packages/mobile/package.json`.
- A structured audit log of a real device-equivalent run (model load/unload + per-call
  prompt / tokens / TTFT / tokens-per-sec) is generated by
  `finetuning/eval/audit/run-audit-demo.mjs` → `AUDIT_LOG.demo-run.json` (summary in `AUDIT_LOG.md`).
