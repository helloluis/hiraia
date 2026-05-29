// QVAC LoRA fine-tuning runner for Hiraia.
//
// Uses QVAC's native finetune() API (the same llama.cpp engine that powers
// inference) to train a GGUF LoRA adapter on a chat-formatted JSONL dataset.
// Output adapters drop straight into the sidecar / mobile app via
// modelConfig.lora -- no safetensors -> GGUF conversion step.
//
// Runs in the packages/server env on purpose: it has the win32 bare runtime,
// the co-located OpenSSL DLLs, and the LLM-only Bare worker, so training reuses
// the exact native setup we already proved works for inference.
//
// Usage:
//   node src/train.mjs --lang tagalog --dataset <path.jsonl> --out <dir> \
//       [--epochs 3] [--device gpu|cpu] [--ctx 2048] [--lora-rank 16] \
//       [--lora-alpha 32] [--lr 1e-4] [--quick]
//
// --quick: 1 epoch, no validation split -- a fast smoke test that the training
//          path runs end-to-end on this machine and emits a .gguf adapter.

import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..")

// Point QVAC at our LLM-only Bare worker BEFORE the SDK is imported. The
// default worker eagerly loads every plugin (whisper/tts/ocr), whose deep
// pnpm paths blow past Windows MAX_PATH; the LLM worker registers only the
// llama.cpp plugin, which is the one that owns finetune().
if (!process.env.QVAC_WORKER_PATH) {
  process.env.QVAC_WORKER_PATH = path.resolve(
    __dirname,
    "..",
    "qvac",
    "worker.entry.mjs",
  )
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok.startsWith("--")) continue
    const key = tok.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function resolveDataset(lang, explicit) {
  if (explicit) return path.resolve(explicit)
  // Default to the language's science-chat dataset under finetuning/.
  return path.join(
    REPO_ROOT,
    "finetuning",
    "datasets",
    lang,
    "science-chat.jsonl",
  )
}

async function main() {
  const args = parseArgs(process.argv)
  const lang = args.lang ?? "tagalog"
  const quick = Boolean(args.quick)

  const dataset = resolveDataset(lang, args.dataset)
  const outDir = path.resolve(
    args.out ??
      path.join(
        REPO_ROOT,
        "finetuning",
        "output",
        quick ? `${lang}-validation` : lang,
      ),
  )
  const checkpointDir = path.join(outDir, "checkpoints")

  const device = args.device ?? "gpu"
  const ctxSize = Number(args.ctx ?? 2048)
  const epochs = Number(args.epochs ?? (quick ? 1 : 3))
  const loraRank = Number(args["lora-rank"] ?? 16)
  const loraAlpha = Number(args["lora-alpha"] ?? 32)
  const learningRate = Number(args.lr ?? 1e-4)
  // QVAC/llama.cpp batch + micro-batch are TOKEN counts (the -b / -ub CLI
  // flags), not sequence counts. They must be >= ~128; tiny values make the
  // trainer crawl one token at a time and trip the AdamW alpha assert.
  const batchSize = Number(args.batch ?? 512)
  const microBatchSize = Number(args["micro-batch"] ?? 128)
  // LR schedule. The default cosine schedule anneals lr toward lrMin; if lrMin
  // is 0 the final step's AdamW alpha hits exactly 0 and llama.cpp asserts
  // (GGML_ASSERT(opt_pars.adamw.alpha > 0.0f)). Keep lrMin > 0 to avoid that.
  // This mirrors QVAC's recommended cosine + warmup + lrMin recipe.
  const lrScheduler = args.scheduler ?? "cosine"
  const lrMin = Number(args["lr-min"] ?? 1e-8)
  const warmupRatio = Number(args.warmup ?? 0.1)

  if (!fs.existsSync(dataset)) {
    console.error(`[train] Dataset not found: ${dataset}`)
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })

  const datasetLines = fs
    .readFileSync(dataset, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0).length

  console.log("[train] QVAC LoRA fine-tune")
  console.log(`        language : ${lang}`)
  console.log(`        dataset  : ${dataset} (${datasetLines} examples)`)
  console.log(`        output   : ${outDir}`)
  console.log(`        device   : ${device}`)
  console.log(`        epochs   : ${epochs}`)
  console.log(`        ctx/lora : ctx=${ctxSize} rank=${loraRank} alpha=${loraAlpha} lr=${learningRate}`)
  console.log(`        batch    : batch=${batchSize} micro=${microBatchSize} (tokens)`)
  console.log(`        schedule : ${lrScheduler} lrMin=${lrMin} warmup=${warmupRatio}`)
  console.log(`        mode     : ${quick ? "QUICK (validation smoke test)" : "full"}\n`)

  const { loadModel, finetune, unloadModel, close, QWEN3_1_7B_INST_Q4 } =
    await import("@qvac/sdk")

  let modelId
  try {
    const t0 = Date.now()
    console.log("[train] Loading Qwen3-1.7B Q4 base model...")
    modelId = await loadModel({
      modelSrc: QWEN3_1_7B_INST_Q4,
      modelType: "llm",
      modelConfig: { device, ctx_size: ctxSize },
    })
    console.log(
      `[train] Model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (id=${modelId})\n`,
    )

    const options = {
      trainDatasetDir: dataset,
      validation: quick ? { type: "none" } : { type: "split", fraction: 0.1 },
      outputParametersDir: outDir,
      numberOfEpochs: epochs,
      learningRate,
      lrScheduler,
      lrMin,
      warmupRatio,
      contextLength: ctxSize,
      batchSize,
      microBatchSize,
      assistantLossOnly: true,
      loraRank,
      loraAlpha,
      loraModules: "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down",
      checkpointSaveDir: checkpointDir,
      checkpointSaveSteps: 50,
    }

    console.log("[train] Starting finetune()...\n")
    const tTrain = Date.now()
    const handle = finetune({ modelId, options })

    let lastLogged = -1
    for await (const p of handle.progressStream) {
      // Throttle logging to once per step transition.
      if (p.global_steps === lastLogged) continue
      lastLogged = p.global_steps
      const loss = typeof p.loss === "number" ? p.loss.toFixed(4) : "—"
      const acc =
        typeof p.accuracy === "number"
          ? `${(p.accuracy * 100).toFixed(1)}%`
          : "—"
      const etaMin = p.eta_ms ? `${Math.ceil(p.eta_ms / 60000)}m` : "—"
      console.log(
        `[train] step ${p.global_steps} | epoch ${p.current_epoch} | ` +
          `batch ${p.current_batch}/${p.total_batches} | ` +
          `${p.is_train ? "loss" : "val_loss"} ${loss} | acc ${acc} | eta ${etaMin}`,
      )
    }

    const result = await handle.result
    const mins = ((Date.now() - tTrain) / 60000).toFixed(1)
    console.log(`\n[train] Finetune finished in ${mins}m`)
    console.log(`        status   : ${result.status}`)
    if (result.stats) {
      console.log(`        train_loss: ${result.stats.train_loss ?? "N/A"}`)
      console.log(`        val_loss  : ${result.stats.val_loss ?? "N/A"}`)
    }

    const adapters = fs
      .readdirSync(outDir)
      .filter((f) => f.toLowerCase().endsWith(".gguf"))
      .map((f) => path.join(outDir, f))
    if (adapters.length) {
      console.log("\n[train] GGUF adapter(s) written:")
      for (const a of adapters) {
        const sizeMb = (fs.statSync(a).size / (1024 * 1024)).toFixed(1)
        console.log(`        ${a} (${sizeMb} MB)`)
      }
    } else {
      console.warn(
        `\n[train] WARNING: no .gguf adapter found in ${outDir}. ` +
          `Check the output above for the adapter filename / errors.`,
      )
    }
  } catch (err) {
    console.error("\n[train] Training failed:", err?.stack || err)
    process.exitCode = 1
  } finally {
    try {
      if (modelId) await unloadModel({ modelId })
    } catch {}
    try {
      await close()
    } catch {}
  }
}

main()
