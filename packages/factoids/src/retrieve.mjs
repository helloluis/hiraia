/**
 * Image resolution for the daily factoid.
 *
 * Because the feature is IMAGE-ANCHORED (we choose the factoid's subject from
 * the image library), retrieval is a direct lookup of the factoid's `imageId`
 * in packages/images/index.json — no search, guaranteed hit. The TF-IDF gate in
 * packages/images/visual-gate.mjs remains the tool for the *factoid-first*
 * direction (free text → best image) if we ever want it; see findImageForText().
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('./types.mjs').ResolvedImage} ResolvedImage */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

export const IMAGES_DIR = process.env.HIRAIA_IMAGES_DIR
  ? process.env.HIRAIA_IMAGES_DIR
  : join(PKG, '..', 'images');

const INDEX_PATH = join(IMAGES_DIR, 'index.json');

let _index = null;
/** Lazy-load + memoize the image index ({id -> asset}). */
function index() {
  if (_index) return _index;
  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      `Image index not found at ${INDEX_PATH}. Build it first: ` +
        `(cd packages/images && node build-index.mjs)`,
    );
  }
  const { assets } = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  _index = new Map(assets.map((a) => [a.id, a]));
  return _index;
}

const EMPTY_TRI = { tl: '', en: null, ceb: null };

/**
 * Resolve the image asset for a factoid's imageId.
 * @param {string} imageId
 * @returns {ResolvedImage}
 */
export function resolveImage(imageId) {
  const a = index().get(imageId);
  if (!a) {
    return {
      imageId,
      subject: '',
      name: '',
      svgPath: null,
      pngPath: null,
      caption: EMPTY_TRI,
      parts: EMPTY_TRI,
      found: false,
    };
  }
  const svgPath = join(IMAGES_DIR, 'assets', a.subject, `${imageId}.svg`);
  const pngPath = join(IMAGES_DIR, 'assets-png', a.subject, `${imageId}.png`);
  return {
    imageId,
    subject: a.subject,
    name: a.name,
    svgPath: existsSync(svgPath) ? svgPath : null,
    pngPath: existsSync(pngPath) ? pngPath : null,
    caption: a.caption || EMPTY_TRI,
    parts: a.parts || EMPTY_TRI,
    found: true,
  };
}

/**
 * FACTOID-FIRST fallback: given free text, return the best-matching image id
 * from the index using the same TF-IDF approach as visual-gate.mjs, or null if
 * nothing clears the threshold. Unused by the default image-anchored flow; kept
 * so the alternative direction is a one-liner away.
 * @param {string} text
 * @param {number} [threshold]
 * @returns {string|null}
 */
export function findImageForText(text, threshold = 0.1) {
  const { assets } = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  const STOP = new Set(
    'the a an of and or to in on is are was were be it its this that for with as at by from into ang ng sa na mga ay ko mo ito iyon kung may'.split(
      /\s+/,
    ),
  );
  const tok = (s) =>
    (s.toLowerCase().match(/[a-záéíóúñ]+/gi) || [])
      .map((w) => w.replace(/[^a-z]/g, ''))
      .filter((w) => w.length > 2 && !STOP.has(w));
  const df = new Map();
  const docs = assets.map((x) => {
    const c = new Map();
    for (const t of tok(x.searchText || '')) c.set(t, (c.get(t) || 0) + 1);
    for (const t of c.keys()) df.set(t, (df.get(t) || 0) + 1);
    return c;
  });
  const N = assets.length;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vec = (counts) => {
    const v = new Map();
    let n = 0;
    for (const [t, c] of counts) {
      const w = (1 + Math.log(c)) * idf(t);
      v.set(t, w);
      n += w * w;
    }
    n = Math.sqrt(n) || 1;
    for (const [t, w] of v) v.set(t, w / n);
    return v;
  };
  const dv = docs.map(vec);
  const qc = new Map();
  for (const t of tok(text)) qc.set(t, (qc.get(t) || 0) + 1);
  const q = vec(qc);
  let best = -1;
  let bestI = -1;
  for (let i = 0; i < dv.length; i++) {
    let s = 0;
    const [x, y] = q.size < dv[i].size ? [q, dv[i]] : [dv[i], q];
    for (const [t, w] of x) s += w * (y.get(t) || 0);
    if (s > best) {
      best = s;
      bestI = i;
    }
  }
  return best >= threshold && bestI >= 0 ? assets[bestI].id : null;
}
