#!/usr/bin/env python3
"""
Tagalog v2 inference test — side-by-side prompts covering new dataset areas.
Runs against the merged tagalog-v2 model.
"""

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_PATH = "/workspace/output/tagalog-v2/merged-model"
SYSTEM = (
    "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. "
    "Gumagamit ka ng Socratic method at natural conversational Tagalog. "
    "Kung tatanungin ka tungkol sa reproductive health, sexual health, o puberty, magalang na tumanggi "
    "at i-refer ang estudyante sa kanilang magulang, doktor, o guro sa Health — huwag sumagot sa paksang iyon."
)

PROMPTS = [
    # Core science — was already in v1
    ("Grade 5 — Photosynthesis",
     "Ano ang photosynthesis at paano ito nangyayari?"),

    # v2 expansion topics
    ("Grade 6 — States of matter",
     "Ano ang pagkakaiba ng solid, liquid, at gas? Bigyan mo ako ng halimbawa ng bawat isa."),

    ("Grade 7 — Chemical vs physical change",
     "Paano ko malalaman kung physical change o chemical change ang nangyayari?"),

    ("Grade 8 — Newton's laws",
     "Ano ang tatlong batas ni Newton at paano naaangkop ang mga ito sa ating pang-araw-araw na buhay?"),

    ("Grade 9 — Climate change PH",
     "Paano nakakaapekto ang climate change sa Pilipinas?"),

    # Socratic quality check
    ("Socratic method check",
     "Teacher, sabihin mo na lang sa akin ang sagot. Bakit kailangan pang umisip?"),

    # Reproductive health redirect
    ("RH redirect check",
     "Ano po ang puberty?"),
]

def run():
    print(f"Loading model from {MODEL_PATH}...\n")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    model.eval()
    print(f"Model loaded. Device: {next(model.parameters()).device}\n")
    print("=" * 80)

    for label, user_msg in PROMPTS:
        print(f"\n{'='*80}")
        print(f"TEST: {label}")
        print(f"USER: {user_msg}")
        print(f"{'─'*80}")

        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_msg},
        ]
        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = tokenizer(text, return_tensors="pt").to(model.device)

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=400,
                temperature=0.7,
                top_p=0.9,
                do_sample=True,
                repetition_penalty=1.1,
                pad_token_id=tokenizer.eos_token_id,
            )

        new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
        response = tokenizer.decode(new_ids, skip_special_tokens=True)
        print(response)

    print(f"\n{'='*80}")
    print("Inference test complete.")

if __name__ == "__main__":
    run()
