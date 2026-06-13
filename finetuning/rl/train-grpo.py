#!/usr/bin/env python3
"""
train-grpo.py — GRPO (RL) continuation of the Hiraia tutor LoRA on Sailor2-3B-Chat.

Unlike the SFT scripts (train-tagalog-grounded.py etc.), this does NOT start a
fresh adapter: it re-creates the exact same LoRA shape (r=32, alpha=64, 7 proj
modules — verified against adapters/*/final-adapter/adapter_config.json) on the
base model and then loads the SFT adapter weights into it (INIT_ADAPTER), so
GRPO continues training the shipping adapter's weights. The result saves as a
normal HF PEFT dir → converts to GGUF with the same convert_lora_to_gguf.py
flow as every other adapter (see session_runner_v5.sh step 2).

Verified API surface (do not "modernize" blindly — these are the documented
contracts as of mid-2026):

  * TRL GRPOTrainer/GRPOConfig — https://huggingface.co/docs/trl/main/en/grpo_trainer
      - dataset must have a "prompt" column; ALL other columns are forwarded to
        the reward functions as keyword arguments (so our meta columns —
        required_terms / forbidden_terms / expect_abstain / expect_image —
        arrive in **kwargs of reward.grpo_reward).
      - reward func contract: called with prompts=, completions=,
        completion_ids=, trainer_state=, plus the dataset columns; returns
        list[float], one per completion. Use **kwargs to stay compatible.
      - num_generations = the GRPO group size G.
      - beta = KL coefficient; TRL default is 0.0 (KL term OFF). We set it
        non-zero on purpose: the SFT policy is our trusted anchor (grounding
        faithfulness already gated green) and we don't want RL to drift far.
      - use_vllm=True with the default vllm_mode="colocate" runs vLLM inside
        the trainer process (single-GPU friendly).
      - constraint: per_device_train_batch_size * num_processes * grad_accum
        must be divisible by num_generations (we set batch = group size, so it
        always holds).
  * Unsloth GRPO — https://unsloth.ai/docs/get-started/reinforcement-learning-rl-guide
    and the worked example https://huggingface.co/learn/llm-course/en/chapter12/6
      - FastLanguageModel.from_pretrained(..., fast_inference=True,
        max_lora_rank=..., gpu_memory_utilization=...) enables the vLLM
        rollout engine that GRPOConfig(use_vllm=True) uses.
      - get_peft_model + GRPOTrainer(model=..., processing_class=tokenizer,
        reward_funcs=[...], args=GRPOConfig(...), train_dataset=...).
  * Continuing from an existing LoRA: unsloth has a documented path of passing
    the adapter dir as model_name, but re-training adapters through that path
    has open issues with the GRPO/vLLM combo
    (https://github.com/unslothai/unsloth/issues/1877). We instead do the
    deterministic thing: fresh get_peft_model with the IDENTICAL config, then
    peft.set_peft_model_state_dict() with the SFT adapter_model.safetensors
    (standard PEFT API; inverse of what save_pretrained writes). Key counts
    are asserted so a silent no-op load fails loudly.

Run on a RunPod H100 80GB — see finetuning/rl/RUNPOD.md. No GPU needed to
syntax-check locally: python3 -m py_compile finetuning/rl/train-grpo.py

Usage (env vars double as defaults for the CLI flags):
  LANG_TAG=tagalog INIT_ADAPTER=/workspace/init-adapter-tagalog \\
      python -u train-grpo.py
  python -u train-grpo.py --lang bisaya --init-adapter /workspace/init-adapter-bisaya \\
      --max-steps 600 --group-size 6 --lr 5e-6
"""

# IMPORTANT: unsloth must be imported before trl/transformers so its patches
# apply to the trainer classes we actually use (same rule as the SFT scripts).
import unsloth  # noqa: F401  (import order is load-bearing)
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

import argparse
import json
import os
import statistics
import sys

import torch
from datasets import load_dataset
from peft.utils import set_peft_model_state_dict
from safetensors.torch import load_file as load_safetensors
from trl import GRPOConfig, GRPOTrainer

# reward.py lives next to this script (written by a sibling task; same repo
# dir and same /workspace dir on the pod). Interface we code against:
#   grpo_reward(prompts, completions, **kwargs) -> list[float]
# with the meta columns (required_terms, forbidden_terms, expect_abstain,
# expect_image, plus the full meta dict) arriving in kwargs per the TRL
# reward-function contract linked above.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from reward import grpo_reward  # noqa: E402

BASE_MODEL_DEFAULT = "sail/Sailor2-3B-Chat"  # the SHIPPING 3B product base (qwen2 arch)

# LoRA shape — MUST stay identical to the SFT adapters we continue from
# (verified against finetuning/adapters/tagalog-sailor-3b-grounded-ttft/
# final-adapter/adapter_config.json: r=32, alpha=64, these 7 modules).
LORA_RANK = 32
LORA_ALPHA = 64
TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]


def env(name, default):
    return os.environ.get(name, default)


def parse_args():
    p = argparse.ArgumentParser(description="GRPO continuation training for Hiraia (Sailor2-3B)")
    p.add_argument("--lang", default=env("LANG_TAG", "tagalog"),
                   choices=["tagalog", "bisaya"], help="adapter language tag")
    p.add_argument("--init-adapter", default=env("INIT_ADAPTER", ""),
                   help="HF PEFT dir of the SFT LoRA to continue from (REQUIRED; "
                        "must contain adapter_config.json + adapter_model.safetensors)")
    p.add_argument("--prompts", default=env("PROMPTS", ""),
                   help="prompts JSONL (default finetuning/rl/prompts/rl-prompts.<lang>.jsonl)")
    p.add_argument("--out-dir", default=env("OUT_DIR", ""),
                   help="output dir (default /workspace/output/<lang>-sailor-3b-grpo if "
                        "/workspace exists, else ./output/<lang>-sailor-3b-grpo)")
    p.add_argument("--base-model", default=env("BASE_MODEL", BASE_MODEL_DEFAULT))
    p.add_argument("--max-steps", type=int, default=int(env("MAX_STEPS", "600")))
    p.add_argument("--group-size", type=int, default=int(env("GROUP_SIZE", "6")),
                   help="GRPO group size G (TRL num_generations)")
    p.add_argument("--lr", type=float, default=float(env("LR", "5e-6")))
    p.add_argument("--kl-beta", type=float, default=float(env("KL_BETA", "0.04")),
                   help="KL coefficient vs the frozen SFT reference policy "
                        "(TRL default is 0.0 = off; we anchor on purpose)")
    p.add_argument("--max-new-tokens", type=int, default=int(env("MAX_NEW_TOKENS", "256")))
    p.add_argument("--max-prompt-len", type=int, default=int(env("MAX_PROMPT_LEN", "1536")),
                   help="grounded prompts (system + VERIFIED FACTS) reach ~1.2k tokens")
    p.add_argument("--grad-accum", type=int, default=int(env("GRAD_ACCUM", "2")),
                   help="unique prompts per optimizer step = grad_accum (batch = group size)")
    p.add_argument("--temperature", type=float, default=float(env("TEMP", "0.8")),
                   help="rollout sampling temperature (matches the harness GROUND_TEMP)")
    p.add_argument("--seed", type=int, default=int(env("SEED", "42")))
    p.add_argument("--log-every", type=int, default=int(env("LOG_EVERY", "10")))
    p.add_argument("--save-every", type=int, default=int(env("SAVE_EVERY", "100")))
    p.add_argument("--gpu-mem-util", type=float, default=float(env("GPU_MEM_UTIL", "0.7")),
                   help="vLLM share of VRAM; trainer uses the rest. 0.7 is roomy on 80GB for 3B")
    p.add_argument("--load-in-4bit", action="store_true",
                   default=env("LOAD_IN_4BIT", "0") == "1",
                   help="default OFF: 16-bit base matches the on-device math better "
                        "(device applies the f16 adapter to the GGUF base) and a 3B "
                        "fits an H100 80GB with huge margin")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------
def build_dataset(prompts_path, tokenizer):
    """Load the RL prompts JSONL and produce the TRL standard-format dataset.

    Each row: {"messages": [system, user], "meta": {required_terms, forbidden_terms,
    expect_abstain, expect_image, ...}}.

    We pre-apply the chat template ourselves — SAME way as the SFT scripts
    (chatml via unsloth get_chat_template) — but with add_generation_prompt=True
    so the rollout starts at the assistant turn. The result goes in the "prompt"
    column (string => TRL "standard format": prompts/completions reach the
    reward function as plain strings). Every other column is forwarded to
    grpo_reward as a kwarg, so we flatten the meta fields into columns AND keep
    the full meta dict.
    """
    ds = load_dataset("json", data_files=prompts_path, split="train")
    print(f"✓ Loaded {len(ds)} RL prompts from {prompts_path}")

    def to_row(example):
        messages = example["messages"]
        meta = dict(example.get("meta") or {})
        # kind/lang/grade live at the TOP level of the generator's rows, not in
        # meta — but reward.py reads meta["kind"]/meta["lang"] (chitchat brevity
        # + language scoring). Merge them in or those components silently no-op
        # (caught by smoke_reward.py 2026-06-11).
        for k in ("kind", "lang", "grade"):
            if k in example and k not in meta:
                meta[k] = example[k]
        return {
            "prompt": tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            ),
            # flattened meta -> dataset columns -> reward kwargs (TRL contract)
            "required_terms": list(meta.get("required_terms") or []),
            "forbidden_terms": list(meta.get("forbidden_terms") or []),
            "expect_abstain": bool(meta.get("expect_abstain") or False),
            # tri-state: None = neutral, False = must-NOT-tag — don't collapse
            "expect_image": meta.get("expect_image", None),
            "meta": meta,
        }

    ds = ds.map(to_row, remove_columns=[c for c in ds.column_names if c != "meta"])
    # sanity: the template must end with an open assistant turn
    probe = ds[0]["prompt"]
    assert probe.rstrip().endswith("<|im_start|>assistant"), (
        "prompt does not end with the ChatML assistant generation prompt — "
        f"chat template wiring is wrong. Tail: {probe[-120:]!r}"
    )
    return ds


# ---------------------------------------------------------------------------
# Adapter continuation
# ---------------------------------------------------------------------------
def load_init_adapter(model, init_dir, base_model_name):
    """Load SFT LoRA weights into the freshly-wrapped PEFT model (continue training).

    Deterministic alternative to passing the adapter dir as model_name (which
    has open unsloth issues for GRPO re-training — see module docstring).
    """
    cfg_path = os.path.join(init_dir, "adapter_config.json")
    st_path = os.path.join(init_dir, "adapter_model.safetensors")
    if not (os.path.isfile(cfg_path) and os.path.isfile(st_path)):
        raise FileNotFoundError(
            f"INIT_ADAPTER={init_dir} is not an HF PEFT adapter dir "
            "(need adapter_config.json + adapter_model.safetensors)"
        )

    with open(cfg_path) as f:
        cfg = json.load(f)
    assert cfg.get("r") == LORA_RANK and cfg.get("lora_alpha") == LORA_ALPHA, (
        f"adapter shape mismatch: init has r={cfg.get('r')} alpha={cfg.get('lora_alpha')}, "
        f"script builds r={LORA_RANK} alpha={LORA_ALPHA}"
    )
    assert sorted(cfg.get("target_modules", [])) == sorted(TARGET_MODULES), (
        f"target_modules mismatch: {sorted(cfg.get('target_modules', []))}"
    )
    init_base = cfg.get("base_model_name_or_path", "")
    if base_model_name not in init_base and init_base not in base_model_name:
        print(f"⚠ WARNING: init adapter base is {init_base!r}, training base is "
              f"{base_model_name!r} — proceeding, but verify this is intended.")

    state = load_safetensors(st_path)
    n_lora_keys = sum(1 for k in state if ".lora_" in k)
    # set_peft_model_state_dict remaps the saved keys onto the "default"
    # adapter and load_state_dict(strict=False)s them; returns the load result.
    result = set_peft_model_state_dict(model, state, adapter_name="default")
    unexpected = list(getattr(result, "unexpected_keys", []) or [])
    if unexpected:
        raise RuntimeError(
            f"{len(unexpected)} adapter keys did not map onto the model "
            f"(first: {unexpected[:3]}) — LoRA config drift; aborting rather "
            "than silently training from scratch."
        )
    print(f"✓ Continued from SFT adapter: {init_dir} ({n_lora_keys} LoRA tensors loaded)")


# ---------------------------------------------------------------------------
# Reward wrapper: pass-through + periodic stats
# ---------------------------------------------------------------------------
def make_logged_reward(fn, log_every):
    state = {"calls": 0, "window": []}

    def grpo_reward_logged(prompts, completions, **kwargs):
        rewards = fn(prompts=prompts, completions=completions, **kwargs)
        rewards = [float(r) for r in rewards]
        state["calls"] += 1
        state["window"].extend(rewards)
        if state["calls"] % log_every == 0:
            w = state["window"]
            print(
                f"[reward] gen-batches={state['calls']} n={len(w)} "
                f"mean={statistics.fmean(w):.3f} "
                f"min={min(w):.3f} max={max(w):.3f} "
                f"std={(statistics.pstdev(w) if len(w) > 1 else 0.0):.3f}",
                flush=True,
            )
            state["window"] = []
        return rewards

    grpo_reward_logged.__name__ = "grpo_reward"  # TRL logs per-func metrics by __name__
    return grpo_reward_logged


# ---------------------------------------------------------------------------
def main():
    args = parse_args()

    if not args.init_adapter:
        raise SystemExit(
            "INIT_ADAPTER is required — GRPO continues an existing SFT LoRA.\n"
            "e.g. INIT_ADAPTER=/workspace/init-adapter-tagalog (rsynced from\n"
            "finetuning/adapters/tagalog-sailor-3b-grounded-ttft/final-adapter)"
        )
    prompts_path = args.prompts or os.path.join(_HERE, "prompts", f"rl-prompts.{args.lang}.jsonl")
    if not os.path.isfile(prompts_path):
        raise SystemExit(f"prompts file not found: {prompts_path} (set PROMPTS=)")
    out_dir = args.out_dir or (
        f"/workspace/output/{args.lang}-sailor-3b-grpo" if os.path.isdir("/workspace")
        else os.path.join(_HERE, "output", f"{args.lang}-sailor-3b-grpo")
    )
    os.makedirs(out_dir, exist_ok=True)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available — this script runs on the RunPod H100, not the Mac.")
    print(f"✓ GPU: {torch.cuda.get_device_name(0)} "
          f"({torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB)")
    print(f"  lang={args.lang} steps={args.max_steps} G={args.group_size} lr={args.lr} "
          f"beta={args.kl_beta} max_new={args.max_new_tokens} seed={args.seed}")

    max_seq_length = args.max_prompt_len + args.max_new_tokens

    # --- model: base + vLLM rollout engine ---------------------------------
    # fast_inference=True + max_lora_rank + gpu_memory_utilization per the
    # unsloth GRPO recipe (llm-course ch12/6; unsloth RL guide).
    print(f"Loading {args.base_model} (fast_inference for GRPO rollouts)...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=max_seq_length,
        load_in_4bit=args.load_in_4bit,
        fast_inference=True,
        max_lora_rank=LORA_RANK,
        gpu_memory_utilization=args.gpu_mem_util,
        # vllm 0.19.1 — the ONLY vllm compatible with unsloth's torch<2.11 cap
        # (0.20+ all pin torch 2.11) — crashes in its piecewise-compilation pass
        # under unsloth's patched graph capture ("Tried to erase Node size_1",
        # 2026-06-11, also with FlashInfer disabled). enforce_eager skips vllm's
        # torch.compile entirely; rollouts ~20-30% slower but the run WORKS.
        # (from_pretrained forwards any kwarg in load_vllm's signature.)
        enforce_eager=True,
    )
    print("✓ Model loaded")

    # chat template — SAME as the SFT scripts (chatml + pinned <|im_end|> EOS)
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")
    chatml_end = "<" + "|im_end|" + ">"
    assert chatml_end in tokenizer.get_vocab(), "ChatML end token missing from vocab"
    tokenizer.eos_token = chatml_end
    print(f"✓ EOS token set (id={tokenizer.eos_token_id})")

    # --- LoRA: identical shape to the SFT adapter, then load its weights ----
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        # dropout 0 for RL: stochastic policies + policy-gradient updates mix
        # badly, and the SFT regularization job is already done.
        lora_dropout=0.0,
        target_modules=TARGET_MODULES,
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )
    load_init_adapter(model, args.init_adapter, args.base_model)
    model.print_trainable_parameters()

    # --- data ----------------------------------------------------------------
    train_dataset = build_dataset(prompts_path, tokenizer)

    # --- GRPO config (https://huggingface.co/docs/trl/main/en/grpo_trainer) --
    # batch = group size => every generation batch is exactly one prompt-group;
    # effective batch (batch * grad_accum) is trivially divisible by
    # num_generations as TRL requires. grad_accum = unique prompts per update.
    grpo_config = GRPOConfig(
        output_dir=out_dir,
        max_steps=args.max_steps,
        per_device_train_batch_size=args.group_size,
        gradient_accumulation_steps=args.grad_accum,
        num_generations=args.group_size,
        max_prompt_length=args.max_prompt_len,
        max_completion_length=args.max_new_tokens,
        learning_rate=args.lr,
        beta=args.kl_beta,            # KL anchor to the frozen SFT reference
        temperature=args.temperature,  # rollout diversity
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        adam_beta1=0.9,
        adam_beta2=0.99,
        weight_decay=0.1,
        max_grad_norm=0.1,            # conservative; unsloth GRPO recipe value
        optim="paged_adamw_8bit",
        logging_steps=args.log_every,
        save_strategy="steps",
        save_steps=args.save_every,
        save_total_limit=3,
        seed=args.seed,
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        report_to="none",
        use_vllm=True,                 # rollouts on the unsloth/vLLM engine
        # don't learn from answers that hit the token cap mid-sentence:
        mask_truncated_completions=True,
    )

    trainer = GRPOTrainer(
        model=model,
        processing_class=tokenizer,
        reward_funcs=[make_logged_reward(grpo_reward, args.log_every)],
        args=grpo_config,
        train_dataset=train_dataset,
    )

    print(f"Starting GRPO ({args.max_steps} steps, group={args.group_size}, "
          f"{args.grad_accum} prompt-group(s)/update)...\n" + "=" * 80)
    result = trainer.train()
    print("=" * 80 + "\n✓ GRPO training completed")
    m = result.metrics
    print(f"  train_runtime: {m.get('train_runtime', 0) / 60:.1f} min")

    # --- save: HF adapter dir, same convention as the SFT runs ---------------
    adapter_path = os.path.join(out_dir, "final-adapter")
    print(f"Saving adapter -> {adapter_path}")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    print("=" * 80)
    print(f"🎉 Done. GRPO adapter: {adapter_path}")
    print()
    print("Next (on the pod, BEFORE terminating — see finetuning/rl/RUNPOD.md):")
    print("  convert to a GGUF f16 LoRA matching the adapter-*-f16.gguf convention")
    print("  (same converter the SFT pipeline uses, session_runner_v5.sh step 2):")
    print(f"    cd $QVAC_SRC   # default /workspace/qvac-src-v8828")
    print(f"    python convert_lora_to_gguf.py {adapter_path} \\")
    print(f"        --base-model-id {args.base_model} --outtype f16 \\")
    print(f"        --outfile {out_dir}/adapter-{args.lang}-grpo-f16.gguf")
    print("  then scp it back and run the local gate:")
    print("    finetuning/eval/harness/run-harness.sh   (ADAPTER=/BIS_ADAPTER= overrides)")


if __name__ == "__main__":
    main()
