/**
 * The server's own object client against a REAL bucket, with synthetic bytes only. For a rehearsal or a
 * production window: it proves that the settings, the key file and this code agree with the store.
 *
 *   TALA_R2_ENDPOINT=… TALA_R2_BUCKET=… TALA_R2_PREFIX=tala/rehearsal/ TALA_R2_CREDENTIALS_FILE=… \
 *     pnpm --filter @hiraia/tala-server exec tsx scripts/decks/r2-check.ts [--outside <a name outside the prefix>]
 *
 * Writes one object under `<prefix>route-check/<run>/original`, reads it back whole and in pieces, checks that a
 * second write to the same name is refused and changes nothing, that a name outside the prefix is refused, and
 * removes it again (and checks that it is gone). Prints outcomes only: never the endpoint, a key or a token.
 * Exit 0 only when every check passed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { credentialsFile, objectStore, storageSettingFromEnv, StoreError } from '../../src/modules/decks/r2';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const outcome = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return err instanceof StoreError ? `${err.kind}${err.status ? ` ${err.status}` : ''}${err.code ? ` ${err.code}` : ''}` : `error ${(err as Error)?.name}`;
  }
};

const setting = storageSettingFromEnv({ ...process.env, TALA_ENV: 'production' });
if (setting.kind !== 'r2') {
  console.log(`settings not usable: ${setting.kind === 'off' ? setting.problems.join('; ') : setting.kind}`);
  process.exit(2);
}
const { settings } = setting;
const store = objectStore(settings, { credentials: credentialsFile(settings.credentialsFile) });
const run = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z-${randomBytes(4).toString('hex')}`;
const key = `${settings.prefix}route-check/${run}/original`;
const outsideArg = process.argv.indexOf('--outside');
const outside = outsideArg > 0 ? process.argv[outsideArg + 1]! : `${settings.prefix.split('/')[0]}/not-this-prefix/${run}`;
console.log(`run ${run} · bucket ${settings.bucket} · prefix ${settings.prefix} · region ${settings.region}`);

const bytes = new Uint8Array(randomBytes(1_200_007)); // three pieces of 512 KiB and a bit
const digest = sha(bytes);
check('write a new object (If-None-Match: *, Content-MD5, signed payload hash)', (await outcome(() => store.putNew(key, bytes, digest))) === 'ok');
check('read it back whole: the same size and SHA-256', (await outcome(async () => {
  const back = await store.readWhole(key, bytes.length, digest);
  if (sha(back) !== digest) throw new Error('different');
})) === 'ok');
check('read it through without keeping it (the read-back after a write)', (await outcome(() => store.verify(key, bytes.length, digest))) === 'ok');
let pieces = '';
const piecesOk = (await outcome(async () => {
  const h = createHash('sha256');
  for (let at = 0; at < bytes.length; at += 524288) {
    const piece = await store.readRange(key, at, Math.min(bytes.length, at + 524288) - 1);
    h.update(piece);
    pieces += `${piece.length} `;
  }
  if (h.digest('hex') !== digest) throw new Error('different');
})) === 'ok';
check('read it in pieces of 512 KiB (as a download is sent)', piecesOk, pieces.trim());
const again = await outcome(() => store.putNew(key, new Uint8Array([1, 2, 3]), sha(new Uint8Array([1, 2, 3]))));
check('a second write to the same name is refused', again === 'exists 412', again);
check('and the first bytes are still there', (await outcome(() => store.verify(key, bytes.length, digest))) === 'ok');
const wrong = await outcome(() => store.readWhole(key, bytes.length, 'f'.repeat(64)));
check('a different recorded SHA-256 is "damaged", never taken', wrong.startsWith('damaged'), wrong);
const out = await outcome(() => store.putNew(outside, new Uint8Array([1]), sha(new Uint8Array([1]))));
check('a name outside the prefix cannot be written', out.startsWith('refused 403'), out);
const outRead = await outcome(() => store.readRange(outside, 0, 0));
check('nor read', outRead.startsWith('refused 403') || outRead.startsWith('missing'), outRead);
check('remove it', (await outcome(() => store.remove(key))) === 'ok');
const gone = await outcome(() => store.readRange(key, 0, 0));
check('it is gone', gone === 'missing 404', gone);
check('removing a name that is already gone counts as removed', (await outcome(() => store.remove(key))) === 'ok');
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
