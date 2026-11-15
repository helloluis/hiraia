import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/db';
import { DONATION_ADDRESS, DONATION_CHAINS, validAmount, validEmail } from '@/components/donate/config';
export { validEmail };

/*
 * Crypto donations: optional donor email + confirmed-payment records + Luis's notification.
 * See scripts/README-donations.md. The email never leaves this server except in Luis's own
 * notification; thirdweb only ever sees the random `ref`.
 */

export const SESSION_TTL_DAYS = 7; // unmatched sessions (abandoned checkouts)
export const EMAIL_TTL_DAYS = 180; // emails on confirmed donations, after which the row stays anonymous
export const PURPOSE = 'hiraia-donation';


export function purgeExpired() {
  const db = getDb();
  db.prepare(`DELETE FROM donation_sessions WHERE created_at < datetime('now', ?)`).run(`-${SESSION_TTL_DAYS} days`);
  db.prepare(`UPDATE donations SET email = NULL WHERE email IS NOT NULL AND confirmed_at < datetime('now', ?)`).run(
    `-${EMAIL_TTL_DAYS} days`,
  );
}

export type SessionInput = { email: string; chainId: number; token: string; amount: string };
export type SessionCheck = { ok: true; value: SessionInput } | { ok: false; error: string };

export function checkSession(input: Record<string, unknown>): SessionCheck {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!validEmail(email)) return { ok: false, error: 'Please check the email address.' };
  const chain = DONATION_CHAINS.find((c) => c.id === input.chainId);
  const token = chain?.tokens.find((t) => t.symbol === input.token);
  if (!chain || !token) return { ok: false, error: 'Please pick a network and token on the page.' };
  const amount = typeof input.amount === 'string' ? input.amount.trim() : '';
  if (validAmount(amount, token)) return { ok: false, error: 'Please check the amount.' };
  return { ok: true, value: { email, chainId: chain.id, token: token.symbol, amount } };
}

export function createSession(s: SessionInput) {
  purgeExpired();
  const ref = randomBytes(16).toString('base64url');
  getDb()
    .prepare('INSERT INTO donation_sessions (ref, email, chain_id, token, amount) VALUES (?, ?, ?, ?, ?)')
    .run(ref, s.email, s.chainId, s.token, s.amount);
  return ref;
}

/* ---------------------------------------------------------------- webhook */

/** thirdweb Bridge webhook v2: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as hex, ±300 s. */
export function verifySignature(raw: string, headers: Headers, secret: string, now = Date.now()) {
  const signature = headers.get('x-payload-signature') ?? headers.get('x-pay-signature');
  const timestamp = headers.get('x-timestamp') ?? headers.get('x-pay-timestamp');
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return 'missing signature headers';
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return 'stale timestamp';
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad signature';
  return null;
}

type Token = { address: string; chainId: number; decimals: number; symbol: string };
type Payment = {
  status: string;
  paymentId: string;
  receiver: string;
  destinationToken: Token;
  destinationAmount: string | number;
  transactions: { chainId: number; transactionHash: string }[];
  purchaseData?: Record<string, unknown>;
};

/** Base units → decimal string, e.g. 25000000 with 6 decimals → "25". */
export function units(value: string | number, decimals: number) {
  const v = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${v / base}${frac ? `.${frac}` : ''}`;
}

export type WebhookOutcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'duplicate' }
  | { kind: 'recorded'; paymentId: string; matched: boolean };

export function recordPayment(body: unknown): WebhookOutcome {
  const b = body as { type?: string; version?: number; data?: Payment } | null;
  if (!b || b.type !== 'pay.onchain-transaction' || b.version !== 2 || !b.data) return { kind: 'ignored', reason: 'not an onchain v2 event' };
  const d = b.data;
  if (d.status !== 'COMPLETED') return { kind: 'ignored', reason: `status ${d.status}` };
  if (typeof d.receiver !== 'string' || d.receiver.toLowerCase() !== DONATION_ADDRESS.toLowerCase())
    return { kind: 'ignored', reason: 'receiver is not the donation address' };
  if (d.purchaseData?.purpose !== PURPOSE) return { kind: 'ignored', reason: 'not a hiraia donation' };
  const t = d.destinationToken;
  const chain = DONATION_CHAINS.find((c) => c.id === Number(t?.chainId));
  const accepted = chain?.tokens.find((x) =>
    x.address ? x.address.toLowerCase() === String(t.address).toLowerCase() : /^0xe{40}$/i.test(String(t.address)),
  );
  if (!chain || !accepted) return { kind: 'ignored', reason: 'token not on the accepted list' };
  if (typeof d.paymentId !== 'string' || !d.paymentId || d.paymentId.length > 200) return { kind: 'ignored', reason: 'no payment id' };
  const txs = (Array.isArray(d.transactions) ? d.transactions : [])
    .filter((x) => /^0x[0-9a-fA-F]{64}$/.test(String(x?.transactionHash)))
    .map((x) => ({ chainId: Number(x.chainId), transactionHash: String(x.transactionHash) }));
  const ref = typeof d.purchaseData?.ref === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d.purchaseData.ref) ? d.purchaseData.ref : null;
  let amount: string;
  try {
    amount = units(d.destinationAmount, accepted.decimals);
  } catch {
    return { kind: 'ignored', reason: 'bad amount' };
  }
  const db = getDb();
  purgeExpired();
  return db.transaction((): WebhookOutcome => {
    const session = ref
      ? (db.prepare('SELECT email FROM donation_sessions WHERE ref = ?').get(ref) as { email: string } | undefined)
      : undefined;
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO donations (payment_id, ref, email, chain_id, token_symbol, token_address, amount, tx_hashes, test)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.paymentId, session ? ref : null, session?.email ?? null, chain.id, accepted.symbol, String(t.address), amount, JSON.stringify(txs),
        d.purchaseData?.test === true ? 1 : 0);
    if (!inserted.changes) return { kind: 'duplicate' };
    if (session) db.prepare('DELETE FROM donation_sessions WHERE ref = ?').run(ref);
    return { kind: 'recorded', paymentId: d.paymentId, matched: Boolean(session) };
  })();
}

/* ---------------------------------------------------------------- notification */

type DonationRow = {
  payment_id: string;
  email: string | null;
  chain_id: number;
  token_symbol: string;
  amount: string;
  tx_hashes: string;
  confirmed_at: string;
  notified: string;
  test: number;
};

export function notificationText(row: DonationRow) {
  const chain = DONATION_CHAINS.find((c) => c.id === row.chain_id);
  const txs = JSON.parse(row.tx_hashes) as { transactionHash: string; chainId: number }[];
  const tx = txs.at(-1)?.transactionHash;
  return [
    `${row.test ? 'TEST — ' : ''}Donation: ${row.amount} ${row.token_symbol} on ${chain?.name ?? `chain ${row.chain_id}`}`,
    `From: ${row.email ?? 'anonymous'}`,
    `Tx: ${tx ? `${chain?.explorer ?? ''}/tx/${tx}` : 'not reported'}`,
  ].join('\n');
}

/** Beaniebot's alert thread when a key is configured, otherwise email via Resend. */
export async function notifyDonation(paymentId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM donations WHERE payment_id = ?').get(paymentId) as DonationRow | undefined;
  if (!row) return 'missing';
  const text = notificationText(row);
  const set = (status: string) => db.prepare('UPDATE donations SET notified = ? WHERE payment_id = ?').run(status, paymentId);
  if (process.env.BEANIEBOT_ALERT_KEY) {
    try {
      const r = await fetch(process.env.BEANIEBOT_ALERT_URL || 'https://beanie.cryptoday.live/api/alerts/push', {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${process.env.BEANIEBOT_ALERT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, source: 'hiraia-donations' }),
      });
      if (r.ok) {
        set('beaniebot');
        return 'beaniebot';
      }
      console.error(`[donations] Beaniebot alert failed (${r.status}); falling back to email`);
    } catch {
      console.error('[donations] Beaniebot alert unreachable; falling back to email');
    }
  }
  if (!process.env.RESEND_API_KEY) {
    set('unconfigured');
    return 'unconfigured';
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `donation-${createHash('sha256').update(paymentId).digest('hex').slice(0, 32)}`,
      },
      body: JSON.stringify({
        from: 'Hiraia <feedback@hiraia.org>',
        to: process.env.DONATION_NOTIFY_TO || process.env.FEEDBACK_TO || 'lb@hiraia.org',
        subject: text.split('\n')[0],
        text,
      }),
    });
    const status = r.ok ? 'email' : 'failed';
    set(status);
    return status;
  } catch {
    set('failed');
    return 'failed';
  }
}

/* ---------------------------------------------------------------- report */

export function reportRows() {
  purgeExpired();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM donations ORDER BY confirmed_at DESC LIMIT 500').all() as DonationRow[];
  const pending = (db.prepare('SELECT count(*) AS n FROM donation_sessions').get() as { n: number }).n;
  return { rows, pending };
}

export function checkReportAuth(header: string | null) {
  const expected = process.env.DONATIONS_REPORT_PASSWORD_SHA256;
  if (!expected || !/^[0-9a-f]{64}$/.test(expected) || !header?.startsWith('Basic ')) return false;
  let password = '';
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    password = decoded.slice(decoded.indexOf(':') + 1);
  } catch {
    return false;
  }
  const got = createHash('sha256').update(password).digest();
  return timingSafeEqual(got, Buffer.from(expected, 'hex'));
}
