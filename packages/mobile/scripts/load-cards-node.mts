/**
 * Load src/data/cards.ts under Node (tsx), with its four app-only imports shimmed.
 *
 * Every headless check drives the REAL feed logic rather than a copy of it, so each one has
 * to solve the same problem: cards.ts imports `@hiraia/shared` (a workspace package, not
 * resolvable from the temp file the shim writes), two generated JSON modules (relative paths
 * that move with that temp file), and `./cardDb` — the React-Native data layer, which is
 * expo-asset + expo-sqlite and simply does not exist in Node.
 *
 * That shim used to be copy-pasted into each harness, and it drifted: the inventory moved
 * from cardsPool.generated.json into cards.db and the copies kept swapping an import that
 * cards.ts no longer has, so they died on '@hiraia/shared' instead. One copy, here.
 *
 * cardDb is replaced by a stub over the SAME artefacts the app ships — cards.db for the
 * prose and the MCQs, tokens.bin for textJaccard — so a harness measures the text a reader
 * would actually see. node:sqlite is synchronous, so `textOf`/`questionOf` can read through
 * on a miss and no caller has to warm a page first; `loadText`/`loadQuestions` stay as the
 * no-ops that shape matches.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const SHARED = join(MOBILE, '../shared/src');

export const CARDS_SRC = readFileSync(join(MOBILE, 'src/data/cards.ts'), 'utf8');

const DB = join(MOBILE, 'assets/data/cards.db');
const TOKENS = join(MOBILE, 'assets/data/tokens.bin');

const CARD_DB_STUB = `
  const { DatabaseSync: __DB } = await import('node:sqlite');
  const __db = new __DB(${JSON.stringify(DB)}, { readOnly: true });
  const __text = __db.prepare('SELECT * FROM card_text WHERE id = ?');
  const __ques = __db.prepare('SELECT json FROM card_question WHERE factId = ?');
  const __split = (s: string) => { const v = (s ?? '').split('\\x1f').filter(Boolean); return v.length ? v : undefined; };
  const __TEXT = new Map<string, any>();
  const __Q = new Map<string, any>();
  const textOf = (id: string) => {
    if (__TEXT.has(id)) return __TEXT.get(id);
    const r: any = __text.get(id);
    const row = r ? {
      fact: { tl: r.tl, en: r.en, bis: r.bis },
      title: { tl: r.title_tl, en: r.title_en, bis: r.title_bis },
      emphasis: { tl: __split(r.emph_tl), en: __split(r.emph_en), bis: __split(r.emph_bis) },
      poster: r.poster === 1,
    } : undefined;
    __TEXT.set(id, row);
    return row;
  };
  const questionOf = (f: string) => {
    if (__Q.has(f)) return __Q.get(f);
    const r: any = __ques.get(f);
    const q = r ? JSON.parse(r.json) : undefined;
    __Q.set(f, q);
    return q;
  };
  const loadText = async (_ids: readonly string[]) => {};
  const loadQuestions = async (_f: readonly string[]) => {};
  const searchTokenRows = async (tokens: readonly string[]) => {
    if (!tokens.length) return [];
    const st = __db.prepare('SELECT token, df, ords FROM search_token WHERE token IN (' + tokens.map(() => '?').join(',') + ')');
    return st.all(...(tokens as string[])) as Array<{ token: string; df: number; ords: string }>;
  };
  const __tokBuf = (await import('node:fs')).readFileSync(${JSON.stringify(TOKENS)});
  const __n = __tokBuf.readInt32LE(0);
  const __all = new Int32Array(__tokBuf.buffer, __tokBuf.byteOffset + 4, (__tokBuf.byteLength - 4) >> 2);
  const __off = __all.subarray(0, __n + 1);
  const __tok = __all.subarray(__n + 1);
  function tokenJaccard(a: number, b: number): number {
    if (a < 0 || b < 0) return 0;
    const as = __off[a]!, ae = __off[a + 1]!, bs = __off[b]!, be = __off[b + 1]!;
    const la = ae - as, lb = be - bs;
    if (!la || !lb) return 0;
    let i = as, j = bs, both = 0;
    while (i < ae && j < be) {
      const x = __tok[i]!, y = __tok[j]!;
      if (x === y) { both++; i++; j++; } else if (x < y) i++; else j++;
    }
    return both / (la + lb - both);
  }
`;

/** Dynamic-import cards.ts with its app-only imports rewritten. */
export function loadCards(): Promise<any> {
  const src = CARDS_SRC
    .replace(/from '@hiraia\/shared';/, `from '${join(SHARED, 'index.ts')}';`)
    .replace(
      "import cardsIndex from '../generated/cardsIndex.generated.json';",
      `import cardsIndex from '${join(MOBILE, 'src/generated/cardsIndex.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import curriculumTagsJson from '../generated/curriculumTags.generated.json';",
      `import curriculumTagsJson from '${join(MOBILE, 'src/generated/curriculumTags.generated.json')}' with { type: 'json' };`
    )
    .replace(/import \{[^}]*\} from '\.\/cardDb';/, CARD_DB_STUB);
  const file = join(mkdtempSync(join(tmpdir(), 'cards-node-')), 'cards-impl.mts');
  writeFileSync(file, src);
  return import(file);
}
