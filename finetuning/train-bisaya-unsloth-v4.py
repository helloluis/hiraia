#!/usr/bin/env python3
"""
Train Bisaya LoRA adapter for Hiraia using Unsloth
Optimized for RunPod with H100
"""

# IMPORTANT: Unsloth must be imported before trl/transformers so its patches
# apply to the SFTTrainer/SFTConfig classes we actually use. Otherwise the
# trainer silently rebuilds the config and drops our eos_token override.
import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, standardize_sharegpt

import os
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

# Configuration
MODEL_NAME = "sail/Sailor2-3B-Chat"
DATASET_PATH = "/workspace/train-bisaya-v4.jsonl"
OUTPUT_DIR = "/workspace/output/bisaya-sailor-v4"

# Training hyperparameters
LORA_RANK = 32
LORA_ALPHA = 64
LORA_DROPOUT = 0.05
TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj"
]

NUM_EPOCHS = 3
LEARNING_RATE = 1e-4
BATCH_SIZE = 4
GRADIENT_ACCUMULATION_STEPS = 4
MAX_SEQ_LENGTH = 1024   # fits all image-tagged rows (tag at end must not truncate); v2 long tails clip


def formatting_prompts_func(examples, tokenizer):
    """Apply chat template to each example."""
    convos = examples["conversations"]
    texts = [
        tokenizer.apply_chat_template(
            convo, tokenize=False, add_generation_prompt=False
        )
        for convo in convos
    ]
    return {"text": texts}


def main():
    print("🚀 Starting Bisaya LoRA training with Unsloth...\n")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available!")

    gpu_name = torch.cuda.get_device_name(0)
    print(f"✓ Using GPU: {gpu_name}")
    print(f"✓ VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB\n")

    # Load model with Unsloth optimizations
    print("Loading Sailor2-3B-Chat model...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )
    print("✓ Model loaded\n")

    # Apply chat template and fix EOS token
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    # The TRL SFTConfig default end token placeholder is not in the Sailor2 (Qwen2.5) vocab.
    # The ChatML end token IS present, so pin the tokenizer to it explicitly.
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab(), "ChatML end token missing from vocab"
    tokenizer.eos_token = chatml_end
    print(f"✓ EOS token set (id={tokenizer.eos_token_id})")

    # Apply LoRA
    print("Applying LoRA configuration...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    print(f"✓ LoRA applied to {len(TARGET_MODULES)} modules")
    print(f"  Rank: {LORA_RANK}, Alpha: {LORA_ALPHA}")
    model.print_trainable_parameters()
    print()

    # Load and prepare dataset
    print(f"Loading dataset from {DATASET_PATH}...")
    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
    print(f"✓ Loaded {len(dataset)} samples")

    # Rename messages to conversations for standardize_sharegpt
    dataset = dataset.rename_column("messages", "conversations")

    # Standardize and format
    dataset = standardize_sharegpt(dataset)
    dataset = dataset.map(
        lambda examples: formatting_prompts_func(examples, tokenizer),
        batched=True,
    )
    print("✓ Dataset formatted\n")

    # Split dataset
    split_dataset = dataset.train_test_split(test_size=0.1, seed=42)
    train_dataset = split_dataset["train"]
    eval_dataset = split_dataset["test"]
    print(f"✓ Train: {len(train_dataset)}, Validation: {len(eval_dataset)}\n")

    # Configure training using SFTConfig (TRL 0.24.0 API)
    print("Configuring training...")
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
        save_total_limit=3,
        eval_strategy="steps",
        eval_steps=100,
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

    print(f"  Epochs: {NUM_EPOCHS}")
    print(f"  Batch size: {BATCH_SIZE} × {GRADIENT_ACCUMULATION_STEPS} = {BATCH_SIZE * GRADIENT_ACCUMULATION_STEPS}")
    print(f"  Learning rate: {LEARNING_RATE}")
    print(f"  Max sequence length: {MAX_SEQ_LENGTH}\n")

    # Initialize trainer (TRL 0.24.0 API)
    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        args=sft_config,
    )

    print("Starting training...\n")
    print("=" * 80)

    # Train
    train_result = trainer.train()

    print("=" * 80)
    print("\n✓ Training completed!\n")

    # Print metrics
    metrics = train_result.metrics
    print("Training metrics:")
    print(f"  Final train loss: {metrics.get('train_loss', 'N/A'):.4f}")
    print(f"  Training time: {metrics.get('train_runtime', 0) / 60:.1f} minutes\n")

    # Save adapter
    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    print(f"Saving LoRA adapter to {adapter_path}...")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print("✓ Adapter saved\n")

    # Save merged model
    merge_path = os.path.join(OUTPUT_DIR, "merged-model")
    print(f"Merging adapter with base model to {merge_path}...")
    model.save_pretrained_merged(merge_path, tokenizer, save_method="merged_16bit")
    print("✓ Merged model saved\n")

    print("=" * 80)
    print("Training Summary:")
    print(f"  Model: {MODEL_NAME}")
    print(f"  LoRA: rank={LORA_RANK}, alpha={LORA_ALPHA}")
    print(f"  Epochs: {NUM_EPOCHS}")
    print(f"  Output: {OUTPUT_DIR}")
    print("=" * 80)
    print(f"\n🎉 Done! Adapter: {adapter_path}")
    print(f"Merged model: {merge_path}")


if __name__ == "__main__":
    main()
