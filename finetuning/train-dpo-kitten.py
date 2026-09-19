#!/usr/bin/env python3
"""DPO for the Sailor2-1B kitten — fix the safety/myth WRONG-POLARITY reflex that
SFT (v1-v7) structurally couldn't (see hiraia-safety-myth-negation-bug). Continues
from the v7 SFT adapter (keeps its English bucket + grounding + tutor behavior) and
DPO-trains it on preference pairs (chosen=correct polarity, rejected=the reflex).

CONSERVATIVE settings (low lr, beta 0.1, 2 epochs) so DPO makes a TARGETED polarity
correction without wiping the v7 SFT behavior. ref_model=None → unsloth PatchDPOTrainer
uses the adapter-disabled base as the implicit reference (PEFT-DPO standard). Final =
a single LoRA on the original Sailor2-1B base → drop-in deployable as the next kitten.

Run AFTER train-distill-kitten-v7.py (which writes the v7 adapter this loads)."""
import unsloth  # noqa: F401  (must import first)
from unsloth import FastLanguageModel, PatchDPOTrainer
PatchDPOTrainer()

import os
import torch
from datasets import load_dataset
from unsloth.chat_templates import get_chat_template
from trl import DPOTrainer, DPOConfig

SFT_ADAPTER = "/workspace/output/distill-sailor-1b-kitten-v7/final-adapter"  # base+v7, the DPO init
DATASET_PATH = "/workspace/train-dpo-kitten.jsonl"
OUTPUT_DIR = os.environ.get("DPO_OUT", "/workspace/output/distill-sailor-1b-kitten-v8dpo")
MAX_SEQ = 2048

# Attempt 2 (2026-06-20): attempt 1 (lr5e-6/2ep/beta0.1) made NO dent in the held-out
# failure rate (63%→66%, loss 0.845 — barely moved). Going decisively stronger.
BETA = float(os.environ.get("DPO_BETA", "0.1"))
LEARNING_RATE = float(os.environ.get("DPO_LR", "3e-5"))   # 6x attempt 1
NUM_EPOCHS = int(os.environ.get("DPO_EPOCHS", "3"))
BATCH = 4
GRAD_ACCUM = 4           # effective 16


def main():
    print("🚀 Kitten DPO (Sailor2-1B) — safety/myth polarity fix on top of v7 SFT\n")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    assert torch.cuda.is_available(), "CUDA not available!"
    print(f"✓ GPU: {torch.cuda.get_device_name(0)}\n")

    # Load the v7 SFT adapter (base Sailor2-1B + v7 LoRA), trainable — DPO continues it.
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=SFT_ADAPTER, max_seq_length=MAX_SEQ, dtype=None, load_in_4bit=True,
    )
    print("✓ Loaded v7 SFT adapter (base+v7)\n")

    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    tokenizer.eos_token = chatml_end

    # Ensure the loaded adapter is set up for (continued) training. If unsloth loaded the
    # adapter as inference-only, re-wrap as a trainable PEFT model on the SAME modules.
    try:
        model = FastLanguageModel.get_peft_model(
            model, r=16, lora_alpha=16, lora_dropout=0.0,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            use_gradient_checkpointing="unsloth", random_state=42,
        )
    except Exception as e:
        print(f"(get_peft_model skipped — adapter already trainable: {e})")
    model.print_trainable_parameters()

    ds = load_dataset("json", data_files=DATASET_PATH, split="train")
    # TRL DPOTrainer (conversational) needs only prompt/chosen/rejected; drop our _meta.
    keep = {"prompt", "chosen", "rejected"}
    ds = ds.remove_columns([c for c in ds.column_names if c not in keep])
    print(f"✓ Loaded {len(ds)} DPO pairs (cols: {ds.column_names})\n")

    cfg = DPOConfig(
        output_dir=OUTPUT_DIR,
        beta=BETA,
        per_device_train_batch_size=BATCH,
        gradient_accumulation_steps=GRAD_ACCUM,
        num_train_epochs=NUM_EPOCHS,
        learning_rate=LEARNING_RATE,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=1,
        optim="adamw_8bit",
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        max_length=MAX_SEQ,
        max_prompt_length=1024,
        seed=42,
        report_to="none",
    )

    trainer = DPOTrainer(
        model=model, ref_model=None, args=cfg,
        train_dataset=ds, processing_class=tokenizer,
    )
    print("Starting DPO...\n" + "=" * 70)
    res = trainer.train()
    print("=" * 70 + f"\n✓ DPO done. loss={res.metrics.get('train_loss', float('nan')):.4f}, "
          f"time={res.metrics.get('train_runtime', 0)/60:.1f} min\n")

    adapter_path = os.path.join(OUTPUT_DIR, "final-adapter")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"✓ Adapter saved → {adapter_path}\n🎉 Done.")


if __name__ == "__main__":
    main()
