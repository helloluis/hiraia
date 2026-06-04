#!/usr/bin/env node
/**
 * CLI for the daily factoid — both a human preview tool and the cron entrypoint.
 *
 *   node src/cli.mjs                          # preview a morning + evening message (no history write)
 *   node src/cli.mjs --slot morning --lang tagalog --grade 5
 *   node src/cli.mjs --count 5                # preview 5 (rotates, no repeats within run)
 *   node src/cli.mjs --slot evening --send    # REAL send: record history + emit JSON for a channel
 *   node src/cli.mjs --send --tz Asia/Cebu    # derive the slot from current time in that zone
 *
 * `--send` records the served factoid to history (so it won't repeat soon) and
 * prints the composed FactoidMessage as JSON on the last line for a delivery
 * channel to pick up. Without it, nothing is persisted. When `--slot` is omitted
 * in send mode, the slot is derived from the current time in `--tz` (default
 * Asia/Manila, GMT+8) — off-slot times send nothing.
 */
import { nextFactoidMessage } from './service.mjs';
import { wordCount } from './compose.mjs';
import { slotForTime, DEFAULT_TIMEZONE } from './schedule.mjs';

function parseArgs(argv) {
  const a = { slot: null, lang: 'tagalog', grade: undefined, count: 1, send: false, tz: DEFAULT_TIMEZONE };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--slot') a.slot = argv[++i];
    else if (k === '--lang') a.lang = argv[++i];
    else if (k === '--grade') a.grade = parseInt(argv[++i], 10);
    else if (k === '--count') a.count = parseInt(argv[++i], 10);
    else if (k === '--send') a.send = true;
    else if (k === '--tz' || k === '--timezone') a.tz = argv[++i];
  }
  return a;
}

function render(msg) {
  const img = msg.image;
  const imgLine = img.found
    ? `🖼  ${img.imageId} (${img.subject})  ${img.svgPath ? 'svg✓' : 'svg✗'} ${img.pngPath ? 'png✓' : 'png·'}`
    : `🖼  ⚠️  image "${img.imageId}" not in index`;
  return [
    `── ${msg.slot.toUpperCase()} · ${msg.language} · ${msg.factoidId} · ~${wordCount(msg.text)} words`,
    msg.text,
    imgLine,
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
const iso = new Date().toISOString();

if (args.send) {
  // Real one-shot send (the cron path). Slot is whatever was passed, else
  // derived from the current time in the student's timezone (default GMT+8).
  const slot = args.slot || slotForTime(new Date(), { timeZone: args.tz });
  if (!slot) {
    console.error(`Not a send slot (07:00 / 20:00) in ${args.tz} right now — nothing sent. Pass --slot to force.`);
    process.exit(0);
  }
  const msg = nextFactoidMessage({ language: args.lang, grade: args.grade, slot, record: true, iso });
  if (!msg) {
    console.error('No verified factoid available to send.');
    process.exit(1);
  }
  msg.timeZone = args.tz;
  console.error(render(msg)); // human-readable to stderr
  console.log(JSON.stringify(msg)); // machine-readable to stdout for the channel
  process.exit(0);
}

// Preview mode (no persistence). Rotate without repeats within this run by
// threading a local "served" set through the RNG-free path.
const slots = args.slot ? [args.slot] : ['morning', 'evening'];
const servedThisRun = [];
let shown = 0;
const total = args.slot ? args.count : Math.max(args.count, slots.length);

for (let i = 0; i < total; i++) {
  const slot = slots[i % slots.length];
  // Reuse the no-repeat machinery by passing our in-run history via a temp state
  // shim: nextFactoidMessage reads persisted history, so for previews we instead
  // just resample until we get a fresh one (small bank, cheap).
  let msg = null;
  for (let tries = 0; tries < 25; tries++) {
    const candidate = nextFactoidMessage({ language: args.lang, grade: args.grade, slot, record: false, iso });
    if (!candidate) break;
    if (!servedThisRun.includes(candidate.factoidId) || tries === 24) {
      msg = candidate;
      break;
    }
  }
  if (!msg) {
    console.log('No verified factoid available.');
    break;
  }
  servedThisRun.push(msg.factoidId);
  console.log(render(msg));
  console.log();
  shown++;
}

if (shown === 0) process.exit(1);
