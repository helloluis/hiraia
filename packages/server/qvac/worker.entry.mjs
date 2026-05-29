// Custom QVAC Bare worker entry: registers ONLY the LLM plugin.
//
// The default SDK worker (worker.js) eagerly registers every built-in plugin
// (whisper, parakeet, nmt, tts, ocr, diffusion, ...), which forces loading each
// native .bare addon at worker startup. On Windows some of those addon paths
// exceed MAX_PATH (260) under pnpm's deeply-nested layout and fail to load.
//
// For an LLM tutor we only need llama.cpp completion, so we register just that.
// The SDK is pointed here via the QVAC_WORKER_PATH environment variable.
import { initializeWorkerCore, ensureRPCSetup } from "@qvac/sdk/worker-core"
import { registerPlugin } from "@qvac/sdk/plugins"
import { llmPlugin } from "@qvac/sdk/llamacpp-completion/plugin"

const { hasRPCConfig } = initializeWorkerCore()

registerPlugin(llmPlugin)

if (hasRPCConfig) {
  ensureRPCSetup()
}
