#!/usr/bin/env node
'use strict';
/**
 * Hiraia CRM ingestion/read API — a private surface on hiraia.org.
 *
 * WHAT IT IS. A small Node service (same shape as the telemetry collector in /opt/hiraia-telemetry:
 * loopback port, SQLite WAL, hardened systemd unit) that nginx exposes at https://hiraia.org/api/crm/.
 * Two clients exist today: "mbp-harvestd" (writes classified summaries extracted from Luis's own
 * Messenger/Viber threads — raw message text is never sent) and "beaniebot" (read-only chat queries).
 *
 * AUTH. `Authorization: Bearer <key>`. Keys are per client; the server stores only SHA-256 digests,
 * wired in by environment variable name (HIRAIA_CRM_CLIENT_<NAME>=<scope>:sha256:<hex>, see
 * keygen.sh). Comparison is constant-time. `write` scope implies `read`.
 *
 * IDEMPOTENCY. POSTs may carry `Idempotency-Key`. The first successful response for a
 * (client, key) pair is stored and replayed verbatim for 30 days — in the SAME transaction as the
 * write, so a retried extract append cannot double-write. Reusing a key with a different body is 422.
 *
 * AUDIT. Every write (and every replay) appends an `events` row; SQL triggers forbid UPDATE/DELETE.
 *
 * LIMITS. HTTPS only (X-Forwarded-Proto from nginx), 256 KB bodies, per-client token bucket
 * (300/min, burst 60), per-IP bucket for failed auth. nginx adds its own per-IP limit and size cap.
 *
 * Nothing about a request body or a key is ever logged — the access log is one JSON line per request
 * with client name, status and latency only.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { openDatabase, migrate, migrationStatus } = require('./db.cjs');

const VERSION = '1.0.0';
const PREFIX = '/api/crm';
const STAGES = ['intro', 'pilot', 'active', 'dormant', 'unknown'];
const IDEMPOTENCY_TTL_MS = 30 * 24 * 3600 * 1000;
const LIMITS = {
  name: 200, platform: 32, alias: 200, aliases: 50, role: 200, school: 200, notes: 8000,
  app: 32, threadName: 300, sourceThread: 300, modelVersion: 100, extractedJson: 200 * 1024,
  idempotencyKey: 200, search: 200, listMax: 200, extractsMax: 100,
};

// ----------------------------------------------------------------------------------------------
// Errors
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const bad = (code, message, details) => new ApiError(400, code, message, details);

// ----------------------------------------------------------------------------------------------
// Config
function parseScope(raw) {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const scopes = new Set();
  for (const p of parts) {
    if (p === 'read') scopes.add('read');
    else if (p === 'write') { scopes.add('write'); scopes.add('read'); }
    else return null;
  }
  return scopes.size ? scopes : null;
}

/** HIRAIA_CRM_CLIENT_MBP_HARVESTD=write:sha256:<64 hex>  →  client "mbp-harvestd". */
function parseClients(env) {
  const clients = new Map();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('HIRAIA_CRM_CLIENT_') || !value) continue;
    const client = name.slice('HIRAIA_CRM_CLIENT_'.length).toLowerCase().replace(/_/g, '-');
    const m = /^([a-z,]+):sha256:([0-9a-f]{64})$/i.exec(value.trim());
    const scopes = m && parseScope(m[1].toLowerCase());
    if (!m || !scopes) throw new Error(`${name}: expected "<read|write>:sha256:<64 hex>"`);
    clients.set(client, { name: client, scopes, digest: Buffer.from(m[2].toLowerCase(), 'hex') });
  }
  return clients;
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.HIRAIA_CRM_PORT || 8137),
    host: env.HIRAIA_CRM_HOST || '127.0.0.1',
    dbPath: env.HIRAIA_CRM_DB_PATH || '/var/lib/hiraia-crm/crm.db',
    maxBody: Number(env.HIRAIA_CRM_MAX_BODY || 256 * 1024),
    allowHttp: env.HIRAIA_CRM_ALLOW_HTTP === '1',
    backupStatusPath: env.HIRAIA_CRM_BACKUP_STATUS || '/var/lib/hiraia-crm/backup-status.json',
    clientBurst: Number(env.HIRAIA_CRM_RATE_BURST || 60),
    clientPerMinute: Number(env.HIRAIA_CRM_RATE_PER_MINUTE || 300),
    clients: parseClients(env),
  };
}

// ----------------------------------------------------------------------------------------------
// Throttling (same shape as packages/web/src/server/throttle.ts: refill continuously, sweep idle)
class TokenBucket {
  constructor({ burst, perMinute, idleMs = 10 * 60_000 }) {
    this.buckets = new Map(); this.burst = burst; this.perMs = perMinute / 60_000; this.idleMs = idleMs; this.lastSweep = 0;
  }
  take(key, now = Date.now()) {
    if (now - this.lastSweep >= 60_000) {
      this.lastSweep = now;
      for (const [k, b] of this.buckets) if (now - b.updated > this.idleMs) this.buckets.delete(k);
    }
    const b = this.buckets.get(key);
    if (!b) { this.buckets.set(key, { tokens: this.burst - 1, updated: now }); return true; }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.updated) * this.perMs);
    b.updated = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

// ----------------------------------------------------------------------------------------------
// Validation helpers
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function optText(body, field, max, { lower = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;         // absent → leave unchanged
  if (typeof v !== 'string') throw bad('invalid_field', `${field} must be a string`, { field });
  let s = v.replace(/\s+/g, ' ').trim();
  if (lower) s = s.toLowerCase();
  if (s.length > max) throw bad('field_too_long', `${field} exceeds ${max} characters`, { field, max });
  return s === '' ? null : s;                                  // explicit empty string → clear
}

function reqText(body, field, max, opts) {
  const s = optText(body, field, max, opts);
  if (s === undefined || s === null) throw bad('missing_field', `${field} is required`, { field });
  return s;
}

function optIso(body, field) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms < 0 || ms > 4102444800000) throw bad('invalid_timestamp', `${field} must be an ISO 8601 timestamp`, { field });
  return new Date(ms).toISOString();
}

function optAliases(body) {
  const v = body.aliases;
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw bad('invalid_field', 'aliases must be an array of strings', { field: 'aliases' });
  if (v.length > LIMITS.aliases) throw bad('field_too_long', `aliases exceeds ${LIMITS.aliases} entries`, { field: 'aliases' });
  const out = [];
  for (const a of v) {
    if (typeof a !== 'string') throw bad('invalid_field', 'aliases must be an array of strings', { field: 'aliases' });
    const s = a.replace(/\s+/g, ' ').trim();
    if (s.length > LIMITS.alias) throw bad('field_too_long', `alias exceeds ${LIMITS.alias} characters`, { field: 'aliases' });
    if (s) out.push(s);
  }
  return out;
}

function optId(body, field, { required = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null) {
    if (required) throw bad('missing_field', `${field} is required`, { field });
    return undefined;
  }
  if (!Number.isInteger(v) || v <= 0) throw bad('invalid_field', `${field} must be a positive integer`, { field });
  return v;
}

function optBool(body, field) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw bad('invalid_field', `${field} must be true or false`, { field });
  return v;
}

function unionAliases(existing, incoming) {
  const seen = new Set(existing.map((a) => a.toLowerCase()));
  const out = [...existing];
  for (const a of incoming) if (!seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); out.push(a); }
  return out;
}

/** Deterministic JSON (sorted keys) so a retried body hashes identically regardless of key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ----------------------------------------------------------------------------------------------
// Store — all SQL lives here
class CrmStore {
  constructor(db) {
    this.db = db;
    const p = (sql) => db.prepare(sql);
    this.q = {
      contactByIdentity: p('SELECT * FROM contacts WHERE platform = ? AND name = ? COLLATE NOCASE'),
      contactById: p('SELECT * FROM contacts WHERE id = ?'),
      contactInsert: p(`INSERT INTO contacts (name, platform, aliases_json, role, school, stage, notes, first_seen, last_contact, is_test, created_at, updated_at)
                        VALUES (@name, @platform, @aliases_json, @role, @school, @stage, @notes, @first_seen, @last_contact, @is_test, @now, @now)`),
      contactUpdate: p(`UPDATE contacts SET name=@name, aliases_json=@aliases_json, role=@role, school=@school, stage=@stage, notes=@notes,
                        first_seen=@first_seen, last_contact=@last_contact, is_test=@is_test, updated_at=@now WHERE id=@id`),
      threadByIdentity: p('SELECT * FROM threads WHERE contact_id = ? AND app = ? AND thread_name = ? COLLATE NOCASE'),
      threadById: p('SELECT * FROM threads WHERE id = ?'),
      threadsByContact: p('SELECT * FROM threads WHERE contact_id = ? ORDER BY last_seen DESC NULLS LAST, id'),
      threadInsert: p(`INSERT INTO threads (contact_id, app, thread_name, last_seen, created_at, updated_at)
                       VALUES (@contact_id, @app, @thread_name, @last_seen, @now, @now)`),
      threadUpdate: p('UPDATE threads SET thread_name=@thread_name, last_seen=@last_seen, updated_at=@now WHERE id=@id'),
      extractInsert: p(`INSERT INTO extracts (contact_id, thread_id, source_thread, extracted_json, model_version, created_at)
                        VALUES (@contact_id, @thread_id, @source_thread, @extracted_json, @model_version, @now)`),
      extractById: p('SELECT * FROM extracts WHERE id = ?'),
      eventInsert: p(`INSERT INTO events (ts, source, endpoint, idempotency_key, action, entity, entity_id, request_sha256)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      idemGet: p('SELECT * FROM idempotency_keys WHERE client = ? AND key = ?'),
      idemInsert: p(`INSERT INTO idempotency_keys (client, key, endpoint, request_sha256, status, response_json, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`),
      idemPurge: p('DELETE FROM idempotency_keys WHERE created_at < ?'),
      count: Object.fromEntries(['contacts', 'threads', 'extracts', 'events', 'idempotency_keys'].map((t) => [t, p(`SELECT COUNT(*) AS n FROM ${t}`)])),
    };
    this.lastPurge = 0;
  }

  static contact(row, extra = {}) {
    if (!row) return null;
    return {
      id: row.id, name: row.name, platform: row.platform, aliases: JSON.parse(row.aliases_json), role: row.role,
      school: row.school, stage: row.stage, notes: row.notes, first_seen: row.first_seen, last_contact: row.last_contact,
      is_test: row.is_test === 1, created_at: row.created_at, updated_at: row.updated_at, ...extra,
    };
  }
  static thread(row) {
    return row && { id: row.id, contact_id: row.contact_id, app: row.app, thread_name: row.thread_name, last_seen: row.last_seen, created_at: row.created_at, updated_at: row.updated_at };
  }
  static extract(row) {
    return row && { id: row.id, contact_id: row.contact_id, thread_id: row.thread_id, source_thread: row.source_thread, extracted_json: JSON.parse(row.extracted_json), model_version: row.model_version, created_at: row.created_at };
  }

  /** Upsert by (platform, name). Returns {status, body, action, entity, entityId}. */
  upsertContact(input, now) {
    const existing = this.q.contactByIdentity.get(input.platform, input.name);
    if (!existing) {
      const r = this.q.contactInsert.run({
        name: input.name, platform: input.platform, aliases_json: JSON.stringify(input.aliases || []),
        role: input.role ?? null, school: input.school ?? null, stage: input.stage || 'unknown', notes: input.notes ?? null,
        first_seen: input.first_seen ?? null, last_contact: input.last_contact ?? null, is_test: input.is_test ? 1 : 0, now,
      });
      const id = Number(r.lastInsertRowid);
      return { status: 201, body: { id, created: true, changed: true, contact: CrmStore.contact(this.q.contactById.get(id)) }, action: 'created', entity: 'contacts', entityId: id };
    }
    const pick = (field) => (input[field] === undefined ? existing[field] : input[field]);
    const minIso = (a, b) => (a && b ? (a < b ? a : b) : a || b || null);
    const maxIso = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);
    const next = {
      id: existing.id, name: input.name,
      aliases_json: JSON.stringify(input.aliases ? unionAliases(JSON.parse(existing.aliases_json), input.aliases) : JSON.parse(existing.aliases_json)),
      role: pick('role'), school: pick('school'), stage: input.stage || existing.stage, notes: pick('notes'),
      first_seen: minIso(existing.first_seen, input.first_seen), last_contact: maxIso(existing.last_contact, input.last_contact),
      is_test: input.is_test === undefined ? existing.is_test : input.is_test ? 1 : 0, now,
    };
    const changed = ['name', 'aliases_json', 'role', 'school', 'stage', 'notes', 'first_seen', 'last_contact', 'is_test'].some((f) => next[f] !== existing[f]);
    if (changed) this.q.contactUpdate.run(next);
    return {
      status: 200, body: { id: existing.id, created: false, changed, contact: CrmStore.contact(this.q.contactById.get(existing.id)) },
      action: changed ? 'updated' : 'unchanged', entity: 'contacts', entityId: existing.id,
    };
  }

  upsertThread(input, now) {
    if (!this.q.contactById.get(input.contact_id)) throw new ApiError(422, 'unknown_contact', `contact ${input.contact_id} does not exist`, { field: 'contact_id' });
    const existing = this.q.threadByIdentity.get(input.contact_id, input.app, input.thread_name);
    if (!existing) {
      const r = this.q.threadInsert.run({ contact_id: input.contact_id, app: input.app, thread_name: input.thread_name, last_seen: input.last_seen ?? null, now });
      const id = Number(r.lastInsertRowid);
      return { status: 201, body: { id, created: true, changed: true, thread: CrmStore.thread(this.q.threadById.get(id)) }, action: 'created', entity: 'threads', entityId: id };
    }
    const last_seen = existing.last_seen && input.last_seen ? (existing.last_seen > input.last_seen ? existing.last_seen : input.last_seen) : input.last_seen || existing.last_seen || null;
    const changed = last_seen !== existing.last_seen || input.thread_name !== existing.thread_name;
    if (changed) this.q.threadUpdate.run({ id: existing.id, thread_name: input.thread_name, last_seen, now });
    return {
      status: 200, body: { id: existing.id, created: false, changed, thread: CrmStore.thread(this.q.threadById.get(existing.id)) },
      action: changed ? 'updated' : 'unchanged', entity: 'threads', entityId: existing.id,
    };
  }

  appendExtract(input, now) {
    if (!this.q.contactById.get(input.contact_id)) throw new ApiError(422, 'unknown_contact', `contact ${input.contact_id} does not exist`, { field: 'contact_id' });
    if (input.thread_id !== undefined) {
      const t = this.q.threadById.get(input.thread_id);
      if (!t || t.contact_id !== input.contact_id) throw new ApiError(422, 'unknown_thread', `thread ${input.thread_id} does not belong to contact ${input.contact_id}`, { field: 'thread_id' });
    }
    const r = this.q.extractInsert.run({
      contact_id: input.contact_id, thread_id: input.thread_id ?? null, source_thread: input.source_thread ?? null,
      extracted_json: JSON.stringify(input.extracted_json), model_version: input.model_version ?? null, now,
    });
    const id = Number(r.lastInsertRowid);
    return { status: 201, body: { id, created: true, extract: CrmStore.extract(this.q.extractById.get(id)) }, action: 'appended', entity: 'extracts', entityId: id };
  }

  listContacts(f) {
    const where = [];
    const params = [];
    if (f.stage) { where.push('c.stage = ?'); params.push(f.stage); }
    if (f.platform) { where.push('c.platform = ?'); params.push(f.platform); }
    if (f.quietCutoff) { where.push('(c.last_contact IS NULL OR c.last_contact < ?)'); params.push(f.quietCutoff); }
    if (f.search) {
      const like = `%${likeEscape(f.search)}%`;
      where.push("(c.name LIKE ? ESCAPE '\\' OR c.aliases_json LIKE ? ESCAPE '\\' OR c.school LIKE ? ESCAPE '\\' OR c.role LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like, like);
    }
    if (!f.includeTest) where.push('c.is_test = 0');
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${sqlWhere}`).get(...params).n;
    const rows = this.db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM threads t WHERE t.contact_id = c.id) AS thread_count,
        (SELECT COUNT(*) FROM extracts e WHERE e.contact_id = c.id) AS extract_count,
        (SELECT MAX(e.created_at) FROM extracts e WHERE e.contact_id = c.id) AS last_extract_at
      FROM contacts c ${sqlWhere}
      ORDER BY c.last_contact DESC NULLS LAST, c.name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset);
    return {
      contacts: rows.map((r) => CrmStore.contact(r, { thread_count: r.thread_count, extract_count: r.extract_count, last_extract_at: r.last_extract_at })),
      total, limit: f.limit, offset: f.offset,
    };
  }

  getContact(id, extractsLimit) {
    const row = this.q.contactById.get(id);
    if (!row) return null;
    const extracts = this.db.prepare('SELECT * FROM extracts WHERE contact_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(id, extractsLimit);
    return { contact: CrmStore.contact(row), threads: this.q.threadsByContact.all(id).map(CrmStore.thread), extracts: extracts.map(CrmStore.extract) };
  }

  listExtracts(f) {
    const where = [];
    const params = [];
    if (f.contactId) { where.push('e.contact_id = ?'); params.push(f.contactId); }
    if (f.since) { where.push('e.created_at >= ?'); params.push(f.since); }
    if (!f.includeTest) where.push('c.is_test = 0');
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT e.* FROM extracts e JOIN contacts c ON c.id = e.contact_id ${sqlWhere} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM extracts e JOIN contacts c ON c.id = e.contact_id ${sqlWhere}`).get(...params).n;
    return { extracts: rows.map(CrmStore.extract), total, limit: f.limit, offset: f.offset };
  }

  counts() {
    return Object.fromEntries(Object.entries(this.q.count).map(([t, stmt]) => [t, stmt.get().n]));
  }

  /**
   * Run `fn` (which performs the write and returns {status, body, action, entity, entityId}) under
   * idempotency: replay a stored response for the same (client, key); otherwise execute, audit and
   * store — all in one transaction, so a crash between the write and the receipt cannot happen.
   */
  withIdempotency({ client, key, endpoint, requestSha256, now }, fn) {
    return this.db.transaction(() => {
      if (key) {
        const row = this.q.idemGet.get(client, key);
        if (row) {
          if (row.request_sha256 !== requestSha256 || row.endpoint !== endpoint) {
            throw new ApiError(422, 'idempotency_key_reused', 'Idempotency-Key was already used with a different request', { first_seen_at: row.created_at, endpoint: row.endpoint });
          }
          this.q.eventInsert.run(now, client, endpoint, key, 'replayed', null, null, requestSha256);
          return { status: row.status, body: JSON.parse(row.response_json), replayed: true };
        }
      }
      const r = fn();
      this.q.eventInsert.run(now, client, endpoint, key || null, r.action, r.entity, r.entityId, requestSha256);
      if (key) this.q.idemInsert.run(client, key, endpoint, requestSha256, r.status, JSON.stringify(r.body), now);
      return { status: r.status, body: r.body, replayed: false };
    })();
  }

  purgeIdempotency(nowMs = Date.now()) {
    if (nowMs - this.lastPurge < 3600_000) return 0;
    this.lastPurge = nowMs;
    return this.q.idemPurge.run(new Date(nowMs - IDEMPOTENCY_TTL_MS).toISOString()).changes;
  }
}

// ----------------------------------------------------------------------------------------------
// Request parsing
function parseContactBody(body) {
  const out = {
    name: reqText(body, 'name', LIMITS.name),
    platform: reqText(body, 'platform', LIMITS.platform, { lower: true }),
    aliases: optAliases(body),
    role: optText(body, 'role', LIMITS.role),
    school: optText(body, 'school', LIMITS.school),
    notes: optText(body, 'notes', LIMITS.notes),
    first_seen: optIso(body, 'first_seen'),
    last_contact: optIso(body, 'last_contact'),
    is_test: optBool(body, 'is_test'),
  };
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(out.platform)) throw bad('invalid_field', 'platform must be a short lower-case identifier (e.g. messenger, viber)', { field: 'platform' });
  const stage = optText(body, 'stage', 16, { lower: true });
  if (stage !== undefined && stage !== null) {
    if (!STAGES.includes(stage)) throw bad('invalid_field', `stage must be one of ${STAGES.join(', ')}`, { field: 'stage' });
    out.stage = stage;
  }
  return out;
}

function parseThreadBody(body) {
  const out = {
    contact_id: optId(body, 'contact_id', { required: true }),
    app: reqText(body, 'app', LIMITS.app, { lower: true }),
    thread_name: reqText(body, 'thread_name', LIMITS.threadName),
    last_seen: optIso(body, 'last_seen'),
  };
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(out.app)) throw bad('invalid_field', 'app must be a short lower-case identifier (e.g. messenger, viber)', { field: 'app' });
  return out;
}

function parseExtractBody(body) {
  if (!isPlainObject(body.extracted_json)) throw bad('invalid_field', 'extracted_json must be a JSON object', { field: 'extracted_json' });
  const serialized = JSON.stringify(body.extracted_json);
  if (Buffer.byteLength(serialized) > LIMITS.extractedJson) throw bad('field_too_long', `extracted_json exceeds ${LIMITS.extractedJson} bytes`, { field: 'extracted_json' });
  return {
    contact_id: optId(body, 'contact_id', { required: true }),
    thread_id: optId(body, 'thread_id'),
    source_thread: optText(body, 'source_thread', LIMITS.sourceThread),
    extracted_json: body.extracted_json,
    model_version: optText(body, 'model_version', LIMITS.modelVersion),
  };
}

function intParam(params, name, { min, max, dflt }) {
  const raw = params.get(name);
  if (raw === null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw bad('invalid_query', `${name} must be an integer between ${min} and ${max}`, { param: name });
  return n;
}

function parseListQuery(params, now) {
  const f = {
    limit: intParam(params, 'limit', { min: 1, max: LIMITS.listMax, dflt: 50 }),
    offset: intParam(params, 'offset', { min: 0, max: 1_000_000, dflt: 0 }),
    includeTest: params.get('include_test') === '1' || params.get('include_test') === 'true',
  };
  const stage = params.get('stage');
  if (stage) {
    if (!STAGES.includes(stage.toLowerCase())) throw bad('invalid_query', `stage must be one of ${STAGES.join(', ')}`, { param: 'stage' });
    f.stage = stage.toLowerCase();
  }
  const platform = params.get('platform');
  if (platform) f.platform = platform.toLowerCase().trim();
  const quiet = intParam(params, 'quiet_for_days', { min: 0, max: 36500, dflt: undefined });
  if (quiet !== undefined) f.quietCutoff = new Date(Date.parse(now) - quiet * 86400_000).toISOString();
  const search = params.get('search');
  if (search) {
    const s = search.replace(/\s+/g, ' ').trim();
    if (s.length > LIMITS.search) throw bad('invalid_query', `search exceeds ${LIMITS.search} characters`, { param: 'search' });
    if (s) f.search = s;
  }
  return f;
}

function parseExtractsQuery(params) {
  const f = {
    limit: intParam(params, 'limit', { min: 1, max: LIMITS.extractsMax, dflt: 20 }),
    offset: intParam(params, 'offset', { min: 0, max: 1_000_000, dflt: 0 }),
    includeTest: params.get('include_test') === '1' || params.get('include_test') === 'true',
    contactId: intParam(params, 'contact_id', { min: 1, max: Number.MAX_SAFE_INTEGER, dflt: undefined }),
  };
  const since = params.get('since');
  if (since) {
    const ms = Date.parse(since);
    if (!Number.isFinite(ms)) throw bad('invalid_query', 'since must be an ISO 8601 timestamp', { param: 'since' });
    f.since = new Date(ms).toISOString();
  }
  return f;
}

async function readJsonBody(req, maxBody) {
  const ctype = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json') throw new ApiError(415, 'json_required', 'Send application/json');
  if (Number(req.headers['content-length']) > maxBody) throw new ApiError(413, 'payload_too_large', `Body exceeds ${maxBody} bytes`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw new ApiError(413, 'payload_too_large', `Body exceeds ${maxBody} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) throw bad('empty_body', 'Request body is empty');
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('invalid_json', 'Body is not valid JSON'); }
  if (!isPlainObject(parsed)) throw bad('invalid_json', 'Body must be a JSON object');
  return parsed;
}

function idempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return null;
  const key = String(raw).trim();
  if (!key || key.length > LIMITS.idempotencyKey || !/^[\x21-\x7e]+$/.test(key)) throw bad('invalid_idempotency_key', `Idempotency-Key must be 1-${LIMITS.idempotencyKey} printable ASCII characters`);
  return key;
}

// ----------------------------------------------------------------------------------------------
// Auth
function authenticate(req, cfg) {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  const digest = crypto.createHash('sha256').update(m[1]).digest();
  let found = null;
  for (const client of cfg.clients.values()) {
    // Compare against every client so timing does not reveal which name matched.
    if (crypto.timingSafeEqual(digest, client.digest)) found = client;
  }
  return found;
}

// ----------------------------------------------------------------------------------------------
// Server
function createCrmServer(options = {}) {
  const cfg = options.config || loadConfig(options.env || process.env);
  const db = openDatabase(cfg.dbPath);
  const applied = migrate(db);
  const store = new CrmStore(db);
  const clientBucket = new TokenBucket({ burst: cfg.clientBurst, perMinute: cfg.clientPerMinute });
  const authFailBucket = new TokenBucket({ burst: 30, perMinute: 60 });
  const startedAt = Date.now();
  const log = options.log || ((line) => process.stdout.write(`${JSON.stringify(line)}\n`));

  function readBackupStatus() {
    try { return JSON.parse(fs.readFileSync(cfg.backupStatusPath, 'utf8')); } catch { return null; }
  }

  function send(res, status, body, headers = {}) {
    const payload = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length, 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  async function route(req, res, ctx) {
    const url = new URL(req.url, 'http://crm.local');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const now = new Date().toISOString();

    if (pathname === `${PREFIX}/health`) {
      if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      db.prepare('SELECT 1').get();
      return send(res, 200, { ok: true });
    }
    if (!pathname.startsWith(`${PREFIX}/`)) throw new ApiError(404, 'not_found');
    if (!cfg.allowHttp && req.headers['x-forwarded-proto'] !== 'https') throw new ApiError(403, 'https_required', 'This API is served over HTTPS only');

    const client = authenticate(req, cfg);
    if (!client) {
      if (!authFailBucket.take(ctx.ip)) throw new ApiError(429, 'rate_limited', 'Too many failed authentications', { retry_after: 60 });
      throw new ApiError(401, 'unauthorized', 'Missing or invalid bearer key');
    }
    ctx.client = client.name;
    if (!clientBucket.take(client.name)) throw new ApiError(429, 'rate_limited', `Client exceeded ${cfg.clientPerMinute} requests/minute`, { retry_after: 10 });

    const need = req.method === 'GET' ? 'read' : req.method === 'POST' ? 'write' : null;
    if (!need) throw new ApiError(405, 'method_not_allowed');
    if (!client.scopes.has(need)) throw new ApiError(403, 'forbidden', `This key lacks the ${need} scope`, { scope: need });

    const rest = pathname.slice(PREFIX.length);
    if (req.method === 'POST') {
      const kind = { '/contacts': 'contacts', '/threads': 'threads', '/extracts': 'extracts' }[rest];
      if (!kind) throw new ApiError(404, 'not_found');
      const key = idempotencyKey(req);
      const body = await readJsonBody(req, cfg.maxBody);
      const input = kind === 'contacts' ? parseContactBody(body) : kind === 'threads' ? parseThreadBody(body) : parseExtractBody(body);
      const endpoint = `POST ${PREFIX}${rest}`;
      const requestSha256 = sha256(`${endpoint}\n${canonical(body)}`);
      const result = store.withIdempotency({ client: client.name, key, endpoint, requestSha256, now }, () =>
        kind === 'contacts' ? store.upsertContact(input, now) : kind === 'threads' ? store.upsertThread(input, now) : store.appendExtract(input, now)
      );
      store.purgeIdempotency();
      return send(res, result.status, result.body, result.replayed ? { 'Idempotent-Replayed': 'true' } : {});
    }

    // GET
    if (rest === '/contacts') return send(res, 200, store.listContacts(parseListQuery(url.searchParams, now)));
    const m = /^\/contacts\/(\d{1,15})$/.exec(rest);
    if (m) {
      const extractsLimit = intParam(url.searchParams, 'extracts_limit', { min: 0, max: LIMITS.extractsMax, dflt: 20 });
      const found = store.getContact(Number(m[1]), extractsLimit);
      if (!found) throw new ApiError(404, 'not_found', `contact ${m[1]} does not exist`);
      return send(res, 200, found);
    }
    if (rest === '/extracts') return send(res, 200, store.listExtracts(parseExtractsQuery(url.searchParams)));
    if (rest === '/status') {
      const backup = readBackupStatus();
      const lastOk = backup?.last_ok_at ? Date.parse(backup.last_ok_at) : NaN;
      return send(res, 200, {
        ok: true, version: VERSION, uptime_s: Math.round((Date.now() - startedAt) / 1000), counts: store.counts(),
        migrations: migrationStatus(db).filter((x) => x.applied_at).length,
        backup: backup ? { ...backup, stale: !Number.isFinite(lastOk) || Date.now() - lastOk > 36 * 3600_000 } : { configured: false, stale: true },
      });
    }
    throw new ApiError(404, 'not_found');
  }

  const server = http.createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, async (req, res) => {
    const started = process.hrtime.bigint();
    const id = crypto.randomBytes(6).toString('hex');
    const fwd = req.headers['x-forwarded-for'];
    const ctx = { ip: (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',').pop()?.trim() || req.socket.remoteAddress || 'unknown', client: null };
    res.setHeader('X-Request-Id', id);
    try {
      await route(req, res, ctx);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (!e) log({ ts: new Date().toISOString(), id, level: 'error', message: String(err && err.stack || err) });
      const status = e ? e.status : 500;
      const headers = {};
      if (status === 401) headers['WWW-Authenticate'] = 'Bearer realm="hiraia-crm"';
      if (status === 429) headers['Retry-After'] = String(e.details?.retry_after || 60);
      if (!res.headersSent) send(res, status, e ? { error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } : { error: 'internal_error' }, headers);
      else res.destroy();
    } finally {
      log({ ts: new Date().toISOString(), id, client: ctx.client, ip: ctx.ip, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6 });
    }
  });
  server.maxConnections = 200;
  server.keepAliveTimeout = 15_000;

  return {
    server, db, store, cfg, applied,
    listen: () => new Promise((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { server.closeIdleConnections?.(); server.close(() => { db.close(); resolve(); }); }),
  };
}

module.exports = { createCrmServer, loadConfig, parseClients, CrmStore, ApiError, canonical, sha256, VERSION, STAGES, LIMITS };

if (require.main === module) {
  const app = createCrmServer();
  if (app.cfg.clients.size === 0) process.stderr.write('hiraia-crm: WARNING no clients configured (HIRAIA_CRM_CLIENT_*); every request will be rejected\n');
  app.listen().then((addr) => {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: `hiraia-crm ${VERSION} listening on ${addr.address}:${addr.port}`, clients: [...app.cfg.clients.keys()], migrations_applied: app.applied })}\n`);
  });
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
