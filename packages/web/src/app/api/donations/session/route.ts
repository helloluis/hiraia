import { NextResponse, type NextRequest } from 'next/server';
import { checkSession, createSession } from '@/server/donations';

// POST /api/donations/session — only called when a donor CHOOSES to leave an email. Stores it
// privately and returns a random reference; the checkout carries only that reference.
export const runtime = 'nodejs';
const MAX_BYTES = 2048;
const WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; expires: number }>();
function rateLimited(ip: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const entry = attempts.get(ip) ?? { count: 0, expires: now + WINDOW_MS };
  if (entry.count >= 20) return true;
  if (attempts.size >= 10000 && !attempts.has(ip)) return true;
  entry.count++;
  attempts.set(ip, entry);
  return false;
}
const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host')) return reply({ error: 'Please donate from the Hiraia website.' }, 403);
    } catch {
      return reply({ error: 'Invalid request origin.' }, 403);
    }
  }
  // nginx appends the real client address; preceding forwarded hops are untrusted.
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',').pop()?.trim() || 'unknown';
  if (rateLimited(ip)) return reply({ error: 'Too many attempts. Please try again later, or leave the email blank.' }, 429);
  if (req.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return reply({ error: 'Send JSON.' }, 415);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ error: 'Request too large.' }, 413);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply({ error: 'Please try again.' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: 'Please try again.' }, 400);
  const checked = checkSession(input as Record<string, unknown>);
  if (!checked.ok) return reply({ error: checked.error }, 400);
  try {
    return reply({ ref: createSession(checked.value) });
  } catch {
    console.error('[donations] Could not store donation session');
    return reply({ error: 'We could not save your email right now.' }, 503);
  }
}
