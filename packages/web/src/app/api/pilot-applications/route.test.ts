// Run with NODE_OPTIONS=--conditions=react-server; uses only a temporary database and mocked email.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

test('applications persist privately, retries deduplicate, failures stay truthful, and abuse is bounded', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hiraia-pilot-test-'));
  process.env.HIRAIA_DB_PATH = join(temporary, 'applications.db');
  process.env.RESEND_API_KEY = '';
  const { POST } = await import('./route');
  const { getDb } = await import('@/lib/db');
  const application = () => ({
    requestId: randomUUID(),
    website: '',
    contactName: 'Sample Teacher',
    role: 'School head',
    email: 'teacher@example.test',
    mobile: '',
    schoolName: 'Example School',
    schoolType: 'Public school',
    city: 'Navotas',
    province: 'Metro Manila',
    classes: [
      { name: 'Mabini', grade: '4', students: 40 },
      { name: 'Rizal', grade: '5', students: 35 },
    ],
    needs:
      'Our students need more practice with science concepts and have limited internet access at home.',
    benefit:
      'An offline tutor would give students extra practice and help teachers identify questions for class.',
    devices: 'Shared school devices',
    preferredStart: 'Next term',
    consent: true,
  });
  let address = 0;
  const post = (body: unknown, headers: Record<string, string> = {}, raw = false) =>
    POST(
      new NextRequest('http://localhost/api/pilot-applications', {
        method: 'POST',
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
          'x-forwarded-for': `test-${address++}`,
          ...headers,
        },
        body: raw ? (body as string) : JSON.stringify(body),
      })
    );
  const count = () =>
    (getDb().prepare('SELECT count(*) AS n FROM pilot_applications').get() as { n: number }).n;
  const realFetch = globalThis.fetch;
  try {
    const data = application();
    assert.equal((await post(data)).status, 200);
    assert.equal(count(), 1);
    const row = getDb().prepare('SELECT * FROM pilot_applications').get() as {
      payload_json: string;
      notification_status: string;
    };
    const stored = JSON.parse(row.payload_json);
    assert.equal(stored.classes.length, 2);
    assert.equal(stored.email, data.email);
    assert.equal(stored.consent, true);
    assert.equal(stored.requestId, undefined);
    assert.equal(row.notification_status, 'unconfigured');
    assert.equal((await post(data)).status, 200);
    assert.equal(count(), 1, 'network retry must not create another application');
    assert.equal((await post({ ...data, schoolName: 'A different school' })).status, 409);

    for (const invalid of [
      null,
      [],
      {},
      { ...application(), consent: false },
      { ...application(), classes: [] },
      { ...application(), website: 'spam.test' },
    ]) {
      assert.equal((await post(invalid)).status, 400);
    }
    assert.equal((await post('{', {}, true)).status, 400);
    assert.equal((await post(application(), { origin: 'https://unrelated.test' })).status, 403);
    assert.equal((await post(application(), { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('x'.repeat(33000), {}, true)).status, 413);
    assert.equal(count(), 1, 'invalid submissions must not be stored');

    for (let i = 0; i < 10; i++)
      assert.equal(
        (await post(null, { 'x-forwarded-for': `spoof-${i}, shared-school` })).status,
        400
      );
    const limited = await post(application(), { 'x-forwarded-for': 'new-spoof, shared-school' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');

    process.env.RESEND_API_KEY = 'test-key-never-sent';
    let emailCalls = 0;
    globalThis.fetch = async (_url, init) => {
      emailCalls++;
      const email = JSON.parse(init?.body as string);
      assert.equal(email.reply_to, 'teacher@example.test');
      assert.ok(email.text.includes('Mabini: Grade 4, 40 students'));
      assert.equal(email.html, undefined);
      return new Response('{}', { status: 503 });
    };
    const providerFailure = application();
    assert.equal((await post(providerFailure)).status, 200);
    assert.equal(count(), 2);
    assert.equal(
      (
        getDb()
          .prepare(
            'SELECT notification_status AS status FROM pilot_applications ORDER BY id DESC LIMIT 1'
          )
          .get() as { status: string }
      ).status,
      'failed'
    );
    await post(providerFailure);
    assert.equal(emailCalls, 1, 'a retry does not send another notification');
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    assert.equal((await post(application())).status, 200);
    assert.equal(
      (
        getDb()
          .prepare(
            'SELECT notification_status AS status FROM pilot_applications ORDER BY id DESC LIMIT 1'
          )
          .get() as { status: string }
      ).status,
      'sent'
    );

    getDb().close();
    const failed = await post(application());
    assert.equal(
      failed.status,
      503,
      'storage failure must never claim the application was received'
    );
    assert.equal((await failed.json()).ok, undefined);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    rmSync(temporary, { recursive: true, force: true });
  }
});
