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
 * from cardsPool.app.json into cards.db and the copies kept swapping an import that
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
/**
 * The art-presence registry is the REAL module, not a stub — it imports nothing, so it loads
 * under Node unchanged, and a harness that swapped in a copy would be testing the copy. Only
 * the specifier moves, because cards.ts is rewritten into a temp directory.
 */
const ART_PRESENCE = join(MOBILE, 'src/data/artPresence.ts');

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
    const st = __db.prepare('SELECT token, df, ords, ranks, widths FROM search_token WHERE token IN (' + tokens.map(() => '?').join(',') + ')');
    return (st.all(...(tokens as string[])) as any[]).map((r) => ({
      token: r.token as string,
      df: r.df as number,
      ords: r.ords as string,
      // node:sqlite hands a BLOB back as a Buffer/Uint8Array; expo-sqlite hands a Uint8Array.
      ranks: r.ranks ? new Uint8Array(r.ranks.buffer, r.ranks.byteOffset, r.ranks.byteLength) : null,
      widths: r.widths ? new Uint8Array(r.widths.buffer, r.widths.byteOffset, r.widths.byteLength) : null,
    }));
  };
  const cardHeadSizes = async () => {
    const r: any = __db.prepare("SELECT value FROM search_meta WHERE key = 'head_sizes'").get();
    if (!r?.value) return null;
    return new Uint8Array(r.value.buffer, r.value.byteOffset, r.value.byteLength);
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

/**
 * The three sites where art PRESENCE changed the feed's behaviour, and their pre-presence
 * form. Reverse-applying these to today's cards.ts reconstructs the build that existed
 * before this module was consulted at all — which is the only way an identity check can
 * compare the new feed against the old one rather than against itself.
 *
 * If one of these stops matching, the check that uses it fails loudly (see
 * `loadCards({ prePresence: true })`) instead of silently comparing two identical modules.
 * That is deliberate: a fourth presence-dependent site would otherwise ship untested.
 */
export const PRE_PRESENCE_PATCH: readonly (readonly [string, string])[] = [
  ['if (hasArt(cur.slug)) slugs.add(cur.slug);', 'if (cur.slug) slugs.add(cur.slug);'],
  ['if (f && hasArt(f.slug)) slugs.add(f.slug);', 'if (f?.slug) slugs.add(f.slug);'],
  [
    'unseen(f) && !blockedSlugs.has(f.slug) && topicKeyOf(f) !== curTopicKey;',
    'unseen(f) && !(f.slug && blockedSlugs.has(f.slug)) && topicKeyOf(f) !== curTopicKey;',
  ],
];

/**
 * slug -> actual art file on disk (repo-relative), parsed once from the generated
 * imageMap — the app resolves art through Metro require()s there, so that map IS the
 * source of truth for where a slug's picture lives (assets-png/<domain>/ or cards-png/).
 * Harnesses use this so a judge views exactly the file the device would render.
 */
const IMAGE_MAP_PATH = join(MOBILE, 'src/generated/imageMap.ts');
const ART_PATHS: Map<string, string> = (() => {
  const src = readFileSync(IMAGE_MAP_PATH, 'utf8');
  const out = new Map<string, string>();
  for (const m of src.matchAll(/"([a-z0-9-]+)": require\("([^"]+)"\)/g)) {
    // ../../../images/... -> packages/images/... (repo-relative from the repo root)
    out.set(m[1]!, m[2]!.replace(/^\.\.(\/\.\.)*/, 'packages'));
  }
  return out;
})();

export function artPathOf(slug: string | undefined): string | null {
  return slug ? ART_PATHS.get(slug) ?? null : null;
}

export interface LoadCardsOpts {
  /**
   * Reverse-apply PRE_PRESENCE_PATCH, i.e. load the feed as it behaved BEFORE art presence
   * existed: the illustration cooldown gates on slug truthiness rather than on whether the
   * file is on the device. `cardHasArt` and the `hasArt` import stay (they are additive and
   * do not steer a walk), so the two modules differ only where behaviour could differ.
   */
  prePresence?: boolean;
}

/**
 * Dynamic-import cards.ts with its app-only imports rewritten.
 *
 * Two variants can be loaded in one process. They are separate module instances, but both
 * import the registry by the SAME absolute path, so they share one `artPresence` — install a
 * manifest once and both feeds see it.
 */
export function loadCards(opts: LoadCardsOpts = {}): Promise<any> {
  let base = CARDS_SRC;
  if (opts.prePresence) {
    for (const [now, before] of PRE_PRESENCE_PATCH) {
      if (!base.includes(now)) {
        throw new Error(
          `load-cards-node: pre-presence patch is stale — cards.ts no longer contains ${JSON.stringify(now)}. ` +
            `Update PRE_PRESENCE_PATCH so the identity check keeps comparing old behaviour against new.`
        );
      }
      base = base.replace(now, before);
    }
  }
  const src = base
    .replace(/from '@hiraia\/shared';/, `from '${join(SHARED, 'index.ts')}';`)
    .replace(
      "import cardsIndex from '../generated/cardsIndex.generated.json';",
      `import cardsIndex from '${join(MOBILE, 'src/generated/cardsIndex.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import curriculumTagsJson from '../generated/curriculumTags.generated.json';",
      `import curriculumTagsJson from '${join(MOBILE, 'src/generated/curriculumTags.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import curriculumOutlineJson from '../generated/curriculumOutline.generated.json';",
      `import curriculumOutlineJson from '${join(MOBILE, 'src/generated/curriculumOutline.generated.json')}' with { type: 'json' };`
    )
    .replace(
      "import { hasArt } from './artPresence';",
      `import { hasArt } from '${ART_PRESENCE}';`
    )
    .replace(/import \{[^}]*\} from '\.\/cardDb';/, CARD_DB_STUB)
    // The art-presence registry, RE-EXPORTED from the module that consults it
    // (`mod.artPresence`). A harness must be able to install a partial bundled manifest and
    // have the feed see it, and it cannot get there by importing the file itself: tsx does
    // NOT dedupe a static absolute-path import against a dynamic import of the same path, so
    // that yields a second, independent copy of the registry and every presence check
    // silently reads the default. Re-exporting is instance-identity by construction.
    .concat(`\nexport * as artPresence from '${ART_PRESENCE}';\n`);
  // A fresh temp dir per call: two variants must be two module instances, and Node keys the
  // ESM cache on the resolved path.
  const file = join(mkdtempSync(join(tmpdir(), 'cards-node-')), 'cards-impl.mts');
  writeFileSync(file, src);
  return import(file);
}
