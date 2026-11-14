import type { Engine } from './types';
/** Nothing loads/starts QVAC until start() is explicitly called. No remote model URLs. */
export function createNativeEngine(): Engine {
  let sdk: typeof import('@qvac/sdk') | null = null;
  let modelId: string | null = null;
  let requestId: string | null = null;
  return {
    async start(path) {
      sdk = await import('@qvac/sdk');
      modelId = await sdk.loadModel({
        modelSrc: path.replace(/^file:\/\//, ''),
        modelType: 'llm',
        modelConfig: { ctx_size: 2048, gpu_layers: 0, device: 'cpu' },
      });
    },
    async complete(prompt, onToken) {
      if (!sdk || !modelId) throw Error('localAiNotReady');
      requestId = `tala-local-${Date.now()}`;
      const run = sdk.completion({
        modelId,
        requestId,
        history: [{ role: 'user', content: prompt + '\n/no_think' }],
        stream: true,
        generationParams: { predict: 384, temp: 0 },
      });
      for await (const event of run.events) if (event.type === 'contentDelta') onToken(event.text);
      const final = await run.final;
      requestId = null;
      return {
        text: final.contentText,
        tokens: final.stats?.generatedTokens ?? null,
        tokensPerSecond: final.stats?.tokensPerSecond ?? null,
      };
    },
    async cancel() {
      if (sdk && requestId) await sdk.cancel({ requestId });
    },
    async close() {
      if (sdk && requestId) await sdk.cancel({ requestId }).catch(() => {});
      if (sdk && modelId) await sdk.unloadModel({ modelId, clearStorage: false }).catch(() => {});
      modelId = null;
      requestId = null;
      if (sdk) await sdk.close();
      sdk = null;
    },
  };
}
