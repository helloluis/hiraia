import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Landing-page feedback form (the breaker band's modal).
 *
 * WRITE-ONLY, no accounts. `name`/`contact` are contact details the visitor volunteered
 * so we can reply — see the `feedback` table doctrine in lib/db.ts. The body is stored
 * raw (visitors may type basic markup like asterisk-bold); it is never rendered as HTML.
 *
 * Bot rejection is layered and deliberately quiet:
 *   1. Honeypot — the form ships a hidden `website` field; anything in it is a bot.
 *   2. Dwell time — the client reports ms since the modal opened; < 4s is a bot.
 *   Both trips return the SAME generic success body as a real submission and store
 *   nothing, so scripts get no signal to iterate against.
 *   3. Hard length caps (below) bound every stored column.
 *   4. Per-IP rate limit, 5/hour. In-memory is fine here on purpose: production runs a
 *      single pm2 fork, so one process sees all traffic; a restart forgiving the counts
 *      is acceptable for a feedback form.
 *
 * After the row is stored we email it via the Resend REST API (text-only body — plain
 * text sidesteps HTML injection entirely). Email failure must NOT fail the request:
 * the row is already durable, so we just log. With RESEND_API_KEY unset (dev) the
 * email step is skipped silently.
 */

const MAX_NAME = 120;
const MAX_CONTACT = 200;
const MIN_FEEDBACK = 3;
const MAX_FEEDBACK = 5000;
const MIN_DWELL_MS = 4000;

const RATE_LIMIT = 5; // submissions per IP…
const RATE_WINDOW_MS = 60 * 60 * 1000; // …per hour

// ip → timestamps of attempts inside the window (see doctrine above on why in-memory
// is acceptable). Per-IP arrays are pruned on each hit, and the whole map is swept once
// it grows past plausibility — per-IP pruning alone never evicts dead KEYS, so a botnet
// rotating source IPs (or just long uptime) would otherwise grow the map forever.
const hits = new Map<string, number[]>();
const SWEEP_AT = 1000; // > 1000 distinct IPs inside an hour on a feedback form = attack

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > SWEEP_AT) {
    for (const [key, ts] of hits) {
      const live = ts.filter((t) => now - t < RATE_WINDOW_MS);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

/** The one success shape. Bots and humans must be indistinguishable, so there is exactly one. */
const genericSuccess = () => NextResponse.json({ ok: true });

/**
 * Single-line fields (name/contact) end up in an email subject line — strip control
 * characters (incl. CR/LF) so a crafted name can never smuggle extra header lines or
 * terminal escapes anywhere downstream. Length caps are checked separately.
 */
const singleLine = (s: string) =>
  s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

async function sendEmail(row: { id: number; name: string; contact: string; body: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // dev mode — row is stored, no email
  const to = process.env.FEEDBACK_TO;
  if (!to) {
    // Misconfiguration (key set, recipient not): don't burn a guaranteed Resend 4xx per
    // submission — the row is stored either way, so log once per attempt and move on.
    console.error(`[feedback] FEEDBACK_TO unset — email skipped for row ${row.id}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hiraia <onboarding@resend.dev>',
        to,
        subject: `Hiraia feedback from ${row.name}`,
        text: [
          `Name: ${row.name}`,
          `Contact: ${row.contact}`,
          '',
          row.body,
          '',
          `(feedback row #${row.id})`,
        ].join('\n'),
      }),
    });
    if (!res.ok) {
      console.error(`[feedback] Resend responded ${res.status} for row ${row.id}`);
    }
  } catch (err) {
    console.error(`[feedback] email send failed for row ${row.id}:`, err);
  }
}

// POST /api/feedback — validate, store, then email (best-effort).
export async function POST(req: NextRequest) {
  // `?? {}` matters: a body of literal `null` PARSES fine (no catch), and destructuring
  // null throws — without the guard `curl -d 'null'` was an unhandled 500.
  const { name, contact, feedback, website, elapsedMs } = (await req.json().catch(() => ({}))) ?? {};

  // Take the LAST x-forwarded-for hop: our reverse proxy appends the real client IP, so
  // earlier entries are client-supplied and spoofable — keying the limiter on the FIRST
  // hop would let a bot rotate fake IPs in the header and never hit the limit.
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',').pop()?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many submissions — please try again later.' }, { status: 429 });
  }

  // Bot trips: pretend it worked, store nothing (never teach the bot).
  if (typeof website === 'string' && website.length > 0) return genericSuccess();
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < MIN_DWELL_MS) {
    return genericSuccess();
  }

  // Real validation errors DO get told apart — a human with a too-long paste deserves an error.
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) {
    return NextResponse.json({ error: 'Please give a name (up to 120 characters).' }, { status: 400 });
  }
  if (typeof contact !== 'string' || !contact.trim() || contact.length > MAX_CONTACT) {
    return NextResponse.json({ error: 'Please give a contact (up to 200 characters).' }, { status: 400 });
  }
  if (typeof feedback !== 'string' || feedback.trim().length < MIN_FEEDBACK || feedback.length > MAX_FEEDBACK) {
    return NextResponse.json(
      { error: `Feedback must be ${MIN_FEEDBACK}–${MAX_FEEDBACK} characters.` },
      { status: 400 }
    );
  }

  const cleanName = singleLine(name);
  const cleanContact = singleLine(contact);
  if (!cleanName || !cleanContact) {
    // A name/contact made ENTIRELY of control chars survives trim() but sanitizes away.
    return NextResponse.json({ error: 'Please give a name and a contact.' }, { status: 400 });
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;
  const info = getDb()
    .prepare('INSERT INTO feedback (name, contact, body, user_agent) VALUES (?, ?, ?, ?)')
    .run(cleanName, cleanContact, feedback, userAgent);

  // Fire-and-forget on purpose: awaiting the Resend roundtrip would make real
  // submissions measurably SLOWER than the instant honeypot/dwell fake-successes — a
  // timing oracle that undoes the identical response bodies. The single long-lived pm2
  // fork keeps the process alive, so the detached promise always completes (or logs).
  void sendEmail({
    id: Number(info.lastInsertRowid),
    name: cleanName,
    contact: cleanContact,
    body: feedback,
  });

  return genericSuccess();
}
