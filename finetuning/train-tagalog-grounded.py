#!/usr/bin/env python3
"""
Train the Tagalog GROUNDING-FAITHFULNESS LoRA adapter for Hiraia (Sailor2-3B).

Different from train-tagalog-unsloth.py (the v3 image-tag run):
  - base = sail/Sailor2-3B-Chat (the on-device product target, not the 1B)
  - dataset = the grounded set (system + VERIFIED FACTS block + question -> answer
    that uses ONLY those facts / abstains / chit-chats). Teaches the model to
    DEFER to the grounding it is handed at runtime — the behavior the current
    adapter fails at (it ignores the facts and confabulates).
  - MAX_SEQ_LENGTH = 2048 (grounded rows reach ~1.2k tokens; 1024 would truncate)
  - train_on_responses_only: loss is computed ONLY on the assistant turns, so the
    model learns to PRODUCE faithful answers instead of memorizing the long,
    near-identical system prompt that dominates each row.
"""

import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, standardize_sharegpt, train_on_responses_only

import os
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

# Configuration
MODEL_NAME = "sail/Sailor2-3B-Chat"
DATASET_PATH = "/workspace/train-grounded.jsonl"
OUTPUT_DIR = "/workspace/output/tagalog-sailor-3b-grounded"

# LoRA
LORA_RANK = 32
LORA_ALPHA = 64
LORA_DROPOUT = 0.05
TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]

# Training hyperparameters — small set (411 rows), so a few more epochs + frequent eval.
NUM_EPOCHS = 4
LEARNING_RATE = 1e-4
BATCH_SIZE = 4
GRADIENT_ACCUMULATION_STEPS = 4
MAX_SEQ_LENGTH = 2048


def formatting_prompts_func(examples, tokenizer):
    convos = examples["conversations"]
    texts = [
        tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False)
        for convo in convos
    ]
    return {"text": texts}


def main():
    print("🚀 Training Tagalog GROUNDED (faithfulness) LoRA on Sailor2-3B...\n")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available!")
    print(f"✓ GPU: {torch.cuda.get_device_name(0)} "
          f"({torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB)\n")

    print(f"Loading {MODEL_NAME}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )
    print("✓ Model loaded\n")

    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab(), "ChatML end token missing from vocab"
    tokenizer.eos_token = chatml_end
    print(f"✓ EOS token set (id={tokenizer.eos_token_id})")

    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    print(f"✓ LoRA r={LORA_RANK} alpha={LORA_ALPHA} on {len(TARGET_MODULES)} modules")
    model.print_trainable_parameters()
    print()

    print(f"Loading dataset from {DATASET_PATH}...")
    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
    print(f"✓ Loaded {len(dataset)} samples")
    dataset = dataset.rename_column("messages", "conversations")
    dataset = standardize_sharegpt(dataset)
    dataset = dataset.map(
        lambda examples: formatting_prompts_func(examples, tokenizer),
        batched=True,
    )

    split = dataset.train_test_split(test_size=0.1, seed=42)
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
        logging_steps=5,
        save_strategy="steps",
        save_steps=20,
        save_total_limit=3,
        eval_strategy="steps",
        eval_steps=20,
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
        model=model,
        processing_class=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        args=sft_config,
    )

    # Loss ONLY on the assistant responses — the model must learn to produce faithful
    # answers, not to reproduce the long shared system+grounding prompt.
    trainer = train_on_responses_only(
        trainer,
        instruction_part="<|im_start|>user\n",
        response_part="<|im_start|>assistant\n",
    )

    print("Starting training...\n" + "=" * 80)
    result = trainer.train()
    print("=" * 80 + "\n✓ Training completed!\n")
    m = result.metrics
    print(f"  Final train loss: {m.get('train_loss', float('nan')):.4f}")
    print(f"  Training time: {m.get('train_runtime', 0) / 60:.1f} minutes\n")

    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    print(f"Saving adapter -> {adapter_path}")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    merge_path = os.path.join(OUTPUT_DIR, "merged-model")
    print(f"Saving merged 16-bit -> {merge_path}")
    model.save_pretrained_merged(merge_path, tokenizer, save_method="merged_16bit")

    print("=" * 80)
    print(f"🎉 Done. Adapter: {adapter_path} | Merged: {merge_path}")


if __name__ == "__main__":
    main()
