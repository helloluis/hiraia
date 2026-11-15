import { NextResponse, type NextRequest } from 'next/server';
import { notifyDonation, recordPayment, verifySignature } from '@/server/donations';

// POST /api/donations/webhook — thirdweb Bridge webhook (Dashboard → Bridge → Webhooks). Signed with
// THIRDWEB_WEBHOOK_SECRET; unsigned or misconfigured requests are refused, never processed.
export const runtime = 'nodejs';
const MAX_BYTES = 64 * 1024;
const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const secret = process.env.THIRDWEB_WEBHOOK_SECRET;
  if (!secret) return reply({ error: 'webhook not configured' }, 503);
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return reply({ error: 'too large' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ error: 'too large' }, 413);
  const problem = verifySignature(raw, req.headers, secret);
  if (problem) return reply({ error: problem }, 401);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: 'invalid JSON' }, 400);
  }
  let outcome;
  try {
    outcome = recordPayment(body);
  } catch {
    console.error('[donations] Could not record webhook payment');
    return reply({ error: 'storage unavailable' }, 503); // thirdweb retries non-2xx
  }
  if (outcome.kind === 'recorded') {
    // Answer thirdweb at once; the alert goes out after (status lands in donations.notified).
    const { paymentId, matched } = outcome;
    void notifyDonation(paymentId).then(
      (delivered) => console.log(`[donations] payment recorded (${matched ? 'with email' : 'anonymous'}), notify=${delivered}`),
      () => console.error('[donations] notification crashed'),
    );
  }
  return reply({ ok: true, outcome: outcome.kind });
}
