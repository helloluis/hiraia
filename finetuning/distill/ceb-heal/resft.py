#!/usr/bin/env python3
"""
resft.py — re-SFT a kitten LoRA adapter on the HEALED pruned-2.4B base.

Generic, env-driven (one script, both languages). Recipe is the CONSERVATIVE kitten-v7
recipe (r=16, alpha=16, lr=5e-5, 2 epochs, all 7 modules, early stop) — deliberately light
so the adapter adds tutor BEHAVIOR without eroding the languages the heal baked in
parametrically (the kill-switch is a preservation gate). Same recipe for tl and bis.

Env:
  RESFT_MODEL    base model dir/id (the healed 2.4B local dir)
  RESFT_DATASET  jsonl (chatml rows under "messages")
  RESFT_OUTPUT   output dir (adapter -> OUTPUT/final-adapter)
  RESFT_FORMAT   "messages" (apply_chat_template directly) | "sharegpt" (rename+standardize)
  RESFT_MAXSEQ   max seq length (default 2048; bis fits in 1024)
  RESFT_BS       per-device batch (default 8)  RESFT_GA grad-accum (default 4)  -> eff 32
"""
import unsloth
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, standardize_sharegpt

import os, torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
from transformers import EarlyStoppingCallback

MODEL_NAME   = os.environ["RESFT_MODEL"]
DATASET_PATH = os.environ["RESFT_DATASET"]
OUTPUT_DIR   = os.environ["RESFT_OUTPUT"]
FORMAT       = os.environ.get("RESFT_FORMAT", "messages")
MAX_SEQ_LENGTH = int(os.environ.get("RESFT_MAXSEQ", "2048"))
BATCH_SIZE   = int(os.environ.get("RESFT_BS", "8"))
GRADIENT_ACCUMULATION_STEPS = int(os.environ.get("RESFT_GA", "4"))

# v2 recipe: heavier than the 1B-conservative pass — the 2.4B under-fit behavioral polish at
# r16/a16/2ep (gate RED on chitchat/gibberish/abstain/myth). Bump capacity+signal but keep
# alpha=rank (not 2x) + early-stop to limit erosion of the healed languages. Override via env.
LORA_RANK = int(os.environ.get("RESFT_RANK", "32"))
LORA_ALPHA = int(os.environ.get("RESFT_ALPHA", "32"))
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
NUM_EPOCHS = int(os.environ.get("RESFT_EPOCHS", "3"))
LEARNING_RATE = 5e-5
WEIGHT_DECAY = 0.01


def formatting_prompts_func(examples, tokenizer, key):
    convos = examples[key]
    return {"text": [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False) for c in convos]}


def main():
    print(f"🚀 re-SFT [{FORMAT}] {DATASET_PATH} on {MODEL_NAME} (conservative r{LORA_RANK}/a{LORA_ALPHA})\n", flush=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available!")
    print(f"✓ GPU: {torch.cuda.get_device_name(0)}  VRAM: {torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB\n", flush=True)

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME, max_seq_length=MAX_SEQ_LENGTH, dtype=None, load_in_4bit=True,
    )
    print("✓ Healed 2.4B base loaded in 4-bit\n", flush=True)

    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab(), "ChatML end token missing from vocab"
    tokenizer.eos_token = chatml_end
    print(f"✓ EOS token set (id={tokenizer.eos_token_id})", flush=True)

    model = FastLanguageModel.get_peft_model(
        model, r=LORA_RANK, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES, use_gradient_checkpointing="unsloth", random_state=42,
    )
    model.print_trainable_parameters()
    print(flush=True)

    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
    print(f"✓ Loaded {len(dataset)} samples", flush=True)
    if FORMAT == "sharegpt":
        if "messages" in dataset.column_names:
            dataset = dataset.rename_column("messages", "conversations")
        dataset = standardize_sharegpt(dataset)
        key = "conversations"
    else:
        key = "messages"
    dataset = dataset.map(lambda ex: formatting_prompts_func(ex, tokenizer, key), batched=True)
    print("✓ Dataset formatted\n", flush=True)

    split = dataset.train_test_split(test_size=0.05, seed=42)
    train_dataset, eval_dataset = split["train"], split["test"]
    print(f"✓ Train: {len(train_dataset)}, Validation: {len(eval_dataset)}\n", flush=True)

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

    print("Starting training...\n" + "=" * 80, flush=True)
    train_result = trainer.train()
    m = train_result.metrics
    print("=" * 80 + f"\n✓ Training done. final_loss={m.get('train_loss', float('nan')):.4f} "
          f"time={m.get('train_runtime', 0)/60:.1f}min\n", flush=True)

    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"✓ Adapter saved → {adapter_path}\n🎉 Done.", flush=True)


if __name__ == "__main__":
    main()
