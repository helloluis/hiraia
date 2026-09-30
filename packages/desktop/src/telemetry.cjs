'use strict';
// The renderer gets one existing application endpoint, not a general HTTP proxy.
function createTelemetry() {
  const requests = new Map();
  return { handlers: {
    async 'telemetry.send'(id, url, body) {
      if (url !== 'https://hiraia.org/api/telemetry/batch' || typeof body !== 'string' || Buffer.byteLength(body) > 1024 ** 2 ||
        typeof id !== 'string' || id.length > 80 || requests.has(id) || requests.size >= 4) throw new Error('Invalid telemetry request');
      const controller = new AbortController(); requests.set(id, controller);
      try {
        const response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' },
          redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        const text = await response.text();
        if (text.length > 65536) throw new Error('Oversized telemetry response');
        return { status: response.status, body: text, headers: { 'retry-after': response.headers.get('retry-after') ?? '' } };
      } finally { requests.delete(id); }
    },
    'telemetry.cancel'(id) { requests.get(id)?.abort(); },
  }, close() { for (const request of requests.values()) request.abort(); } };
}
module.exports = { createTelemetry };
