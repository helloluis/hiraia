/**
 * @hiraia/factoids — public API.
 *
 * Scheduled, unprompted "Alam mo ba na…?" daily-factoid messages for the Hiraia
 * tutor. Image-anchored, served from a curated + verified bank. See README.md.
 */
export { loadBank, sampleFactoid, readHistory, recordServed, DEFAULT_BANK_PATH, DEFAULT_STATE_PATH } from './bank.mjs';
export { resolveImage, findImageForText, IMAGES_DIR } from './retrieve.mjs';
export { composeText, pickLang, wordCount, LEAD } from './compose.mjs';
export { nextFactoidMessage } from './service.mjs';
export { slotForTime, runScheduledMessage, SLOT_HOURS, DEFAULT_TIMEZONE } from './schedule.mjs';
