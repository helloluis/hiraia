#!/usr/bin/env python3
"""
Full LoRA trainer for Hiraia (Qwen3-1.7B) via Unsloth, tuned for the shortened
kid-friendly datasets (everything fits c=512). Produces a PEFT adapter that is
then converted to GGUF for the QVAC phone runtime.
Usage: python train-full.py <dataset.jsonl> <output_dir> [epochs]
"""
import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, standardize_sharegpt

import os, sys
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

DATASET_PATH = sys.argv[1]
OUTPUT_DIR = sys.argv[2]
EPOCHS = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0

MODEL_NAME = os.environ.get("HIRAIA_BASE", "Qwen/Qwen3-1.7B")
MAX_SEQ_LENGTH = 512          # shortened data fits comfortably
LORA_RANK, LORA_ALPHA, LORA_DROPOUT = 32, 64, 0.05
TARGET_MODULES = ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"]


def formatting_prompts_func(examples, tokenizer):
    return {"text": [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False)
                     for c in examples["conversations"]]}


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    assert torch.cuda.is_available(), "CUDA not available"
    print(f"GPU: {torch.cuda.get_device_name(0)}  dataset={DATASET_PATH}  epochs={EPOCHS}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME, max_seq_length=MAX_SEQ_LENGTH, dtype=None, load_in_4bit=True)

    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab()
    tokenizer.eos_token = chatml_end

    model = FastLanguageModel.get_peft_model(
        model, r=LORA_RANK, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES, use_gradient_checkpointing="unsloth", random_state=42)

    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
    dataset = dataset.rename_column("messages", "conversations")
    dataset = standardize_sharegpt(dataset)
    dataset = dataset.map(lambda e: formatting_prompts_func(e, tokenizer), batched=True)
    split = dataset.train_test_split(test_size=0.05, seed=42)
    train_ds, eval_ds = split["train"], split["test"]
    print(f"train={len(train_ds)} eval={len(eval_ds)}")

    cfg = SFTConfig(
        output_dir=OUTPUT_DIR, num_train_epochs=EPOCHS,
        per_device_train_batch_size=8, gradient_accumulation_steps=2,
        learning_rate=1e-4, lr_scheduler_type="cosine", warmup_ratio=0.05,
        logging_steps=20, save_strategy="no",
        eval_strategy="steps", eval_steps=100, per_device_eval_batch_size=8,
        fp16=not torch.cuda.is_bf16_supported(), bf16=torch.cuda.is_bf16_supported(),
        optim="adamw_8bit", seed=42, report_to="none",
        max_length=MAX_SEQ_LENGTH, dataset_text_field="text",
        dataset_num_proc=2, eos_token=chatml_end)

    trainer = SFTTrainer(model=model, processing_class=tokenizer,
                         train_dataset=train_ds, eval_dataset=eval_ds, args=cfg)
    res = trainer.train()
    print(f"train_loss={res.metrics.get('train_loss'):.4f} "
          f"runtime_min={res.metrics.get('train_runtime',0)/60:.1f}")

    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"ADAPTER_SAVED {adapter_path}")


if __name__ == "__main__":
    main()
