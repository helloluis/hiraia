import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const EVENTS = [
  'first_open',
  'session_started',
  'card_viewed',
  'quiz_shown',
  'quiz_answer_submitted',
  'quiz_graded',
  'download_started',
  'download_resumed',
  'download_failed',
  'download_cancelled',
  'download_installed',
  'asset_available',
  'model_load_started',
  'model_ready',
  'model_load_failed',
  'generation_started',
  'generation_completed',
  'generation_failed',
  'queue_dropped',
] as const;
const names = new Set<string>(EVENTS);
const id = /^[a-zA-Z0-9_-]{16,80}$/;
const label = /^[a-zA-Z0-9_.:-]{1,100}$/;
const strings = new Set([
  'app_version',
  'build',
  'android',
  'abi',
  'model',
  'asset',
  'attempt_id',
  'view_id',
  'question_id',
  'card_id',
]);
const enums: Record<string, string[]> = {
  language: ['english', 'tagalog', 'cebuano'],
  source: ['curated', 'generated'],
  asset_kind: ['model', 'images', 'vectors', 'adapter'],
  backend: ['cpu', 'gpu', 'unknown'],
  error: ['network', 'http', 'integrity', 'storage', 'cancelled', 'runtime', 'unknown'],
};
const numbers = new Set([
  'duration_ms',
  'bytes',
  'expected_bytes',
  'offset',
  'attempt',
  'ram_gb',
  'count',
]);
export interface Event {
  id: string;
  name: string;
  occurred_at: number;
  session_id: string;
  props: Record<string, string | number | boolean>;
}
export function validEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Event;
  if (Object.keys(e).some((k) => !['id', 'name', 'occurred_at', 'session_id', 'props'].includes(k)))
    return false;
  if (
    !id.test(e.id) ||
    typeof e.id !== 'string' ||
    !names.has(e.name) ||
    typeof e.session_id !== 'string' ||
    !id.test(e.session_id) ||
    !Number.isSafeInteger(e.occurred_at) ||
    e.occurred_at < 0 ||
    e.occurred_at > 8640000000000000 ||
    !e.props ||
    typeof e.props !== 'object' ||
    Array.isArray(e.props)
  )
    return false;
  if (JSON.stringify(e).length > 1800) return false;
  return Object.entries(e.props).every(([k, v]) => {
    if (strings.has(k)) return typeof v === 'string' && label.test(v);
    if (Object.hasOwn(enums, k)) return typeof v === 'string' && enums[k]!.includes(v);
    if (numbers.has(k)) return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
    return k === 'correct' && typeof v === 'boolean';
  });
}
export function openTelemetry(filename: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec(`CREATE TABLE IF NOT EXISTS telemetry_events (
    installation_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
    occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, session_id TEXT NOT NULL,
    props TEXT NOT NULL, PRIMARY KEY (installation_id, id)
  );
  CREATE INDEX IF NOT EXISTS telemetry_time ON telemetry_events(occurred_at);
  CREATE INDEX IF NOT EXISTS telemetry_name_time ON telemetry_events(name, occurred_at);
  CREATE INDEX IF NOT EXISTS telemetry_received ON telemetry_events(received_at);`);
  return db;
}
let singleton: Database.Database | undefined;
export function getTelemetry() {
  return (singleton ??= openTelemetry(
    process.env.HIRAIA_TELEMETRY_DB_PATH || path.resolve(process.cwd(), '../../data/telemetry.db')
  ));
}
export function ingest(db: Database.Database, body: unknown, now = Date.now()) {
  const b = body as { schema?: number; installation_id?: string; events?: unknown[] };
  if (
    !b ||
    b.schema !== 1 ||
    typeof b.installation_id !== 'string' ||
    !id.test(b.installation_id) ||
    !Array.isArray(b.events) ||
    b.events.length < 1 ||
    b.events.length > 50
  ) {
    throw new Error('invalid_batch');
  }
  // A malformed record must not strand the valid events behind it on an offline device.
  // Only syntactically valid IDs can receive a permanent rejection acknowledgement.
  if (
    !b.events.every(
      (e) =>
        e &&
        typeof e === 'object' &&
        typeof (e as Event).id === 'string' &&
        id.test((e as Event).id)
    )
  ) {
    throw new Error('invalid_event');
  }
  const valid = b.events.filter(validEvent);
  const rejected = b.events.filter((e) => !validEvent(e)).map((e) => (e as Event).id);
  const insert = db.prepare(`INSERT OR IGNORE INTO telemetry_events
    (installation_id,id,name,occurred_at,received_at,session_id,props) VALUES (?,?,?,?,?,?,?)`);
  const acknowledged = db.transaction(() => {
    for (const e of valid) {
      insert.run(
        b.installation_id,
        e.id,
        e.name,
        e.occurred_at,
        now,
        e.session_id,
        JSON.stringify(e.props)
      );
    }
    return valid.map((e) => e.id);
  })();
  return { acknowledged, rejected };
}
