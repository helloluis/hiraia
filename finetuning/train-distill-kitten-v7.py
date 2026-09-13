#!/usr/bin/env python3
"""
Train Hiraia kitten-v7 LoRA for Sailor2-1B (Tagalog adapter slot for the budget tier).

THIS IS A FORKED RECIPE — distinct from the 3B's train-distill-v10.py. The deep-research
synthesis (V11-RESEARCH.md) concluded that the kitten lineage's persistent regressions
(safety-negation flip, flat-Earth affirmation, settled-science over-abstention,
`<think>` leakage) are textbook catastrophic forgetting under standard LoRA on a 1B base,
and Hiraia's v1..v4 config sits on the aggressive end of every endorsed dimension
(rank, alpha ratio, target modules, dataset size, epochs).

Recipe deltas vs the 3B v9/v10 recipe:
  - DATASET                12,424 (v4) → ~3,800 (v5)   focused / hygiene-filtered / no v4 base
  - LoRA RANK              32 → 16                     unsloth canonical range, conservative end
  - LoRA ALPHA             64 (2:1) → 16 (1:1)         alpha=rank baseline (both ratios endorsed)
  - LEARNING RATE          1e-4 → 5e-5                 small model fragility per Chen/Hayou 2026
  - EPOCHS                 3 → 2                       early stopping on eval_loss
  - WEIGHT DECAY           0 → 0.01                    light regularization vs CF
  - TARGET MODULES         all 7 (q,k,v,o,gate,up,down) — UNCHANGED (research confirmed correct)
  - LOAD-BEST-AT-END       true (already set)          enforces eval_loss as the final selector

EARLY STOPPING is enabled with patience 2 — if eval_loss hasn't improved across 2 eval
windows, training halts. This is the operational guard against the "keep training and
keep forgetting" failure mode.

Whole dataset is on the CONTRACTED generateSystemPrompt (train/serve parity).
Dataset: finetuning/distill/train-distill-kitten-v7.jsonl  (~3,800 rows, fresh start)
"""

import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

import os
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
from transformers import EarlyStoppingCallback

MODEL_NAME = "sail/Sailor2-1B-Chat"
DATASET_PATH = "/workspace/train-distill-kitten-v7.jsonl"
OUTPUT_DIR = "/workspace/output/distill-sailor-1b-kitten-v7"

LORA_RANK = 16
LORA_ALPHA = 16
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

NUM_EPOCHS = 2
LEARNING_RATE = 5e-5
BATCH_SIZE = 16
GRADIENT_ACCUMULATION_STEPS = 2
WEIGHT_DECAY = 0.01
MAX_SEQ_LENGTH = 2048  # tighter dataset → shorter sequences; no need for 3072


def formatting_prompts_func(examples, tokenizer):
    convos = examples["messages"]
    texts = [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False) for c in convos]
    return {"text": texts}


def main():
    print("🚀 Hiraia kitten-v7 LoRA (Sailor2-1B) — focused 3.8k dataset, conservative HPs, CF defense\n")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available!")
    print(f"✓ GPU: {torch.cuda.get_device_name(0)}  VRAM: {torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB\n")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME, max_seq_length=MAX_SEQ_LENGTH, dtype=None, load_in_4bit=True,
    )
    print("✓ Model loaded\n")

    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab(), "ChatML end token missing from vocab"
    tokenizer.eos_token = chatml_end
    print(f"✓ EOS token set (id={tokenizer.eos_token_id})")

    model = FastLanguageModel.get_peft_model(
        model, r=LORA_RANK, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES, use_gradient_checkpointing="unsloth", random_state=42,
    )
    model.print_trainable_parameters()
    print()

    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
    print(f"✓ Loaded {len(dataset)} samples")
    dataset = dataset.map(lambda ex: formatting_prompts_func(ex, tokenizer), batched=True)
    print("✓ Dataset formatted\n")

    split = dataset.train_test_split(test_size=0.05, seed=42)
    train_dataset, eval_dataset = split["train"], split["test"]
    print(f"✓ Train: {len(train_dataset)}, Validation: {len(eval_dataset)}\n")

    sft_config = SFTConfig(
        output_dir=OUTPUT_DIR,
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION_STEPS,
        learning_rate=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        logging_steps=10,
        save_strategy="steps",
        save_steps=50,
        save_total_limit=2,
        eval_strategy="steps",
        eval_steps=25,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        optim="adamw_8bit",
        seed=42,
        report_to="none",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        max_length=MAX_SEQ_LENGTH,
        dataset_text_field="text",
        dataset_num_proc=1,
        eos_token=chatml_end,
    )

    trainer = SFTTrainer(
        model=model, processing_class=tokenizer,
        train_dataset=train_dataset, eval_dataset=eval_dataset, args=sft_config,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2, early_stopping_threshold=0.001)],
    )

    print("Starting training...\n" + "=" * 80)
    train_result = trainer.train()
    print("=" * 80 + "\n✓ Training completed!\n")
    m = train_result.metrics
    print(f"  Final train loss: {m.get('train_loss', float('nan')):.4f}")
    print(f"  Training time: {m.get('train_runtime', 0)/60:.1f} min\n")

    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"✓ Adapter saved → {adapter_path}")

    print("\n🎉 Done.")


if __name__ == "__main__":
    main()
