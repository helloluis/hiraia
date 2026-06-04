/**
 * Scheduling bones for the unprompted daily message.
 *
 * This module owns the *timing decision* (which slot is it?) and the
 * *dispatch* (compose → hand to an injected `send`). It deliberately does NOT
 * own a delivery channel or a real cron daemon — those are environment-specific
 * (push notification, in-app inbox, server cron). The intended wiring:
 *
 *   # crontab — fire one-shots at 07:00 and 20:00 Manila time
 *   0 7  * * *  cd /path/to/repo && node packages/factoids/src/cli.mjs --slot morning --send
 *   0 20 * * *  cd /path/to/repo && node packages/factoids/src/cli.mjs --slot evening --send
 *
 * or call runScheduledMessage({ send }) from whatever scheduler the app already
 * runs. `send` receives the composed FactoidMessage.
 */
import { nextFactoidMessage } from './service.mjs';

/** @typedef {import('./types.mjs').Slot} Slot */
/** @typedef {import('./types.mjs').FactoidMessage} FactoidMessage */

export const SLOT_HOURS = { morning: 7, evening: 20 };

/**
 * Default timezone for "07:00 / 20:00". These wall-clock times only mean
 * anything relative to a timezone, and they must be the STUDENT's timezone — a
 * morning message should land in *their* morning. We default to Manila (GMT+8)
 * because Hiraia is a Filipino-centric product; pass `timeZone` (an IANA name
 * like "Asia/Manila") per student to override. Env HIRAIA_DEFAULT_TZ overrides
 * the default itself.
 */
export const DEFAULT_TIMEZONE = process.env.HIRAIA_DEFAULT_TZ || 'Asia/Manila';

/**
 * Wall-clock hour/minute of `date` as observed in `timeZone` (DST-correct via
 * Intl). Avoids the trap of `Date.getHours()`, which uses the *server's* zone.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {{ hour: number, minute: number }}
 */
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' });
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(date)) {
    if (p.type === 'hour') hour = Number(p.value) % 24; // hourCycle h23 can emit "24" at midnight
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return { hour, minute };
}

/**
 * Which slot (if any) an instant falls into, evaluated in the reader's timezone.
 * @param {Date} date
 * @param {Object} [opts]
 * @param {string} [opts.timeZone]      IANA zone (default Asia/Manila / GMT+8).
 * @param {number} [opts.toleranceMin]  minutes after the slot hour still counted as that slot.
 * @returns {Slot|null}
 */
export function slotForTime(date, opts = {}) {
  const tol = opts.toleranceMin ?? 59;
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const { hour, minute } = zonedParts(date, timeZone);
  for (const [slot, h] of Object.entries(SLOT_HOURS)) {
    if (hour === h && minute <= tol) return /** @type {Slot} */ (slot);
  }
  return null;
}

/**
 * Compose the next message for a slot and hand it to `send`.
 *
 * @param {Object} opts
 * @param {(msg: FactoidMessage) => (void|Promise<void>)} opts.send  delivery callback (required).
 * @param {Slot} [opts.slot]            which slot; if omitted it's derived from `now` in the
 *                                      student's `timeZone` (and null → no send, off-slot).
 * @param {string} [opts.timeZone]      student's IANA zone (default Asia/Manila / GMT+8).
 * @param {Date}   [opts.now]           the instant to evaluate (default new Date()).
 * @param {'tagalog'|'english'|'cebuano'} [opts.language]
 * @param {number} [opts.grade]
 * @param {boolean} [opts.record]       persist to history (default true for real sends).
 * @param {string}  [opts.iso]          timestamp (defaults to now at call time).
 * @returns {Promise<FactoidMessage|null>}
 */
export async function runScheduledMessage(opts) {
  if (typeof opts.send !== 'function') throw new Error('runScheduledMessage requires a send(msg) function');
  const timeZone = opts.timeZone || DEFAULT_TIMEZONE;
  const now = opts.now || new Date();
  const iso = opts.iso || now.toISOString();
  const slot = opts.slot || slotForTime(now, { timeZone });
  if (!slot) return null; // not 07:00 or 20:00 in the student's timezone — nothing to send
  const msg = nextFactoidMessage({
    language: opts.language || 'tagalog',
    grade: opts.grade,
    slot,
    record: opts.record !== false,
    iso,
  });
  if (!msg) return null;
  msg.timeZone = timeZone;
  await opts.send(msg);
  return msg;
}
