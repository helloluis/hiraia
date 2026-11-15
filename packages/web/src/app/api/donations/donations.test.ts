// Run: node --conditions=react-server --import tsx src/app/api/donations/donations.test.ts
// Temporary database and mocked network only (no thirdweb, Beaniebot or Resend calls).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const SECRET = 'whsec_test_only';
const ADDRESS = '0xE083DEc32098F00F0972a8B258ce4414dcF1ca2d';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

function payment(over: Record<string, unknown> = {}, purchaseData: Record<string, unknown> = { purpose: 'hiraia-donation' }) {
  return {
    version: 2,
    type: 'pay.onchain-transaction',
    data: {
      action: 'TRANSFER',
      clientId: '897f11e5f997baa2edd3ab2d5e0335fc',
      paymentId: `pay_${Math.random().toString(36).slice(2)}`,
      status: 'COMPLETED',
      sender: '0x2383216C157f1fEf01821731e445488803EA1061',
      receiver: ADDRESS,
      originToken: { chainId: 1, address: USDT, decimals: 6, symbol: 'USDT', name: 'Tether USD', priceUsd: 1 },
      destinationToken: { chainId: 1, address: USDT, decimals: 6, symbol: 'USDT', name: 'Tether USD', priceUsd: 1 },
      originAmount: '25075000',
      destinationAmount: '25000000',
      developerFeeBps: 0,
      developerFeeRecipient: ADDRESS,
      transactions: [{ chainId: 1, transactionHash: '0x' + 'ab'.repeat(32) }],
      type: 'transfer',
      purchaseData,
      ...over,
    },
  };
}
const sign = (raw: string, ts = Math.floor(Date.now() / 1000)) => ({
  'x-timestamp': String(ts),
  'x-payload-signature': createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex'),
});

test('optional donor email: sessions, signed webhook matching, notification and private report', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hiraia-donations-test-'));
  process.env.HIRAIA_DB_PATH = join(temporary, 'donations.db');
  process.env.RESEND_API_KEY = 're_test';
  process.env.FEEDBACK_TO = 'luis@example.test';
  delete process.env.BEANIEBOT_ALERT_KEY;
  delete process.env.THIRDWEB_WEBHOOK_SECRET;
  process.env.DONATIONS_REPORT_PASSWORD_SHA256 = createHash('sha256').update('correct horse').digest('hex');

  const session = (await import('./session/route')).POST;
  const webhook = (await import('./webhook/route')).POST;
  const report = (await import('./report/route')).GET;
  const { getDb } = await import('@/lib/db');
  const db = getDb();

  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let beanieStatus = 200;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (String(url).includes('beanie')) return new Response('{}', { status: beanieStatus });
    return new Response('{"id":"x"}', { status: 200 });
  }) as typeof fetch;
  const settle = async (paymentId: string) => {
    for (let i = 0; i < 50; i++) {
      const r = db.prepare('SELECT notified FROM donations WHERE payment_id = ?').get(paymentId) as { notified: string } | undefined;
      if (r && r.notified !== 'pending') return r.notified;
      await new Promise((res) => setTimeout(res, 10));
    }
    return 'pending';
  };

  let ip = 0;
  const postSession = (body: unknown, headers: Record<string, string> = {}) =>
    session(new NextRequest('http://localhost/api/donations/session', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'x-forwarded-for': `t-${ip++}`, ...headers },
      body: JSON.stringify(body),
    }));
  const postHook = (raw: string, headers: Record<string, string>) =>
    webhook(new NextRequest('http://localhost/api/donations/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));

  try {
    // Sessions: valid email + selection only.
    const ok = await postSession({ email: ' donor@example.test ', chainId: 1, token: 'USDT', amount: '25' });
    assert.equal(ok.status, 200);
    const { ref } = (await ok.json()) as { ref: string };
    assert.match(ref, /^[A-Za-z0-9_-]{22}$/);
    assert.equal((db.prepare('SELECT email FROM donation_sessions WHERE ref = ?').get(ref) as { email: string }).email, 'donor@example.test');
    for (const bad of [
      { email: 'not-an-email', chainId: 1, token: 'USDT', amount: '25' },
      { email: 'a@b.co', chainId: 8453, token: 'USDT', amount: '25' }, // USDT is Ethereum-only
      { email: 'a@b.co', chainId: 1, token: 'USDT', amount: '0.5' },
      { email: 'a@b.co', chainId: 999, token: 'ETH', amount: '1' },
    ])
      assert.equal((await postSession(bad)).status, 400, JSON.stringify(bad));
    assert.equal((await postSession({ email: 'a@b.co', chainId: 1, token: 'USDT', amount: '25' }, { origin: 'https://evil.example' })).status, 403);

    // Webhook refuses everything until the secret is configured.
    const p1 = payment({}, { purpose: 'hiraia-donation', ref });
    const raw1 = JSON.stringify(p1);
    assert.equal((await postHook(raw1, sign(raw1))).status, 503);
    process.env.THIRDWEB_WEBHOOK_SECRET = SECRET;
    assert.equal((await postHook(raw1, {})).status, 401);
    assert.equal((await postHook(raw1, { ...sign(raw1), 'x-payload-signature': '00'.repeat(32) })).status, 401);
    assert.equal((await postHook(raw1, sign(raw1, Math.floor(Date.now() / 1000) - 3600))).status, 401);

    // Our signature scheme is exactly what the thirdweb SDK verifies.
    const { Bridge } = await import('thirdweb');
    const h = sign(raw1);
    const parsed = await Bridge.Webhook.parse(raw1, h, SECRET, 300, { receiverAddress: ADDRESS });
    assert.equal((parsed as { data: { paymentId: string } }).data.paymentId, p1.data.paymentId);

    // Signed, matched: email copied onto the confirmed donation, session consumed, Beaniebot absent → email.
    let res = await postHook(raw1, h);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { outcome: string }).outcome, 'recorded');
    assert.equal(await settle(p1.data.paymentId), 'email');
    const row = db.prepare('SELECT * FROM donations WHERE payment_id = ?').get(p1.data.paymentId) as Record<string, string>;
    assert.equal(row.email, 'donor@example.test');
    assert.equal(row.amount, '25');
    assert.equal(row.token_symbol, 'USDT');
    assert.equal((db.prepare('SELECT count(*) AS n FROM donation_sessions WHERE ref = ?').get(ref) as { n: number }).n, 0);
    const mail = sent.at(-1)!;
    assert.match(mail.url, /resend/);
    assert.equal(mail.body.to, 'luis@example.test');
    assert.equal(mail.body.text, `Donation: 25 USDT on Ethereum\nFrom: donor@example.test\nTx: https://etherscan.io/tx/0x${'ab'.repeat(32)}`);

    // Retry of the same payment: no second record, no second alert.
    const before = sent.length;
    res = await postHook(raw1, sign(raw1));
    assert.equal(((await res.json()) as { outcome: string }).outcome, 'duplicate');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, before);

    // Anonymous checkout payment (no ref) on Base USDC, delivered to Beaniebot when a key exists.
    process.env.BEANIEBOT_ALERT_KEY = 'bbot_test';
    const p2 = payment({
      destinationToken: { chainId: 8453, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, symbol: 'USDC', name: 'USD Coin', priceUsd: 1 },
      destinationAmount: '500000',
      transactions: [{ chainId: 8453, transactionHash: '0x' + 'cd'.repeat(32) }],
    });
    const raw2 = JSON.stringify(p2);
    assert.equal((await postHook(raw2, sign(raw2))).status, 200);
    assert.equal(await settle(p2.data.paymentId), 'beaniebot');
    const alert = sent.at(-1)!;
    assert.match(alert.url, /beanie\.cryptoday\.live\/api\/alerts\/push/);
    assert.equal(alert.body.message, `Donation: 0.5 USDC on Base\nFrom: anonymous\nTx: https://basescan.org/tx/0x${'cd'.repeat(32)}`);
    assert.equal(alert.body.source, 'hiraia-donations');

    // Beaniebot down → falls back to email.
    beanieStatus = 500;
    const p3 = payment({ destinationToken: { chainId: 1, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, symbol: 'ETH', name: 'Ether', priceUsd: 3000 }, destinationAmount: '10000000000000000' });
    const raw3 = JSON.stringify(p3);
    assert.equal((await postHook(raw3, sign(raw3))).status, 200);
    assert.equal(await settle(p3.data.paymentId), 'email');
    assert.match(String(sent.at(-1)!.body.text), /^Donation: 0\.01 ETH on Ethereum\nFrom: anonymous/);

    // A signed verification payload is labelled TEST in the alert.
    const p4 = payment({ destinationAmount: '1000000' }, { purpose: 'hiraia-donation', test: true });
    const raw4 = JSON.stringify(p4);
    assert.equal((await postHook(raw4, sign(raw4))).status, 200);
    await settle(p4.data.paymentId);
    assert.match(String(sent.at(-1)!.body.text), /^TEST — Donation: 1 USDT on Ethereum\nFrom: anonymous/);
    db.prepare('DELETE FROM donations WHERE payment_id = ?').run(p4.data.paymentId);

    // Not ours: wrong receiver, other purposes, unaccepted tokens, pending → ignored and not stored.
    for (const p of [
      payment({ receiver: '0x000000000000000000000000000000000000dEaD' }),
      payment({}, { purpose: 'something-else' }),
      payment({ destinationToken: { chainId: 8453, address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, symbol: 'USDT', name: 'Bridged USDT', priceUsd: 1 } }),
      payment({ status: 'PENDING' }),
    ]) {
      const raw = JSON.stringify(p);
      const r = await postHook(raw, sign(raw));
      assert.equal(((await r.json()) as { outcome: string }).outcome, 'ignored');
    }
    assert.equal((db.prepare('SELECT count(*) AS n FROM donations').get() as { n: number }).n, 3);

    // Report: Basic auth, HTML-escaped, CSV.
    const get = (auth?: string, q = '') =>
      report(new NextRequest(`http://localhost/api/donations/report${q}`, { headers: auth ? { authorization: auth } : {} }));
    assert.equal((await get()).status, 401);
    assert.equal((await get('Basic ' + Buffer.from('luis:wrong').toString('base64'))).status, 401);
    const good = 'Basic ' + Buffer.from('luis:correct horse').toString('base64');
    const html = await (await get(good)).text();
    assert.match(html, /donor@example\.test/);
    assert.match(html, /3 confirmed checkout payments, 1 with an email/);
    const csv = await (await get(good, '?format=csv')).text();
    assert.equal(csv.trim().split('\n').length, 4);
    db.prepare("UPDATE donations SET email = '<b>x</b>@example.test' WHERE email IS NOT NULL").run();
    assert.doesNotMatch(await (await get(good)).text(), /<b>x<\/b>/);

    // Retention: stale sessions and old emails are removed on the next write.
    db.prepare("INSERT INTO donation_sessions (ref, email, chain_id, token, amount, created_at) VALUES ('old', 'old@example.test', 1, 'USDT', '25', datetime('now','-8 days'))").run();
    db.prepare("UPDATE donations SET confirmed_at = datetime('now','-181 days') WHERE email IS NOT NULL").run();
    assert.equal((await postSession({ email: 'new@example.test', chainId: 1, token: 'USDT', amount: '25' })).status, 200);
    assert.equal((db.prepare("SELECT count(*) AS n FROM donation_sessions WHERE ref = 'old'").get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM donations WHERE email IS NOT NULL').get() as { n: number }).n, 0);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(temporary, { recursive: true, force: true });
  }
});
