// QVAC engine wrapper for the Hiraia inference sidecar.
//
// Mirrors the mobile LocalEngine flow (loadModel -> completion -> unloadModel)
// but runs in Node on a desktop dev host. Thinking/reasoning is disabled and we
// only forward `contentDelta` tokens, so the tutor answers directly.

import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Optional fine-tuned LoRA adapter (GGUF) produced by `npm run train`. When
// HIRAIA_LORA_ADAPTER points at a .gguf file, it's applied at model load via
// llama.cpp's lora support; otherwise we serve the plain base model.
const LORA_ADAPTER = process.env.HIRAIA_LORA_ADAPTER
  ? path.resolve(process.env.HIRAIA_LORA_ADAPTER)
  : null

// Point QVAC at our LLM-only Bare worker BEFORE the SDK module is evaluated.
// (The SDK resolves QVAC_WORKER_PATH at import time, so this must run first,
// which is why we use a dynamic import below.)
if (!process.env.QVAC_WORKER_PATH) {
  process.env.QVAC_WORKER_PATH = path.resolve(
    __dirname,
    "..",
    "qvac",
    "worker.entry.mjs",
  )
}

const { loadModel, completion, unloadModel, close, QWEN3_1_7B_INST_Q4 } =
  await import("@qvac/sdk")

let modelId = null
let loading = null

const adapterActive = Boolean(LORA_ADAPTER && fs.existsSync(LORA_ADAPTER))
export const MODEL_LABEL = adapterActive
  ? `qwen3-1.7b+lora(${path.basename(LORA_ADAPTER)})`
  : "qwen3-1.7b"

/**
 * Qwen3 supports a `/no_think` soft switch in the prompt that suppresses its
 * <think> reasoning block. We append it to the latest user turn so the tutor
 * answers directly. (reasoning_budget:0 alone is not honored by this GGUF build.)
 */
function withNoThink(messages) {
  const history = messages.map((m) => ({ role: m.role, content: m.content }))
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      if (!/\/no_think\b/.test(history[i].content)) {
        history[i] = {
          ...history[i],
          content: `${history[i].content} /no_think`,
        }
      }
      break
    }
  }
  return history
}

/**
 * Load the Qwen3-1.7B Q4 model (idempotent; concurrent callers share one load).
 * First run downloads ~1GB from the registry into ~/.qvac/models.
 */
export async function ensureModel({ ctxSize = 4096 } = {}) {
  if (modelId) return modelId
  if (loading) return loading

  loading = (async () => {
    const t0 = Date.now()
    const modelConfig = { ctx_size: ctxSize }
    if (LORA_ADAPTER) {
      if (fs.existsSync(LORA_ADAPTER)) {
        modelConfig.lora = LORA_ADAPTER
        console.log(`[engine] Applying LoRA adapter: ${LORA_ADAPTER}`)
      } else {
        console.warn(
          `[engine] HIRAIA_LORA_ADAPTER set but file not found: ${LORA_ADAPTER} (using base model)`,
        )
      }
    }
    console.log("[engine] Loading Qwen3-1.7B Q4 (first run downloads ~1GB)...")
    modelId = await loadModel({
      modelSrc: QWEN3_1_7B_INST_Q4,
      modelConfig,
    })
    console.log(
      `[engine] Model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (id=${modelId})`,
    )
    return modelId
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

// Length of the longest suffix of `buf` that is a prefix of `tag`. Used to hold
// back a partial tag that may be split across streamed token boundaries.
function partialSuffixLen(buf, tag) {
  const max = Math.min(buf.length, tag.length - 1)
  for (let k = max; k > 0; k--) {
    if (buf.slice(buf.length - k) === tag.slice(0, k)) return k
  }
  return 0
}

/**
 * Streaming filter that removes `<think>...</think>` spans from a token stream,
 * even when the tags are split across chunks. With `/no_think` the block is
 * empty, but this also handles a non-empty block defensively.
 */
async function* stripThink(source) {
  const OPEN = "<think>"
  const CLOSE = "</think>"
  let buf = ""
  let inThink = false

  for await (const chunk of source) {
    buf += chunk
    let out = ""
    while (true) {
      if (!inThink) {
        const i = buf.indexOf(OPEN)
        if (i !== -1) {
          out += buf.slice(0, i)
          buf = buf.slice(i + OPEN.length)
          inThink = true
          continue
        }
        const hold = partialSuffixLen(buf, OPEN)
        out += buf.slice(0, buf.length - hold)
        buf = buf.slice(buf.length - hold)
        break
      } else {
        const j = buf.indexOf(CLOSE)
        if (j !== -1) {
          buf = buf.slice(j + CLOSE.length)
          inThink = false
          continue
        }
        const hold = partialSuffixLen(buf, CLOSE)
        buf = buf.slice(buf.length - hold)
        break
      }
    }
    if (out) yield out
  }
  if (!inThink && buf) yield buf
}

/**
 * Stream a chat completion as plain text tokens (thinking suppressed/stripped).
 * @param {{role: string, content: string}[]} messages
 * @param {{temperature?: number, maxTokens?: number}} [opts]
 * @returns {AsyncGenerator<string>}
 */
export async function* chat(messages, opts = {}) {
  const id = await ensureModel()
  const { temperature = 0.7, maxTokens = 2048 } = opts

  const run = completion({
    modelId: id,
    history: withNoThink(messages),
    stream: true,
    // Disable Qwen3's <think> reasoning channel for this request.
    reasoning_budget: 0,
    temperature,
    max_tokens: maxTokens,
  })

  // Forward only content tokens (ignore any thinkingDelta/tool events).
  const rawTokens = (async function* () {
    for await (const event of run.events) {
      if (event.type === "contentDelta" && event.text) {
        yield event.text
      }
    }
  })()

  // Strip the (empty) <think> wrapper and trim leading whitespace before the
  // first real token so the answer starts cleanly.
  let started = false
  for await (let piece of stripThink(rawTokens)) {
    if (!started) {
      piece = piece.replace(/^\s+/, "")
      if (!piece) continue
      started = true
    }
    yield piece
  }
}

export async function shutdown() {
  try {
    if (modelId) await unloadModel({ modelId })
  } catch (err) {
    console.error("[engine] unloadModel error:", err)
  } finally {
    modelId = null
  }
  try {
    await close()
  } catch (err) {
    console.error("[engine] close error:", err)
  }
}
