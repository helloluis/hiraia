import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotForTime, runScheduledMessage, SLOT_HOURS, DEFAULT_TIMEZONE } from '../src/schedule.mjs';

// Build instants with an explicit +08:00 offset so the test is independent of
// the machine's local timezone; slotForTime evaluates them in Asia/Manila.
const manila = (hhmm) => new Date(`2026-06-04T${hhmm}:00+08:00`);

test('default timezone is Asia/Manila (GMT+8)', () => {
  assert.equal(DEFAULT_TIMEZONE, 'Asia/Manila');
});

test('07:00–07:59 Manila is morning', () => {
  assert.equal(slotForTime(manila('07:00')), 'morning');
  assert.equal(slotForTime(manila('07:30')), 'morning');
  assert.equal(slotForTime(manila('07:59')), 'morning');
});

test('20:00–20:59 Manila is evening', () => {
  assert.equal(slotForTime(manila('20:00')), 'evening');
  assert.equal(slotForTime(manila('20:59')), 'evening');
});

test('off-slot Manila times return null', () => {
  assert.equal(slotForTime(manila('08:00')), null);
  assert.equal(slotForTime(manila('12:00')), null);
  assert.equal(slotForTime(manila('21:00')), null);
  assert.equal(slotForTime(manila('06:59')), null);
});

test('the SAME instant resolves per timezone', () => {
  const at7Manila = manila('07:00'); // == 2026-06-03T23:00Z
  assert.equal(slotForTime(at7Manila, { timeZone: 'Asia/Manila' }), 'morning');
  assert.equal(slotForTime(at7Manila, { timeZone: 'UTC' }), null); // 23:00 UTC
  // 07:00 in Tokyo (GMT+9) is 06:00 in Manila — morning there, not here
  assert.equal(slotForTime(new Date('2026-06-04T07:00:00+09:00'), { timeZone: 'Asia/Tokyo' }), 'morning');
  assert.equal(slotForTime(new Date('2026-06-04T07:00:00+09:00'), { timeZone: 'Asia/Manila' }), null);
});

test('slot hours are 7 and 20', () => {
  assert.equal(SLOT_HOURS.morning, 7);
  assert.equal(SLOT_HOURS.evening, 20);
});

test('runScheduledMessage composes and hands a message to send()', async () => {
  let received = null;
  const msg = await runScheduledMessage({
    slot: 'morning', // explicit slot → time-independent
    language: 'tagalog',
    record: false, // don't touch history in tests
    send: (m) => {
      received = m;
    },
  });
  assert.ok(msg, 'returns the message');
  assert.equal(received, msg, 'send() got the same message');
  assert.equal(received.slot, 'morning');
  assert.equal(received.timeZone, 'Asia/Manila', 'stamps the timezone used');
  assert.ok(received.text.startsWith('Alam mo ba na '));
  assert.ok(received.image.found, 'anchor image resolved from the real bank/index');
});

test('runScheduledMessage derives slot from now+timeZone and skips off-slot', async () => {
  let sent = false;
  const msg = await runScheduledMessage({
    now: manila('12:00'), // midday Manila → no slot
    timeZone: 'Asia/Manila',
    record: false,
    send: () => {
      sent = true;
    },
  });
  assert.equal(msg, null, 'off-slot returns null');
  assert.equal(sent, false, 'send() not called off-slot');
});

test('runScheduledMessage rejects without a send function', async () => {
  await assert.rejects(() => runScheduledMessage({ slot: 'morning' }), /requires a send/);
});
