# Image-tag SFT dataset

Teaches the tutor to emit an **invisible image control token** when a simple
diagram would help, so a retrieval layer can show a matching picture. The model
learns *behavior* (when to ask for an image + a short English description) — it
never learns the catalog, so the image DB can grow without retraining.

## Files

- `tagalog/science-chat-tagged.jsonl` — 369 rows (260 tagged, 109 negatives)
- `bisaya/science-chat-tagged.jsonl` — 367 rows (274 tagged, 93 negatives)

Same schema as `science-chat-v2.jsonl`: `{"messages":[system,user,assistant]}`,
single-turn, grades 3–10. Generated with parallel Sonnet agents (2 langs × 12
image topics), grounded in the real image catalog — **every tagged row maps to a
real concept id** (0 grounding misses).

## The tag convention

A tagged answer ends with, on its own line:

```
[image: <short English caption-style description of the visual>]
```

- The description is **English** (our captions are English-anchored → best retrieval alignment).
- The token is **stripped at display time** in the web app (`AssistantMessage.tsx` → `parseImageTag`), always — whether or not a matching image is found. The raw text (with the token) is persisted so the model stays aware of it in history.
- Negatives carry **no** tag — they teach restraint.

## System prompt (must match at inference)

Tagged rows use a tag-aware system prompt = the existing per-grade prompt + the
repro-health refusal clause + this instruction:

- **Tagalog:** ` Kapag makakatulong ang isang simpleng larawan sa pagpapaliwanag, magdagdag ng huling linyang: [image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. Kung walang angkop na larawan, huwag maglagay ng ganitong linya.`
- **Bisaya:** ` Kung makatabang ang usa ka simpleng hulagway sa pagpasabot, pagdugang og kataposang linya nga: [image: mubo ug tukma nga English nga paghulagway sa hulagway]. Kung walay angay nga hulagway, ayaw pagbutang niini nga linya.`

> ⚠️ When the tag-trained LoRA is deployed, append the matching instruction to the
> production system prompts in `packages/web/src/config/model.ts`. Do **not** add it
> before the LoRA ships, or the current (untrained) model may emit stray tags.

## Integrating for a training run

The existing `science-chat-v2.jsonl` rows use the **old** (no-tag) system prompt,
so mixing them in teaches the model: *tag instruction present → may tag; absent →
never tag.* Concatenate per language:

```bash
cat tagalog/science-chat-v2.jsonl tagalog/science-chat-tagged.jsonl > tagalog/train-v3.jsonl
cat bisaya/science-chat.jsonl     bisaya/science-chat-tagged.jsonl  > bisaya/train-v3.jsonl
```

## Regenerate / rebalance

`/tmp/hiraia-sft/sft.workflow.js` (+ `assemble.mjs`). Current tagged ratio ≈73%;
generate a negatives-only batch to push toward ~60/40 if the trained model tags
too eagerly.
