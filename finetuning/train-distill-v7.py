#!/usr/bin/env python3
"""
Train Hiraia v7 LoRA for Sailor2-3B (tl/en adapter slot).

v7 = the v6 trainset + a TARGETED safety/myth patch fixing the temp-0.5 negation bug v6 role-play
surfaced (see hiraia-safety-myth-negation-bug). v6 over-trained the reflexive "Hindi po…" opener, so
yes/no SAFETY and MYTH questions mis-negated ("Masama ba manigarilyo?"→"Hindi po, hindi masama";
10%-brain myth affirmed). v7 retrains the opener PATTERN on AUP-safe, NON-body yes/no questions:
  - confident_safety : "Masama/Delikado ba X?" → confident CORRECT-polarity answer (no mis-scoped
                       negation). Mixed polarity (dangerous vs safe) so it evaluates, not reflexes.
  - myth_debunk      : "Totoo ba X?" → "Hindi po, hindi totoo… ang totoo ay…" (false) / "Oo po,
                       totoo…" (true). Mixed truth so it discriminates.
AUP: smoking/brain themselves are body/bio (can't go to the Claude teacher) — fix relies on the
opener pattern GENERALIZING; MUST verify smoking/brain at temp 0.5 in role-play (gate temp 0 is blind).

Whole dataset is on the CONTRACTED generateSystemPrompt (train/serve parity).
Dataset: finetuning/distill/train-distill-v7.jsonl (~9.8k rows). Same recipe as v4/v5/v6 (r32/a64/3ep).
"""

import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, standardize_sharegpt

import os
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

MODEL_NAME = "sail/Sailor2-3B-Chat"
DATASET_PATH = "/workspace/train-distill-v7.jsonl"
OUTPUT_DIR = "/workspace/output/distill-sailor-3b-v7"

LORA_RANK = 32
LORA_ALPHA = 64
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

NUM_EPOCHS = 3
LEARNING_RATE = 1e-4
BATCH_SIZE = 16
GRADIENT_ACCUMULATION_STEPS = 2
MAX_SEQ_LENGTH = 2048  # contracted prompt + grounding + think + answer (now well under 2048)


def formatting_prompts_func(examples, tokenizer):
    convos = examples["messages"]
    texts = [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False) for c in convos]
    return {"text": texts}


def main():
    print("🚀 Hiraia v7 LoRA (Sailor2-3B) — chitchat/abstention/refusal under the contracted prompt\n")
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
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        logging_steps=10,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=2,
        eval_strategy="steps",
        eval_steps=50,
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
