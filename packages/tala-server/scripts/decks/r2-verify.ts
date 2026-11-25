/**
 * Proves that each upload's object in the bucket is the file the database recorded (size and SHA-256), reading it
 * through the server's own client. Never lists the bucket; never prints a key, a name or file content.
 *
 *   TALA_DB_PATH=/var/lib/tala/tala.db TALA_R2_ENDPOINT=… TALA_R2_BUCKET=… TALA_R2_PREFIX=… TALA_R2_CREDENTIALS_FILE=… \
 *     pnpm --filter @hiraia/tala-server exec tsx scripts/decks/r2-verify.ts [--upload <id>]…
 *
 * With no --upload, every upload. The database is opened read-only. One line per upload: its id, its size, and
 * `ok`, `damaged`, `missing`, `unavailable`, `refused`, or `in database` (a file not yet moved to the bucket).
 * Exit 0 only when every upload with an object is `ok`.
 */
import Database from 'better-sqlite3';
import { credentialsFile, objectStore, storageSettingFromEnv, StoreError } from '../../src/modules/decks/r2';

const dbPath = process.env.TALA_DB_PATH;
if (!dbPath) {
  console.log('TALA_DB_PATH is not set');
  process.exit(2);
}
const setting = storageSettingFromEnv({ ...process.env, TALA_ENV: 'production' });
if (setting.kind !== 'r2') {
  console.log(`settings not usable: ${setting.kind === 'off' ? setting.problems.join('; ') : setting.kind}`);
  process.exit(2);
}
const only = process.argv.flatMap((a, i, all) => (a === '--upload' && all[i + 1] ? [all[i + 1]!] : []));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare('SELECT id, original_sha256, original_bytes, object_key FROM decks_uploads ORDER BY created_at, rowid')
  .all()
  .filter((r) => !only.length || only.includes((r as { id: string }).id)) as Array<{ id: string; original_sha256: string; original_bytes: number; object_key: string | null }>;
db.close();
const store = objectStore(setting.settings, { credentials: credentialsFile(setting.settings.credentialsFile) });
let bad = 0;
for (const r of rows) {
  if (r.object_key === null) {
    console.log(`${r.id}  ${r.original_bytes}  in database`);
    continue;
  }
  let verdict = 'ok';
  try {
    await store.verify(r.object_key, r.original_bytes, r.original_sha256);
  } catch (err) {
    verdict = err instanceof StoreError ? `${err.kind}${err.code ? ` (${err.code})` : ''}` : 'error';
    bad++;
  }
  console.log(`${r.id}  ${r.original_bytes}  ${verdict}`);
}
console.log(`${rows.length} uploads, ${rows.filter((r) => r.object_key !== null).length} in the bucket, ${bad} not ok`);
process.exit(bad ? 1 : 0);
