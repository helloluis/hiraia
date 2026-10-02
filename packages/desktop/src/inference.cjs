'use strict';
const path = require('node:path');

function createInference(storage, emit) {
  let sdkPromise;
  const sdk = () => sdkPromise ??= import('@qvac/sdk');
  const runs = new Map();
  const cancelled = new Set();
  const voices = new Map();
  const models = new Set();
  const validateId = id => { if (!models.has(id)) throw new Error('Unknown loaded model'); };
  const handlers = {
    async 'qvac.load'(id, options) {
      if (!options || !['llm', 'llamacpp-embedding'].includes(options.modelType)) throw new Error('Unsupported model type');
      if (typeof options.modelSrc !== 'string') throw new Error('Only installed models can be loaded');
      const file = storage.resolve(options.modelSrc);
      if (!file.endsWith('.gguf')) throw new Error('Expected a local GGUF model');
      const api = await sdk();
      const modelId = await api.loadModel({ ...options, modelSrc: file,
        modelConfig: { ...options.modelConfig, ...(process.platform === 'win32' && options.modelType === 'llm' ? { gpu_layers: 0, device: 'cpu' } : {}) },
        onProgress: progress => emit('qvac-progress', { id, progress }) });
      models.add(modelId);
      return modelId;
    },
    async 'qvac.unload'(options) { validateId(options.modelId); await (await sdk()).unloadModel(options); models.delete(options.modelId); },
    async 'qvac.embed'(options) {
      validateId(options.modelId);
      if (typeof options.text !== 'string' || options.text.length > 16000) throw new Error('Invalid embedding request');
      return (await sdk()).embed(options);
    },
    async 'qvac.complete'(id, options) {
      validateId(options.modelId);
      if (!Array.isArray(options.history) || JSON.stringify(options.history).length > 64000) throw new Error('Invalid completion request');
      const api = await sdk();
      const run = api.completion({ ...options, stream: true,
        generationParams: { ...options.generationParams, predict: Math.min(512, Math.max(1, options.generationParams?.predict ?? 256)) } });
      runs.set(id, run.requestId);
      if (cancelled.delete(id)) await api.cancel({ requestId: run.requestId });
      try {
        for await (const event of run.events) emit('qvac-stream', { id, event });
        const stats = await run.stats.catch(() => null);
        const final = await run.final.catch(() => null);
        emit('qvac-stream', { id, done: true, stats, final });
      } catch (error) { emit('qvac-stream', { id, error: String(error.message ?? error) }); throw error; }
      finally { runs.delete(id); cancelled.delete(id); }
    },
    async 'qvac.cancel'(id) {
      const requestId = runs.get(id);
      if (requestId) await (await sdk()).cancel({ requestId });
      else if (cancelled.size < 128) cancelled.add(id);
    },
    async 'voice.open'(uri) {
      const file = storage.resolve(uri);
      // Shared voice storage now uses content-addressed names; retain the legacy
      // names for existing installations and packaged voice validation.
      if (!/^(?:en|tl|voice-(?:en|tl)-[a-f0-9]{16})\.onnx$/.test(path.basename(file))) throw new Error('Unknown voice');
      if (!voices.has(file)) {
        const ort = require('onnxruntime-node');
        const opening = ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 2 });
        voices.set(file, opening);
        opening.catch(() => voices.delete(file));
      }
      const session = await voices.get(file);
      return { id: file, outputNames: session.outputNames };
    },
    async 'voice.run'(id, values) {
      if (!voices.has(id)) throw new Error('Voice is not loaded');
      const ort = require('onnxruntime-node');
      const tensors = {};
      for (const name of ['input_ids', 'attention_mask']) {
        const value = values[name];
        if (!value || value.type !== 'int64' || !Array.isArray(value.data) || value.data.length < 1 || value.data.length > 4096) throw new Error('Invalid voice tokens');
        tensors[name] = new ort.Tensor('int64', BigInt64Array.from(value.data, BigInt), [1, value.data.length]);
      }
      const output = await (await voices.get(id)).run(tensors);
      return Object.fromEntries(Object.entries(output).map(([name, tensor]) => [name, { type: tensor.type, dims: tensor.dims, data: new Float32Array(tensor.data) }]));
    },
    async 'voice.release'(id) {
      const opening = voices.get(id);
      if (!opening) return;
      voices.delete(id);
      await (await opening).release();
    },
  };
  return { handlers, async close() {
    if (sdkPromise) await (await sdkPromise).close();
    for (const promise of voices.values()) { try { await (await promise).release(); } catch {} }
    voices.clear();
  } };
}
module.exports = { createInference };
