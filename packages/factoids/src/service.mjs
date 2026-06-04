/**
 * FactoidService — the one call a delivery channel makes to get the next
 * "Alam mo ba na…?" message: sample a verified factoid (no recent repeat),
 * compose it in the reader's language, and attach its anchor image.
 */
import { loadBank, sampleFactoid, readHistory, recordServed, DEFAULT_BANK_PATH, DEFAULT_STATE_PATH } from './bank.mjs';
import { composeText } from './compose.mjs';
import { resolveImage } from './retrieve.mjs';

/** @typedef {import('./types.mjs').FactoidMessage} FactoidMessage */

/**
 * Produce the next factoid message.
 *
 * @param {Object} [opts]
 * @param {'tagalog'|'english'|'cebuano'} [opts.language]  reader language (default tagalog).
 * @param {number} [opts.grade]            student grade band (3–10), to bias selection.
 * @param {('morning'|'evening')} [opts.slot]  which daily slot this is for (label only).
 * @param {boolean} [opts.record]          persist the served id to history (default false; the
 *                                         scheduler sets true, previews leave it false).
 * @param {string}  [opts.iso]             timestamp to stamp on the message/history.
 * @param {() => number} [opts.rng]        injectable RNG (default Math.random).
 * @param {string}  [opts.bankPath]
 * @param {string}  [opts.statePath]
 * @returns {FactoidMessage|null}
 */
export function nextFactoidMessage(opts = {}) {
  const {
    language = 'tagalog',
    grade,
    slot = 'morning',
    record = false,
    iso,
    rng,
    bankPath = DEFAULT_BANK_PATH,
    statePath = DEFAULT_STATE_PATH,
  } = opts;

  const bank = loadBank(bankPath);
  if (bank.length === 0) return null;

  const recentIds = readHistory(statePath);
  const factoid = sampleFactoid(bank, { recentIds, grade, rng });
  if (!factoid) return null;

  const { text } = composeText(factoid, language);
  const image = resolveImage(factoid.imageId);

  if (record) recordServed(factoid.id, { statePath, iso });

  return { factoidId: factoid.id, slot, language, text, image, iso: iso || null };
}
