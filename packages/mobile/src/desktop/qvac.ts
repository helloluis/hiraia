import { desktop } from './bridge';
export const QWEN3_1_7B_INST_Q4 = 'unsupported-placeholder-model';
type LoadOptions = {
  modelSrc: unknown; modelType?: string; modelConfig?: object;
  onProgress?: (progress: { percentage?: number }) => void;
};
export async function loadModel({ onProgress, ...options }: LoadOptions): Promise<string> {
  const id = crypto.randomUUID();
  const off = desktop().subscribe('qvac-progress', event => { if (event.id === id) onProgress?.(event.progress); });
  try { return await desktop().invoke('qvac.load', id, options); } finally { off(); }
}
export const unloadModel = (options: any) => desktop().invoke('qvac.unload', options);
export const embed = (options: any) => desktop().invoke('qvac.embed', options);
export const cancel = ({ requestId }: { requestId: string }) => desktop().invoke('qvac.cancel', requestId);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Consumers commonly only use events; unused stats must not create an unhandled rejection.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
export function completion(options: any) {
  const requestId = crypto.randomUUID();
  const queue: any[] = [];
  let done = false;
  let error: Error | undefined;
  let wake: (() => void) | undefined;
  const stats = deferred<any>();
  const final = deferred<any>();
  const fail = (reason: Error) => {
    error = reason; done = true; stats.reject(reason); final.reject(reason); off(); wake?.();
  };
  const off = desktop().subscribe('qvac-stream', value => {
    if (value.id !== requestId) return;
    if (value.error) { fail(new Error(value.error)); return; }
    if (value.event) queue.push(value.event);
    if (value.done) { done = true; stats.resolve(value.stats); final.resolve(value.final); off(); }
    wake?.();
  });
  void desktop().invoke('qvac.complete', requestId, options).catch(fail);
  const events = {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          while (queue.length) yield queue.shift();
          if (error) throw error;
          if (done) return;
          await new Promise<void>(resolve => { wake = resolve; });
        }
      } finally { off(); if (!done) void cancel({ requestId }); }
    },
  };
  return { requestId, events, stats: stats.promise, final: final.promise };
}
