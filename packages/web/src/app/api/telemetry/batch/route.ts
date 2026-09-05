import { createHash } from 'node:crypto';
import { getTelemetry, ingest } from '../../../../lib/telemetry/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY = 100_000;
// Ephemeral abuse guard; nginx supplies an additional shared limit across processes.
const windows = new Map<string, { start: number; count: number }>();
function allowed(key: string) {
  const now = Date.now();
  if (windows.size > 10000) {
    for (const [k, v] of windows) if (now - v.start >= 60000) windows.delete(k);
    if (windows.size > 10000) return false;
  }
  let slot = windows.get(key);
  if (!slot || now - slot.start >= 60000) windows.set(key, (slot = { start: now, count: 0 }));
  return ++slot.count <= 120;
}
export async function POST(request: Request) {
  const reply = (status: number, data: object, extra = {}) =>
    Response.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store', ...extra },
    });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return reply(415, { error: 'json_required' });
  // Trust only the last proxy-appended address, never a caller's first XFF entry.
  const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  if (!allowed(createHash('sha256').update(ip).digest('hex')))
    return reply(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  if (Number(request.headers.get('content-length')) > MAX_BODY)
    return reply(413, { error: 'too_large' });
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: 'empty_body' });
  let body: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return reply(413, { error: 'too_large' });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return reply(400, { error: 'invalid_json' });
  }
  try {
    return reply(200, ingest(getTelemetry(), body));
  } catch (error) {
    if (error instanceof Error && ['invalid_batch', 'invalid_event'].includes(error.message)) {
      return reply(400, { error: error.message });
    }
    return reply(503, { error: 'temporarily_unavailable' }, { 'Retry-After': '60' });
  }
}
