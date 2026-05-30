# tagalog-v2 LoRA Adapter

Hiraia Tagalog science tutor adapter — expanded dataset, trained on RunPod H100.

## Model Details

- **Base model**: Qwen/Qwen3-1.7B
- **Adapter type**: LoRA (rank=32, alpha=64)
- **Training framework**: Unsloth + TRL 0.24.0
- **Compute**: NVIDIA H100 (RunPod), ~5.8 minutes

## Training Configuration

| Hyperparameter | Value |
|---|---|
| LoRA rank | 32 |
| LoRA alpha | 64 |
| LoRA dropout | 0.05 |
| Target modules | q/k/v/o/gate/up/down_proj |
| Epochs | 3 |
| Learning rate | 1e-4 |
| LR scheduler | cosine |
| Batch size | 4 × 4 (effective 16) |
| Max seq length | 2048 |
| Quantization | 4-bit (QLoRA) |

## Dataset

- **File**: `science-chat-v2.jsonl`
- **Total dialogues**: 1,649 (up from 964 in v1)
- **Format**: ChatML / ShareGPT
- **Language**: Filipino/Tagalog
- **Scope**: Grade 3–10 science; Biology, Chemistry, Physics, Earth Science, Everyday PH Science

### New in v2 (685 additional dialogues)
- `matter-v2.mjs` — 151 dialogues (states of matter, phase changes, mixtures, density)
- `earth-weather-v2.mjs` — 150 dialogues (water cycle, weather, typhoons, geology, astronomy)
- `physics-v2.mjs` — 152 dialogues (force, motion, energy, electricity, light, sound)
- `chemistry-v2.mjs` — 151 dialogues (atoms, elements, reactions, periodic table)
- `biology-v2.mjs` — 49 dialogues (photosynthesis, cells, ecosystems, body systems)
- `everyday-ph-v2.mjs` — 32 dialogues (cooking science, weather safety, home technology)

### Content Policy
All datasets are free of reproductive health topics. Redirect dialogues are included so the model responds politely but declines such questions and refers students to parents, health teachers, or doctors.

## Results

| Metric | Value |
|---|---|
| Final train loss | 1.4251 |
| Final eval loss | 1.268 |
| Training time | 5.8 minutes |

## Comparison to v1

| | tagalog-v1 | tagalog-v2 |
|---|---|---|
| Dataset size | 964 | 1,649 |
| Train loss | ~1.38 | 1.43 |
| Eval loss | ~1.29 | 1.27 |
| Training time | ~3.4 min | ~5.8 min |

## Usage

```python
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="Qwen/Qwen3-1.7B",
    max_seq_length=2048,
    dtype=None,
    load_in_4bit=True,
)

# Load the adapter
from peft import PeftModel
model = PeftModel.from_pretrained(model, "path/to/tagalog-v2/final-adapter")

tokenizer = get_chat_template(tokenizer, chat_template="chatml")

messages = [
    {"role": "system", "content": "Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science."},
    {"role": "user", "content": "Ano ang photosynthesis?"},
]

text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(text, return_tensors="pt").to("cuda")

from transformers import TextStreamer
streamer = TextStreamer(tokenizer)
model.generate(**inputs, streamer=streamer, max_new_tokens=512, temperature=0.7)
```

## Notes

- Import `unsloth` **before** `trl` to ensure Unsloth's patches apply correctly.
- The EOS token is pinned to `<|im_end|>` (the ChatML end token) — it is present in Qwen3's vocabulary.
