import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const EVENTS = [
  'first_open',
  'profile_updated',
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
  'hiraiapedia_version',
  'cards_db_version',
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
  profile_kind: ['guest', 'student'],
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
  if (
    e.props.profile_kind === 'student' &&
    (typeof e.props.profile_id !== 'string' || !id.test(e.props.profile_id))
  )
    return false;
  if (e.props.profile_id !== undefined && e.props.profile_kind !== 'student') return false;
  return Object.entries(e.props).every(([k, v]) => {
    if (k === 'profile_id') return typeof v === 'string' && id.test(v);
    if (strings.has(k)) return typeof v === 'string' && label.test(v);
    if (Object.hasOwn(enums, k)) return typeof v === 'string' && enums[k]!.includes(v);
    if (k === 'grade') return typeof v === 'number' && Number.isInteger(v) && v >= 3 && v <= 10;
    if (numbers.has(k)) return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
    return k === 'correct' && typeof v === 'boolean';
  });
}
export function openTelemetry(filename: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 3000');
  db.exec(`CREATE TABLE IF NOT EXISTS telemetry_events (
    installation_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
    occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, session_id TEXT NOT NULL,
    props TEXT NOT NULL, PRIMARY KEY (installation_id, id)
  );
  CREATE INDEX IF NOT EXISTS telemetry_time ON telemetry_events(occurred_at);
  CREATE INDEX IF NOT EXISTS telemetry_name_time ON telemetry_events(name, occurred_at);
  CREATE INDEX IF NOT EXISTS telemetry_session ON telemetry_events(installation_id,session_id,occurred_at);
  CREATE INDEX IF NOT EXISTS telemetry_received ON telemetry_events(received_at);
  CREATE TABLE IF NOT EXISTS telemetry_deliveries (
    installation_id TEXT NOT NULL, event_id TEXT NOT NULL,
    reporter_app TEXT NOT NULL, reporter_id TEXT NOT NULL, reporter_version TEXT NOT NULL,
    received_at INTEGER NOT NULL, reconstructed INTEGER NOT NULL,
    PRIMARY KEY(installation_id,event_id,reporter_app,reporter_id));
  CREATE INDEX IF NOT EXISTS telemetry_deliveries_reporter ON telemetry_deliveries(reporter_app,reporter_id);`);
  return db;
}
let singleton: Database.Database | undefined;
export function getTelemetry() {
  return (singleton ??= openTelemetry(
    process.env.HIRAIA_TELEMETRY_DB_PATH || path.resolve(process.cwd(), '../../data/telemetry.db')
  ));
}
export function ingest(db: Database.Database, body: unknown, now = Date.now()) {
  const b = body as {
    schema?: number;
    installation_id?: string;
    events?: unknown[];
    reporter?: unknown;
    reconstructed_ids?: unknown;
  };
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
  // Delivery identity is separate from event ownership. A teacher forwards the
  // student's original IDs, so direct + relayed uploads still count as one event.
  // This is client-declared provenance, not teacher authentication.
  let reporter = { app: 'hiraia', installation_id: b.installation_id, version: '' };
  if (b.reporter !== undefined) {
    const r = b.reporter as typeof reporter;
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      Object.keys(r).some((k) => !['app', 'installation_id', 'version'].includes(k)) ||
      !['hiraia', 'tala'].includes(r.app) ||
      typeof r.installation_id !== 'string' ||
      !id.test(r.installation_id) ||
      typeof r.version !== 'string' ||
      !label.test(r.version) ||
      (r.app === 'hiraia' && r.installation_id !== b.installation_id)
    )
      throw new Error('invalid_batch');
    reporter = r;
  }
  const reconstructed = b.reconstructed_ids ?? [];
  if (
    !Array.isArray(reconstructed) ||
    reconstructed.length > 50 ||
    (reconstructed.length > 0 && reporter.app !== 'tala') ||
    !reconstructed.every(
      (x) => typeof x === 'string' && b.events!.some((e) => (e as Event)?.id === x)
    )
  )
    throw new Error('invalid_batch');
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
  const receipt = db.prepare(`INSERT OR IGNORE INTO telemetry_deliveries
    (installation_id,event_id,reporter_app,reporter_id,reporter_version,received_at,reconstructed)
    VALUES(?,?,?,?,?,?,?)`);
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
      receipt.run(
        b.installation_id,
        e.id,
        reporter.app,
        reporter.installation_id,
        reporter.version,
        now,
        reconstructed.includes(e.id) ? 1 : 0
      );
    }
    return valid.map((e) => e.id);
  })();
  return {
    acknowledged,
    rejected,
    ...(reporter.app === 'tala' ? { reporter_recorded: true } : {}),
  };
}
