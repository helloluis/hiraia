import { desktop } from '../desktop/bridge';
export const telemetryRequest: typeof fetch = async (url, init) => {
  const id = crypto.randomUUID();
  const signal = init?.signal;
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const cancel = () => { void desktop().invoke('telemetry.cancel', id); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await desktop().invoke('telemetry.send', id, String(url), init?.body);
    return new Response(response.body, { status: response.status, headers: response.headers });
  } finally { signal?.removeEventListener('abort', cancel); }
};
