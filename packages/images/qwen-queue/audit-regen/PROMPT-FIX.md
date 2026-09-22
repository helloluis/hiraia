# Prompt-fix pass (regen leftovers)

Rewrite **subject** prompts for every leftover unique image in
`prompt-fix-queue.jsonl` (3532). Do not wait for Luis. Do not regenerate
images or submit a ChatGPT batch until the queue is empty.

## Files

- `prompt-fix-queue.jsonl` — full leftover set (do not rewrite this file)
- `prompt-rewrites.jsonl` — one JSON object per finished id (append only)
- `PROMPT-FIX-STATUS.json` — counts; rewrite each heartbeat

## Rewrite rules

- Output **subject only**. House engraving style is added later.
- Keep the card’s teaching point (`align_bad[].en` / topic).
- Use Qwen `evidence` as a list of things the picture must **not** do.
- One concrete scene. No labels, letters, numbers, or captions in the picture
  unless the card is specifically about a numeral sitting in a table cell.
- Prefer “do not draw X” over vague “make it accurate”.
- If Qwen looks wrong and the old prompt is already precise, still tighten
  with one explicit don’t; do not skip.
- `new_prompt` is a single English paragraph, not a JSON schema.

## Each heartbeat

1. Count queue vs `prompt-rewrites.jsonl` ids.
2. If remaining is 0: write STATUS, build `batch-requests-4.jsonl` from
   rewrites using the same gpt-image-2 body as `build.py` (do **not** submit
   unless Luis already asked), stop.
3. Otherwise first merge any `prompt-rewrites-part-*.jsonl` into
   `prompt-rewrites.jsonl` (skip duplicate ids). Then rewrite the next
   **200** unfinished rows in queue order (priority 0 reject, then
   uncertain, error, alignment-only).
4. Append those lines to `prompt-rewrites.jsonl`.
5. Update `PROMPT-FIX-STATUS.json`.
6. Do not start a second ChatGPT/Qwen spend. Do not commit.

Work in `/Users/luis/Code/hiraia`.
