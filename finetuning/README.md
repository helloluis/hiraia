# Hiraia LoRA Fine-tuning

This directory contains the infrastructure for fine-tuning Qwen3-1.7B with LoRA adapters to improve Tagalog and Cebuano Bisaya language generation for the Hiraia AI tutor.

## Overview

We use two separate LoRA adapters:
- **hiraia-tagalog-v1.gguf** (~20MB) — Tagalog language adaptation
- **hiraia-cebuano-v1.gguf** (~20MB) — Cebuano Bisaya language adaptation

Both adapters are trained using QVAC's built-in `finetune()` API with SFT (Supervised Fine-Tuning) and `assistantLossOnly: true` to focus learning on assistant responses.

## Prerequisites

- **GPU-equipped machine** (NVIDIA GPU with 8GB+ VRAM recommended)
- **QVAC SDK** ^0.11.0 installed
- **Qwen3-1.7B Q4_K_M** model loaded via QVAC
- **Training datasets** in HuggingFace chat JSONL format

## Directory Structure

```
finetuning/
├── datasets/              # Training data (JSONL format)
│   ├── tagalog/
│   │   └── science-chat.jsonl
│   └── cebuano/
│       └── science-chat.jsonl
├── scripts/
│   ├── train-tagalog.js   # Train Tagalog LoRA adapter
│   ├── train-cebuano.js   # Train Cebuano LoRA adapter
│   └── monitor.js         # Monitor training progress
├── output/                # Generated LoRA adapters (gitignored)
│   ├── tagalog/
│   └── cebuano/
└── README.md
```

## Dataset Format

Training data must be in **HuggingFace chat format** (JSONL):

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful tutor..."},
    {"role": "user", "content": "Student question in Tagalog"},
    {"role": "assistant", "content": "Tutor response in natural Tagalog"}
  ]
}
```

**Guidelines:**
- Each line is a complete conversation
- Include diverse science topics aligned with DepEd curriculum
- Assistant responses should sound natural, not robotic
- Use Filipino cultural references (sari-sari stores, typhoons, local food)
- Aim for 500-1000 high-quality examples per language

## Training

### Tagalog Adapter

```bash
node scripts/train-tagalog.js
```

### Cebuano Adapter

```bash
node scripts/train-cebuano.js
```

### Training Configuration

Both scripts use these optimized parameters:

```javascript
{
  numberOfEpochs: 3,
  learningRate: 1e-4,
  contextLength: 2048,
  batchSize: 4,
  microBatchSize: 1,
  assistantLossOnly: true,
  loraRank: 32,
  loraAlpha: 64,
  loraModules: "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down"
}
```

## Monitoring

During training, the scripts output real-time progress:

```
Step 100/500 | Epoch 1/3 | Loss: 2.34 | ETA: 45m
Step 200/500 | Epoch 2/3 | Loss: 1.87 | ETA: 22m
...
```

Use `scripts/monitor.js` to check status of a paused run:

```bash
node scripts/monitor.js tagalog
```

## Output

After training completes, you'll find:
- `ggml-adapter-model.bin` — The LoRA adapter weights (~20MB)
- `adapter_config.json` — Adapter configuration

These files are loaded in the mobile app via:

```typescript
loadModel({
  modelSrc: QWEN3_1_7B_INST_Q4,
  modelConfig: {
    lora: "/path/to/hiraia-tagalog-v1.gguf"
  }
});
```

## Dataset Generation Pipeline

1. **Extract** DepEd curriculum content from `references/`
2. **Generate** synthetic dialogues using a larger model (GPT-4, Claude, etc.)
3. **Review** by native Tagalog/Cebuano speakers for naturalness
4. **Format** as JSONL and place in `datasets/{language}/`

## Tips

- Start with 200-300 examples to validate the pipeline
- Scale to 800-1000 examples for production quality
- Include common student misconceptions and how to address them
- Add examples of the tutor asking Socratic questions
- Test early iterations on actual Filipino students

## License

Training scripts: Apache 2.0 (same as QVAC SDK)
Training data: Ensure proper attribution for any DepEd content used
