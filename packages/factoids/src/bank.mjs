/**
 * Load and sample the curated + verified factoid bank.
 *
 * The bank is the single source of truth at runtime. We ONLY ever serve
 * factoids with `verified === true` — an unverified entry is a bug in the
 * offline pipeline, never something the student sees.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('./types.mjs').Factoid} Factoid */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

export const DEFAULT_BANK_PATH = process.env.HIRAIA_FACTOID_BANK
  ? process.env.HIRAIA_FACTOID_BANK
  : join(PKG, 'bank', 'factoids.json');

/** Where the scheduler remembers what it has recently served (no-repeat). */
export const DEFAULT_STATE_PATH = process.env.HIRAIA_FACTOID_STATE
  ? process.env.HIRAIA_FACTOID_STATE
  : join(PKG, '.state', 'history.json');

/**
 * Load the bank file and return ONLY verified factoids.
 * @param {string} [bankPath]
 * @returns {Factoid[]}
 */
export function loadBank(bankPath = DEFAULT_BANK_PATH) {
  const raw = JSON.parse(readFileSync(bankPath, 'utf8'));
  const all = Array.isArray(raw) ? raw : raw.factoids || [];
  const verified = all.filter((f) => f && f.verified === true && f.imageId && f.hook && f.body);
  return verified;
}

/**
 * Pick one factoid, avoiding anything in `recentIds`. If every factoid is
 * recent (small bank, long history), the history constraint is relaxed so we
 * still return something rather than nothing.
 *
 * @param {Factoid[]} factoids
 * @param {Object} [opts]
 * @param {Iterable<string>} [opts.recentIds]  factoid ids served recently.
 * @param {number} [opts.grade]                if set, prefer factoids tagged for this grade band.
 * @param {() => number} [opts.rng]            injectable RNG in [0,1) (default Math.random).
 * @returns {Factoid|null}
 */
export function sampleFactoid(factoids, opts = {}) {
  const rng = opts.rng || Math.random;
  const recent = new Set(opts.recentIds || []);

  let pool = factoids;
  if (typeof opts.grade === 'number') {
    const forGrade = pool.filter((f) => !f.grades || f.grades.length === 0 || f.grades.includes(opts.grade));
    if (forGrade.length) pool = forGrade;
  }

  let fresh = pool.filter((f) => !recent.has(f.id));
  if (fresh.length === 0) fresh = pool; // history exhausted the pool — relax it
  if (fresh.length === 0) return null;

  return fresh[Math.floor(rng() * fresh.length)];
}

/**
 * Read the rolling "recently served" history (ids, newest first).
 * @param {string} [statePath]
 * @returns {string[]}
 */
export function readHistory(statePath = DEFAULT_STATE_PATH) {
  if (!existsSync(statePath)) return [];
  try {
    const j = JSON.parse(readFileSync(statePath, 'utf8'));
    return Array.isArray(j.served) ? j.served : [];
  } catch {
    return [];
  }
}

/**
 * Record a served factoid id, keeping a bounded rolling window so we cycle the
 * whole bank before repeating. Window defaults to ~70% of the bank size.
 * @param {string} factoidId
 * @param {Object} [opts]
 * @param {string} [opts.statePath]
 * @param {number} [opts.window]  how many recent ids to remember.
 * @param {string} [opts.iso]     timestamp to stamp (caller supplies; runtime clock allowed).
 */
export function recordServed(factoidId, opts = {}) {
  const statePath = opts.statePath || DEFAULT_STATE_PATH;
  const window = opts.window || 32;
  const served = [factoidId, ...readHistory(statePath).filter((id) => id !== factoidId)].slice(0, window);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ served, updatedAt: opts.iso || null }, null, 2) + '\n');
  return served;
}
