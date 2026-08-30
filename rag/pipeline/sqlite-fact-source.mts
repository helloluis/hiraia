/**
 * The shipped cards.db fact bank, read from Node.
 *
 * `SqlFactSource` (packages/shared) holds everything that could go wrong — the posting
 * decode, the ord-order contract, the JSON round-trip of grades/terms, the staleness stamp —
 * and takes its SQL through a driver, because the phone's expo-sqlite and Node's `node:sqlite`
 * cannot share one. This is the Node half.
 *
 * It exists so the migration's central claim is testable OUTSIDE the phone:
 *
 *   node_modules/.bin/tsx rag/pipeline/rag-parity-probe.mts /tmp/x.json --source sqlite
 *   node_modules/.bin/tsx rag/pipeline/rag-parity-probe.mts --diff /tmp/rag-baseline.json /tmp/x.json
 *
 * Same RagStore, same SqlFactSource, same database file the APK bundles — only the six lines
 * of SQL plumbing differ from what runs on device. A green diff there is a statement about
 * the phone, not about a re-implementation of it.
 *
 * `node:sqlite` is synchronous, which is the same shape expo-sqlite's `getAllSync` gives, so
 * neither side needs RagStore to become async.
 */
import { DatabaseSync } from 'node:sqlite';

import {
  SqlFactSource,
  FACT_COLUMNS,
  type FactDbDriver,
  type FactDbRow,
} from '../../packages/shared/src/rag/SqlFactSource.ts';

const DB_PATH = new URL('../../packages/mobile/assets/data/cards.db', import.meta.url).pathname;

/** Open the bundled database read-only and wrap it as a FactSource. */
export function openFactDb(path: string = DB_PATH): SqlFactSource {
  const db = new DatabaseSync(path, { readOnly: true });
  // Statements are cached per placeholder count: the IN lists vary in length (a top-10 page,
  // a two-id seen set), and re-preparing the same SQL on every query is the one avoidable
  // cost in a path whose whole point is to be cheap.
  const byArity = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const stmt = (kind: string, n: number, sql: (holes: string) => string) => {
    const key = `${kind}:${n}`;
    let s = byArity.get(key);
    if (!s) {
      s = db.prepare(sql(new Array(n).fill('?').join(',')));
      byArity.set(key, s);
    }
    return s;
  };
  const token = db.prepare('SELECT df, ords FROM fact_token WHERE token = ?');

  const driver: FactDbDriver = {
    meta: () => db.prepare('SELECT key, value FROM fact_meta').all() as Array<{ key: string; value: string }>,
    tokenRow: (t) => token.get(t) as { df: number; ords: string } | undefined,
    factRows: (ords) =>
      stmt('fact', ords.length, (h) => `SELECT ${FACT_COLUMNS} FROM fact WHERE ord IN (${h})`).all(
        ...ords
      ) as unknown as FactDbRow[],
    ordRows: (ids) =>
      stmt('ord', ids.length, (h) => `SELECT ord FROM fact WHERE id IN (${h})`).all(
        ...ids
      ) as unknown as Array<{ ord: number }>,
    maxOrd: () => (db.prepare('SELECT MAX(ord) AS m FROM fact').get() as { m: number | null } | undefined)?.m ?? undefined,
  };
  return new SqlFactSource(driver);
}
