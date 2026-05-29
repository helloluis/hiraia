// Hiraia inference sidecar — OpenAI-compatible HTTP server backed by QVAC.
//
// Endpoints:
//   GET  /health                 -> { status, model, ready }
//   POST /v1/chat/completions     -> SSE stream of OpenAI-style chunks
//
// The Next.js web app's RemoteEngine talks to this over HTTP/SSE, exactly as it
// did with the previous server — so no web code changes are required.

import http from "node:http"
import { chat, ensureModel, shutdown, MODEL_LABEL } from "./qvac-engine.mjs"

const PORT = Number(process.env.PORT || 8080)
const HOST = process.env.HOST || "127.0.0.1"

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (c) => {
      raw += c
      if (raw.length > 5_000_000) reject(new Error("Request body too large"))
    })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

function sseChunk(content) {
  const payload = {
    object: "chat.completion.chunk",
    model: MODEL_LABEL,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function handleChatCompletions(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Invalid JSON body" }))
    return
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "messages[] is required" }))
    return
  }

  // The active adapter (if any) is selected at sidecar startup via
  // HIRAIA_LORA_ADAPTER and baked into the loaded model. A per-request
  // lora_adapter hint is logged for visibility but doesn't hot-swap adapters.
  if (body.lora_adapter) {
    console.log(`[server] lora_adapter="${body.lora_adapter}" requested (active model: ${MODEL_LABEL})`)
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })

  const opts = {
    temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : 2048,
  }

  let tokens = 0
  const t0 = Date.now()
  try {
    for await (const token of chat(messages, opts)) {
      tokens++
      res.write(sseChunk(token))
    }
    res.write("data: [DONE]\n\n")
    res.end()
    console.log(
      `[server] completion ok: ${tokens} tokens in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
  } catch (err) {
    console.error("[server] completion error:", err)
    // If headers already sent, surface the error inside the stream.
    res.write(
      `data: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`,
    )
    res.write("data: [DONE]\n\n")
    res.end()
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res)

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({ status: "ok", model: MODEL_LABEL, ready: true }),
    )
    return
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    await handleChatCompletions(req, res)
    return
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, HOST, async () => {
  console.log(`[server] Hiraia QVAC sidecar listening on http://${HOST}:${PORT}`)
  console.log("[server] Warming up model (downloads on first run)...")
  try {
    await ensureModel()
    console.log("[server] Ready.")
  } catch (err) {
    console.error("[server] Model warmup failed:", err)
  }
})

async function gracefulExit() {
  console.log("\n[server] Shutting down...")
  server.close()
  await shutdown()
  process.exit(0)
}
process.on("SIGINT", gracefulExit)
process.on("SIGTERM", gracefulExit)
