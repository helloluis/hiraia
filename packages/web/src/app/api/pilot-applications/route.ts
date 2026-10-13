import { NextResponse, type NextRequest } from 'next/server';
import { validatePilotApplication } from '@/lib/pilot-application';
import { notifyPilotApplication, savePilotApplication } from '@/server/pilot-applications';

export const runtime = 'nodejs';
const MAX_BYTES = 32 * 1024;
const WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; expires: number }>();
function rateLimited(ip: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const entry = attempts.get(ip) ?? { count: 0, expires: now + WINDOW_MS };
  if (entry.count >= 10) return true;
  if (attempts.size >= 10000 && !attempts.has(ip)) return true;
  entry.count++;
  attempts.set(ip, entry);
  return false;
}
const reply = (body: object, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host'))
        return reply({ error: 'Please submit the form from the Hiraia website.' }, 403);
    } catch {
      return reply({ error: 'Invalid request origin.' }, 403);
    }
  }
  // nginx appends the real client address; preceding forwarded hops are untrusted.
  const ip =
    (req.headers.get('x-forwarded-for') ?? 'unknown').split(',').pop()?.trim() || 'unknown';
  if (rateLimited(ip))
    return reply(
      {
        error:
          'Too many attempts. Please try again in an hour; your entries are still on this page.',
      },
      429,
      { 'Retry-After': '3600' }
    );
  if (req.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    return reply({ error: 'Send the application as JSON.' }, 415);
  if (Number(req.headers.get('content-length')) > MAX_BYTES)
    return reply({ error: 'The application is too long.' }, 413);
  const reader = req.body?.getReader();
  if (!reader) return reply({ error: 'The application is empty.' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let input: Record<string, unknown>;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return reply({ error: 'The application is too long.' }, 413);
      }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return reply({ error: 'Please check the application and try again.' }, 400);
    input = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: 'Please check the application and try again.' }, 400);
  }
  if (typeof input.website !== 'string' || input.website !== '')
    return reply(
      { error: 'We could not accept this submission. Please reload the page and try again.' },
      400
    );
  const requestId = input.requestId;
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  )
    return reply({ error: 'Please reload the page before submitting.' }, 400);
  const result = validatePilotApplication(input);
  if (!result.ok)
    return reply({ error: 'Please check the highlighted fields.', errors: result.errors }, 400);
  let saved;
  try {
    saved = savePilotApplication(requestId, result.value);
  } catch {
    console.error('[pilot-application] Could not store application');
    return reply(
      {
        error: 'We could not save your application. Your entries are still here; please try again.',
      },
      503
    );
  }
  if (saved.conflict)
    return reply(
      {
        error:
          'This submission reference has already been used. Please reload before submitting a different application.',
      },
      409
    );
  if (!saved.duplicate) {
    try {
      await notifyPilotApplication(saved.id, result.value);
    } catch {
      console.error(`[pilot-application] Could not update notification status for #${saved.id}`);
    }
  }
  return reply({ ok: true });
}
