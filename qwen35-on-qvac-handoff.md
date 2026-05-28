# Adding Qwen3.5+ support to the QVAC SDK — research handoff

> **Purpose of this doc:** This is a self-contained briefing so a fresh assistant
> (e.g. a local LLM) can continue the conversation with no prior context. It
> summarizes research done up to 2026-05-28. **No code has been written yet** —
> this is a feasibility/scoping study. Nothing here has been empirically tested
> against the actual repos; claims marked *(unverified)* still need confirming.

## The goal

The user wants to build on **QVAC** (Tether's open-source local-AI SDK) but it
ships with **Qwen3** support, not the newer, more capable **Qwen3.5+** series.
Question: how hard is it to add Qwen3.5+, and would a pull request be welcome?
The user is new to this stack, so explain plainly.

## What QVAC is

- `tetherto/qvac` — open-source (Apache-2.0) monorepo SDK for **local-first,
  cross-platform, peer-to-peer AI** (Linux/macOS/Windows/Android/iOS). Runs LLMs,
  embeddings, speech, OCR, image gen, etc. entirely on-device. Uses the Holepunch
  stack for P2P model distribution.
- Docs: https://docs.qvac.tether.io/

## How the LLM stack is layered (the key to scoping)

There are **two layers**, and this distinction is the whole story:

1. **`llm-llamacpp`** — the SDK addon developers code against (inside the qvac
   monorepo). It is **model-agnostic**: takes *any* GGUF file by path, already
   supports multimodal vision via `mmproj` projection files, and jinja chat
   templates. **No hardcoded model allowlist.** => There is essentially no QVAC
   SDK-layer code that blocks Qwen3.5; nothing to "register."

2. **`tetherto/qvac-fabric-llm.cpp`** — a **separate repo**: a **fork of
   llama.cpp** with QVAC's custom edge backends (Vulkan on Adreno GPUs, Metal,
   OpenCL) and on-device LoRA fine-tuning. This is the real inference engine.
   - Pinned from the SDK via vcpkg as `qvac-fabric >= 8828.0.2`. That number
     tracks **llama.cpp build tags** (their mirror shows tags like `b7334`,
     `b8828`). So the SDK currently rides ~llama.cpp build **b8828**. *(The exact
     calendar date of b8828 is unconfirmed — see open questions.)*
   - "Any GGUF model supported by llama.cpp is supported by qvac-fabric-llm.cpp"
     — i.e. it inherits upstream's model support, plus custom kernels.

**Conclusion:** "Add Qwen3.5 to QVAC" really means "get Qwen3.5 working in the
`qvac-fabric-llm.cpp` fork, then package it" — NOT writing a new architecture in
the QVAC SDK itself.

## Why the hardest part is already done (upstream)

Qwen3.5 (released ~Feb 16 2026) is architecturally unusual:
- **Hybrid Gated DeltaNet + sparse MoE**: ~75% linear/recurrent-attention layers,
  ~25% full softmax-attention layers. Gated DeltaNet is an SSM-like *recurrent*
  op, not standard attention.
- Natively **multimodal** (image/video), 262K context.
- Variants: 0.8B, 2B, 4B, 9B, 27B (dense) + MoE like 35B-A3B, 122B-A10B, 397B-A17B.
  (Qwen3.6 also now exists.)

**Upstream `ggml-org/llama.cpp` already supports Qwen3.5:** the architecture, the
GGUF conversion (`convert_hf_to_gguf.py`, incl. `--mtp/--no-mtp` for 3.5/3.6 text
variants), and even Multi-Token-Prediction speculative decoding (merged PR
**#20700**). So nobody needs to invent the kernels from scratch — the work is
about getting that support into QVAC's fork and exposing it.

## Difficulty assessment — three tiers

**Tier 1 — config/packaging only (best case):** If the fork's current build
already includes Qwen3.5, you only need to convert a small Qwen3.5 to GGUF, feed
it to `llm-llamacpp`, set the chat template, and add registry metadata + a
prepackaged quant. Possibly just a docs/packaging PR.

**Tier 2 — rebase the fork (likely):** If `b8828` predates Qwen3.5 landing
upstream, someone merges the upstream Qwen3.5 commits into
`qvac-fabric-llm.cpp` and resolves conflicts with QVAC's custom patches. Needs
C++/llama.cpp familiarity; mostly mechanical.

**Tier 3 — custom edge backends (the real risk):** QVAC's value is running on
edge GPUs through its **own Vulkan/Metal/Adreno/OpenCL kernels**. The new Gated
DeltaNet recurrent op exists upstream for CPU/CUDA but **may not exist in QVAC's
custom backends** — so Qwen3.5 might run on CPU yet fail/fall back on the edge GPU
paths that are QVAC's whole point. Supporting signal: the fork advertises
fine-tuning for "Gemma3, **Qwen3**, BitNet" — Qwen3, *not* 3.5 — hinting it's
behind. MoE routing on edge + the vision `mmproj` path add further surface.

**Practical limits:** only small variants (0.8B/2B/4B, maybe quantized 9B/27B) are
edge-realistic; the 122B/397B MoE models are not.

## The single cheapest experiment to run first

Convert **Qwen3.5-2B or -4B to GGUF** with upstream llama.cpp, then run it through
the *current* `qvac-fabric-llm.cpp` **on CPU**:
- Coherent output  => Tier 1 (mostly packaging).
- Conversion/load fails => Tier 2 (fork is behind).
- CPU works but Vulkan/Metal errors on unknown ops => Tier 3 (kernel work).

## Contribution / PR outlook

- Apache-2.0, documented gitflow contribution process — PRs are plausible.
- Change likely spans **two repos**: the engine fork (`qvac-fabric-llm.cpp`) and
  the SDK/registry (`qvac`).
- Best first move: **open an issue/discussion** to check whether they're already
  bumping the fork for Qwen3.5/3.6 before doing redundant work.

## Open questions to resolve next (still pure research)

1. **Build-number timing:** what calendar date / commit is llama.cpp `b8828`, and
   did Qwen3.5 base support land before or after it? This settles Tier 1 vs Tier 2.
2. **Backend op inventory:** does `qvac-fabric-llm.cpp`'s custom Vulkan/Metal/
   Adreno code implement the recurrent/Gated-DeltaNet ops Qwen3.5 needs? Settles
   Tier 3 exposure.
3. Chat-template / "thinking mode" special tokens for Qwen3.5 (low risk; jinja
   already supported).
4. Quantization format coverage for any new tensor types.

## Key links

- QVAC SDK monorepo: https://github.com/tetherto/qvac
- QVAC engine fork (llama.cpp): https://github.com/tetherto/qvac-fabric-llm.cpp
- QVAC docs: https://docs.qvac.tether.io/
- llama.cpp PR #20700 (Qwen3.5 MTP): https://github.com/ggml-org/llama.cpp/pull/20700
- llama.cpp conversion script: https://github.com/ggml-org/llama.cpp/blob/master/convert_hf_to_gguf.py
- Qwen3.5 Gated-DeltaNet analysis: https://gist.github.com/justinchuby/0213aa253664fb72e9adb0089816de15
- Qwen3.5 overview (vLLM & llama.cpp): https://debuggercafe.com/introduction-to-qwen3-5-overview-vllm-and-llama-cpp/
- Qwen3.5 variants/GGUFs (Unsloth): https://unsloth.ai/docs/models/qwen3.5
- llama.cpp "adding new model architectures" guide: https://github.com/ggml-org/llama.cpp/discussions/16770
