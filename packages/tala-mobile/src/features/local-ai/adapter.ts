import type { Engine, Completion, Memory } from './types';
export function engineAdapter(deps: {
  create(): Engine;
  verifiedPath(): Promise<string>;
  memory(): Promise<Memory>;
  now(): number;
}) {
  let engine: Engine | null = null;
  let loading: Promise<void> | null = null;
  let running = false;
  let closing = false;
  let epoch = 0;
  async function start() {
    if (closing) throw Error('localAiBusy');
    if (loading) return loading;
    if (engine) return;
    const current = epoch;
    loading = (async () => {
      const mem = await deps.memory();
      if (mem.lowRam || mem.lowMemory || mem.availableBytes < 1500 * 1048576)
        throw Error('localAiMemory');
      const path = await deps.verifiedPath();
      const candidate = deps.create();
      try {
        await candidate.start(path);
        if (current !== epoch) throw Error('localAiCancelled');
        engine = candidate;
      } catch (e) {
        await candidate.close().catch(() => {});
        throw e;
      }
    })().finally(() => {
      loading = null;
    });
    return loading;
  }
  return {
    start,
    isLoaded: () => !!engine,
    async complete(prompt: string, onToken: (token: string) => void): Promise<Completion> {
      if (running || closing) throw Error('localAiBusy');
      if (prompt.length > 4000) throw Error('localAiTooLong');
      running = true;
      try {
        await start();
        const begun = deps.now();
        let peak = (await deps.memory()).pssBytes;
        const poll = setInterval(() => {
          void deps
            .memory()
            .then((m) => {
              peak = Math.max(peak, m.pssBytes);
            })
            .catch(() => {});
        }, 500);
        try {
          const result = await engine!.complete(prompt, onToken);
          const after = await deps.memory();
          peak = Math.max(peak, after.pssBytes, after.peakPssBytes);
          return { ...result, elapsedMs: deps.now() - begun, peakPssBytes: peak };
        } finally {
          clearInterval(poll);
        }
      } finally {
        running = false;
      }
    },
    cancel: async () => {
      epoch++;
      await engine?.cancel();
    },
    async close() {
      closing = true;
      epoch++;
      try {
        await engine?.cancel();
        await loading?.catch(() => {});
        await engine?.close();
        engine = null;
      } finally {
        closing = false;
      }
    },
  };
}
