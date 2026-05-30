#!/usr/bin/env python3
"""Quick Tagalog inference test for the fine-tuned Hiraia adapter."""

import unsloth
from unsloth import FastLanguageModel

import torch
from transformers import TextStreamer

MERGED_MODEL = "/workspace/output/tagalog-unsloth/merged-model"
MAX_SEQ_LENGTH = 2048

PROMPTS = [
    "Ano ang pagkakaiba ng solid, liquid, at gas?",
    "Bakit kailangan ng mga halaman ang araw?",
    "Paano gumagana ang water cycle? Ipaliwanag mo sa simpleng paraan.",
    "Ano ang photosynthesis at bakit ito mahalaga?",
    "Pakipaliwanag kung bakit lumulubog ang ilang bagay sa tubig at lumulutang ang iba.",
]


def main():
    print("Loading fine-tuned merged model...\n")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MERGED_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)
    print("Model loaded.\n")
    print("=" * 80)

    for i, prompt in enumerate(PROMPTS, 1):
        print(f"\n[{i}] USER: {prompt}\n")
        print("ASSISTANT: ", end="", flush=True)
        messages = [{"role": "user", "content": prompt}]
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to("cuda")
        streamer = TextStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        model.generate(
            input_ids=inputs,
            streamer=streamer,
            max_new_tokens=256,
            temperature=0.7,
            top_p=0.9,
            do_sample=True,
        )
        print("\n" + "=" * 80)


if __name__ == "__main__":
    main()
