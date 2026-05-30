---
base_model: Qwen/Qwen3-1.7B
library_name: peft
pipeline_tag: text-generation
language:
- tl
tags:
- lora
- sft
- unsloth
- trl
- tagalog
- hiraia
---

# Hiraia Tagalog LoRA Adapter — `tagalog-v1`

LoRA adapter that improves **Qwen3-1.7B**'s ability to converse and teach
in **Tagalog**, focused on science education content for the Hiraia system.

## Summary

| | |
|---|---|
| Base model | `Qwen/Qwen3-1.7B` |
| Method | LoRA (QLoRA, 4-bit base) via Unsloth + TRL `SFTTrainer` |
| Adapter type | PEFT LoRA |
| Language | Tagalog (`tl`) |
| Dataset | `finetuning/datasets/tagalog/science-chat-v2.jsonl` (964 samples) |

## Training configuration

| Hyperparameter | Value |
|---|---|
| LoRA rank (`r`) | 32 |
| LoRA alpha | 64 |
| LoRA dropout | 0.05 |
| Target modules | `q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj` |
| Epochs | 3 |
| Effective batch size | 16 (4 per device × 4 grad accumulation) |
| Learning rate | 1e-4, cosine schedule, 10% warmup |
| Max sequence length | 2048 |
| Optimizer | `adamw_8bit` |
| Precision | bf16 |
| Chat template | ChatML |
| Trainable params | 34,865,152 (1.99% of 1.76B) |

## Dataset

- 964 conversational samples → 867 train / 97 validation (10% split, seed 42)
- Science education dialogues in Tagalog
- Formatted as ShareGPT-style conversations, standardized and rendered with the ChatML template

## Results

| Metric | Value |
|---|---|
| Final train loss | 1.443 |
| Final eval loss | 1.28 |
| Total steps | 165 |
| Training time | ~3.4 min |

## Compute

- **Hardware:** 1× NVIDIA H100 80GB HBM3 (RunPod)
- **Software:** Unsloth 2026.5.8, PyTorch 2.7.0+cu126, TRL 0.24.0, Transformers 5.5.0

## How to use

```python
from unsloth import FastLanguageModel  # import unsloth FIRST

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="Qwen/Qwen3-1.7B",
    max_seq_length=2048,
    load_in_4bit=True,
)
model.load_adapter("finetuning/adapters/tagalog-v1")
```

Reproduce with `finetuning/train-tagalog-unsloth.py` (see `finetuning/RUNPOD-COMPLETE-SETUP.md`).

> **Note:** `import unsloth` (or `from unsloth import ...`) MUST come before any
> `trl` / `transformers` imports. Otherwise the patched `SFTTrainer`/`SFTConfig`
> classes won't match, the trainer silently rebuilds its config, and the
> `eos_token` override is dropped.

### Framework versions

- PEFT 0.19.1
