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

const VERSION = '1.2.0';
const PREFIX = '/api/crm';
const STAGES = ['intro', 'pilot', 'active', 'dormant', 'unknown'];
// Optional embeds for GET /contacts (`include=threads,latest_extract,contact_points`): one consistent
// read instead of a GET /contacts/:id round trip per contact. Phones and e-mail addresses are only
// returned when asked for, on the list and on GET /contacts/:id alike.
const LIST_INCLUDES = ['threads', 'latest_extract', 'contact_points'];
const DETAIL_INCLUDES = ['contact_points'];
const PROFILE_FIELDS = ['organization', 'department', 'job_title', 'location'];
const POINT_KINDS = { phones: 'phone', emails: 'email' };
const QUALITIES = ['exact', 'approximate'];
const BASES = ['message_timestamp', 'relative_label', 'first_observed'];
const CONVERSATION_KINDS = ['direct', 'group'];
const DIRECTIONS = ['incoming', 'outgoing', 'unknown'];
// Earliest believable message time (Facebook's launch); later bound is "now + 1 day" for clock skew.
const EARLIEST_MESSAGE_MS = Date.UTC(2004, 1, 4);
const IDEMPOTENCY_TTL_MS = 30 * 24 * 3600 * 1000;
const LIMITS = {
  name: 200, platform: 32, alias: 200, aliases: 50, role: 200, school: 200, notes: 8000,
  app: 32, threadName: 300, sourceThread: 300, modelVersion: 100, extractedJson: 200 * 1024,
  idempotencyKey: 200, search: 200, listMax: 200, extractsMax: 100,
  profileField: 200, source: 64, sourceRef: 300, pointLabel: 40, pointsPerKind: 20, email: 254, evidenceKey: 128,
};
// Stronger evidence sorts first: earlier time, then exact before approximate, then basis strength.
const EVIDENCE_ORDER = `e.first_message_at ASC, CASE e.quality WHEN 'exact' THEN 0 ELSE 1 END,
  CASE e.basis WHEN 'message_timestamp' THEN 0 WHEN 'relative_label' THEN 1 ELSE 2 END, e.id ASC`;
// Every contact view carries its profile and its derived first contact.
const CONTACT_COLUMNS = `c.*,
  p.organization, p.organization_source, p.department, p.department_source,
  p.job_title, p.job_title_source, p.location, p.location_source,
  fc.first_message_at AS fc_at, fc.quality AS fc_quality, fc.basis AS fc_basis, fc.platform AS fc_platform,
  fc.thread_id AS fc_thread_id, fc.conversation_kind AS fc_kind`;
const CONTACT_JOINS = `LEFT JOIN contact_profiles p ON p.contact_id = c.id
  LEFT JOIN first_message_evidence fc ON fc.id = (
    SELECT e.id FROM first_message_evidence e WHERE e.contact_id = c.id ORDER BY ${EVIDENCE_ORDER} LIMIT 1)`;
const THREAD_COLUMNS = `t.*, fm.first_message_at AS fm_at, fm.quality AS fm_quality, fm.basis AS fm_basis`;
const THREAD_JOINS = `LEFT JOIN first_message_evidence fm ON fm.id = (
    SELECT e.id FROM first_message_evidence e WHERE e.thread_id = t.id ORDER BY ${EVIDENCE_ORDER} LIMIT 1)`;

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

const SOURCE_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
function optSource(body, field) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !SOURCE_RE.test(v.trim().toLowerCase())) {
    throw bad('invalid_field', `${field} must be a short lower-case identifier (e.g. manual_note, google_contacts)`, { field });
  }
  return v.trim().toLowerCase();
}

/** Formatting is dropped; a leading + (or 00) is kept as the international prefix. Region-agnostic. */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/[\s  ().\-–]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+?\d{7,15}$/.test(s) ? s : null;
}
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return s.length <= LIMITS.email && /^[^\s@<>()[\],;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : null;
}

/** phones/emails: [{value, label?, primary?, source?, source_ref?, remove?}] or bare strings. */
function optPoints(body, field) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  const kind = POINT_KINDS[field];
  if (!Array.isArray(v)) throw bad('invalid_field', `${field} must be an array`, { field });
  if (v.length > LIMITS.pointsPerKind) throw bad('field_too_long', `${field} exceeds ${LIMITS.pointsPerKind} entries`, { field });
  const byValue = new Map();
  for (const entry of v) {
    const item = typeof entry === 'string' ? { value: entry } : entry;
    if (!isPlainObject(item)) throw bad('invalid_field', `${field} entries must be objects or strings`, { field });
    const value = kind === 'phone' ? normalizePhone(item.value) : normalizeEmail(item.value);
    if (!value) throw bad('invalid_field', `${field} has an invalid ${kind}`, { field });
    const label = optText(item, 'label', LIMITS.pointLabel);
    const sourceRef = optText(item, 'source_ref', LIMITS.sourceRef);
    for (const flag of ['primary', 'remove']) {
      if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw bad('invalid_field', `${field}.${flag} must be true or false`, { field });
    }
    byValue.set(value, { kind, value, label, primary: item.primary, source: optSource(item, 'source'), source_ref: sourceRef, remove: item.remove === true });
  }
  return [...byValue.values()];
}

/** A plausible message time: not before 2004-02-04, not more than a day in the future. */
function reqMessageTime(body, field, nowIso) {
  const iso = optIso(body, field);
  if (iso === undefined) throw bad('missing_field', `${field} is required`, { field });
  const ms = Date.parse(iso);
  if (ms < EARLIEST_MESSAGE_MS || ms > Date.parse(nowIso) + 86400_000) {
    throw bad('invalid_timestamp', `${field} is outside the plausible message range`, { field });
  }
  return iso;
}

function reqEnum(body, field, allowed, dflt) {
  const v = body[field] === undefined || body[field] === null ? dflt : body[field];
  if (v === undefined) throw bad('missing_field', `${field} is required`, { field });
  if (typeof v !== 'string' || !allowed.includes(v)) throw bad('invalid_field', `${field} must be one of ${allowed.join(', ')}`, { field });
  return v;
}

/** Is evidence a strictly better than b? Earlier wins; at the same instant, stronger evidence wins. */
function strongerEvidence(a, b) {
  if (a.first_message_at !== b.first_message_at) return a.first_message_at < b.first_message_at;
  const rank = (e) => (e.quality === 'exact' ? 0 : 10) + BASES.indexOf(e.basis);
  return rank(a) < rank(b);
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
      contactViewById: p(`SELECT ${CONTACT_COLUMNS} FROM contacts c ${CONTACT_JOINS} WHERE c.id = ?`),
      profileByContact: p('SELECT * FROM contact_profiles WHERE contact_id = ?'),
      profileUpsert: p(`INSERT INTO contact_profiles (contact_id, organization, organization_source, department, department_source,
                          job_title, job_title_source, location, location_source, updated_at)
                        VALUES (@contact_id, @organization, @organization_source, @department, @department_source,
                          @job_title, @job_title_source, @location, @location_source, @now)
                        ON CONFLICT(contact_id) DO UPDATE SET organization=excluded.organization, organization_source=excluded.organization_source,
                          department=excluded.department, department_source=excluded.department_source, job_title=excluded.job_title,
                          job_title_source=excluded.job_title_source, location=excluded.location, location_source=excluded.location_source,
                          updated_at=excluded.updated_at`),
      pointsByContact: p('SELECT * FROM contact_points WHERE contact_id = ? ORDER BY kind, is_primary DESC, id'),
      pointsForContacts: p(`SELECT * FROM contact_points WHERE contact_id IN (SELECT value FROM json_each(?))
                            ORDER BY contact_id, kind, is_primary DESC, id`),
      pointByIdentity: p('SELECT * FROM contact_points WHERE contact_id = ? AND kind = ? AND value = ?'),
      pointInsert: p(`INSERT INTO contact_points (contact_id, kind, value, label, is_primary, source, source_ref, created_at, updated_at)
                      VALUES (@contact_id, @kind, @value, @label, @is_primary, @source, @source_ref, @now, @now)`),
      pointUpdate: p('UPDATE contact_points SET label=@label, is_primary=@is_primary, source=@source, source_ref=@source_ref, updated_at=@now WHERE id=@id'),
      pointDelete: p('DELETE FROM contact_points WHERE id = ?'),
      pointClearPrimary: p('UPDATE contact_points SET is_primary = 0, updated_at = ? WHERE contact_id = ? AND kind = ? AND id <> ? AND is_primary = 1'),
      evidenceByKey: p('SELECT * FROM first_message_evidence WHERE contact_id = ? AND evidence_key = ?'),
      evidenceById: p('SELECT * FROM first_message_evidence WHERE id = ?'),
      evidenceInsert: p(`INSERT INTO first_message_evidence (contact_id, thread_id, evidence_key, platform, conversation_kind, first_message_at,
                           quality, basis, direction, source, recorded_at, updated_at)
                         VALUES (@contact_id, @thread_id, @evidence_key, @platform, @conversation_kind, @first_message_at,
                           @quality, @basis, @direction, @source, @now, @now)`),
      evidenceUpdate: p(`UPDATE first_message_evidence SET thread_id=@thread_id, first_message_at=@first_message_at, quality=@quality,
                           basis=@basis, direction=@direction, source=@source, updated_at=@now WHERE id=@id`),
      contactInsert: p(`INSERT INTO contacts (name, platform, aliases_json, role, school, stage, notes, first_seen, last_contact, is_test, created_at, updated_at)
                        VALUES (@name, @platform, @aliases_json, @role, @school, @stage, @notes, @first_seen, @last_contact, @is_test, @now, @now)`),
      contactUpdate: p(`UPDATE contacts SET name=@name, aliases_json=@aliases_json, role=@role, school=@school, stage=@stage, notes=@notes,
                        first_seen=@first_seen, last_contact=@last_contact, is_test=@is_test, updated_at=@now WHERE id=@id`),
      threadByIdentity: p('SELECT * FROM threads WHERE contact_id = ? AND app = ? AND thread_name = ? COLLATE NOCASE'),
      threadById: p('SELECT * FROM threads WHERE id = ?'),
      threadsByContact: p(`SELECT ${THREAD_COLUMNS} FROM threads t ${THREAD_JOINS} WHERE t.contact_id = ? ORDER BY t.last_seen DESC NULLS LAST, t.id`),
      // Same per-contact order as threadsByContact, for a page of contact ids (a JSON array).
      threadsForContacts: p(`SELECT ${THREAD_COLUMNS} FROM threads t ${THREAD_JOINS} WHERE t.contact_id IN (SELECT value FROM json_each(?))
                             ORDER BY t.contact_id, t.last_seen DESC NULLS LAST, t.id`),
      // The newest extract per contact, with getContact()'s ordering (created_at DESC, id DESC).
      latestExtractsForContacts: p(`SELECT * FROM (
                                      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.contact_id ORDER BY e.created_at DESC, e.id DESC) AS rn
                                      FROM extracts e WHERE e.contact_id IN (SELECT value FROM json_each(?))
                                    ) WHERE rn = 1`),
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
      threadViewById: p(`SELECT ${THREAD_COLUMNS} FROM threads t ${THREAD_JOINS} WHERE t.id = ?`),
      count: Object.fromEntries(['contacts', 'threads', 'extracts', 'events', 'idempotency_keys', 'contact_profiles', 'contact_points', 'first_message_evidence']
        .map((t) => [t, p(`SELECT COUNT(*) AS n FROM ${t}`)])),
    };
    this.lastPurge = 0;
  }

  /** Rows from CONTACT_COLUMNS carry the profile and the derived first contact; bare rows read as empty. */
  static contact(row, extra = {}) {
    if (!row) return null;
    const v = (k) => (row[k] === undefined ? null : row[k]);
    return {
      id: row.id, name: row.name, platform: row.platform, aliases: JSON.parse(row.aliases_json), role: row.role,
      school: row.school, stage: row.stage, notes: row.notes, first_seen: row.first_seen, last_contact: row.last_contact,
      is_test: row.is_test === 1, created_at: row.created_at, updated_at: row.updated_at,
      organization: v('organization'), organization_source: v('organization_source'), department: v('department'),
      department_source: v('department_source'), job_title: v('job_title'), job_title_source: v('job_title_source'),
      location: v('location'), location_source: v('location_source'),
      first_contact: v('fc_at'), first_contact_quality: v('fc_quality'), first_contact_basis: v('fc_basis'),
      first_contact_platform: v('fc_platform'), first_contact_thread_id: v('fc_thread_id'), first_contact_conversation_kind: v('fc_kind'),
      ...extra,
    };
  }
  static thread(row) {
    const v = (k) => (row[k] === undefined ? null : row[k]);
    return row && {
      id: row.id, contact_id: row.contact_id, app: row.app, thread_name: row.thread_name, last_seen: row.last_seen,
      created_at: row.created_at, updated_at: row.updated_at,
      first_message_at: v('fm_at'), first_message_quality: v('fm_quality'), first_message_basis: v('fm_basis'),
    };
  }
  static point(row) {
    return { value: row.value, label: row.label, primary: row.is_primary === 1, source: row.source, source_ref: row.source_ref, updated_at: row.updated_at };
  }
  static evidence(row) {
    return row && {
      id: row.id, contact_id: row.contact_id, thread_id: row.thread_id, evidence_key: row.evidence_key, platform: row.platform,
      conversation_kind: row.conversation_kind, first_message_at: row.first_message_at, quality: row.quality, basis: row.basis,
      direction: row.direction, source: row.source, recorded_at: row.recorded_at, updated_at: row.updated_at,
    };
  }
  /** {phones: [...], emails: [...]} from contact_points rows (already ordered primary first). */
  static points(rows) {
    const out = { phones: [], emails: [] };
    for (const r of rows) out[r.kind === 'phone' ? 'phones' : 'emails'].push(CrmStore.point(r));
    return out;
  }

  contactView(id, { points = false } = {}) {
    const contact = CrmStore.contact(this.q.contactViewById.get(id));
    return points ? { ...contact, ...CrmStore.points(this.q.pointsByContact.all(id)) } : contact;
  }

  /** Apply organization/department/job_title/location (+ *_source). Returns true when anything changed. */
  applyProfile(contactId, input, now, client) {
    if (!PROFILE_FIELDS.some((f) => input[f] !== undefined)) return false;
    const old = this.q.profileByContact.get(contactId) || {};
    const next = { contact_id: contactId, now };
    let changed = false;
    for (const f of PROFILE_FIELDS) {
      const value = input[f] === undefined ? old[f] ?? null : input[f];
      let source = old[`${f}_source`] ?? null;
      if (input[f] !== undefined) {
        if (value === null) source = null;
        else if (input[`${f}_source`]) source = input[`${f}_source`];
        else if (value !== (old[f] ?? null) || !source) source = client;
      }
      next[f] = value;
      next[`${f}_source`] = source;
      changed = changed || value !== (old[f] ?? null) || source !== (old[`${f}_source`] ?? null);
    }
    if (changed) this.q.profileUpsert.run(next);
    return changed;
  }

  /** Add, update or remove phones/e-mails by (kind, value). Returns true when anything changed. */
  applyPoints(contactId, points, now, client) {
    let changed = false;
    for (const pt of points) {
      const old = this.q.pointByIdentity.get(contactId, pt.kind, pt.value);
      if (pt.remove) {
        if (old) { this.q.pointDelete.run(old.id); changed = true; }
        continue;
      }
      const row = {
        contact_id: contactId, kind: pt.kind, value: pt.value, now,
        label: pt.label === undefined ? old?.label ?? null : pt.label,
        is_primary: pt.primary === undefined ? old?.is_primary ?? 0 : pt.primary ? 1 : 0,
        source: pt.source || old?.source || client,
        source_ref: pt.source_ref === undefined ? old?.source_ref ?? null : pt.source_ref,
      };
      let id = old?.id;
      if (!old) {
        id = Number(this.q.pointInsert.run(row).lastInsertRowid);
        changed = true;
      } else if (['label', 'is_primary', 'source', 'source_ref'].some((f) => row[f] !== old[f])) {
        this.q.pointUpdate.run({ ...row, id });
        changed = true;
      }
      if (row.is_primary && this.q.pointClearPrimary.run(now, contactId, pt.kind, id).changes) changed = true;
    }
    return changed;
  }
  static extract(row) {
    return row && { id: row.id, contact_id: row.contact_id, thread_id: row.thread_id, source_thread: row.source_thread, extracted_json: JSON.parse(row.extracted_json), model_version: row.model_version, created_at: row.created_at };
  }

  /**
   * Upsert by (platform, name). Profile fields and phones/e-mails ride along in the same transaction.
   * Returns {status, body, action, entity, entityId}.
   */
  upsertContact(input, now, client = 'unknown') {
    const withPoints = input.phones !== undefined || input.emails !== undefined;
    const extras = (id) => {
      const profileChanged = this.applyProfile(id, input, now, client);
      const pointsChanged = this.applyPoints(id, [...(input.phones || []), ...(input.emails || [])], now, client);
      return profileChanged || pointsChanged;
    };
    const existing = this.q.contactByIdentity.get(input.platform, input.name);
    if (!existing) {
      const r = this.q.contactInsert.run({
        name: input.name, platform: input.platform, aliases_json: JSON.stringify(input.aliases || []),
        role: input.role ?? null, school: input.school ?? null, stage: input.stage || 'unknown', notes: input.notes ?? null,
        first_seen: input.first_seen ?? null, last_contact: input.last_contact ?? null, is_test: input.is_test ? 1 : 0, now,
      });
      const id = Number(r.lastInsertRowid);
      extras(id);
      return { status: 201, body: { id, created: true, changed: true, contact: this.contactView(id, { points: withPoints }) }, action: 'created', entity: 'contacts', entityId: id };
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
    const columnsChanged = ['name', 'aliases_json', 'role', 'school', 'stage', 'notes', 'first_seen', 'last_contact', 'is_test'].some((f) => next[f] !== existing[f]);
    if (columnsChanged) this.q.contactUpdate.run(next);
    const changed = extras(existing.id) || columnsChanged;
    return {
      status: 200, body: { id: existing.id, created: false, changed, contact: this.contactView(existing.id, { points: withPoints }) },
      action: changed ? 'updated' : 'unchanged', entity: 'contacts', entityId: existing.id,
    };
  }

  /**
   * Record the earliest message of one source conversation (per contact_id + evidence_key). Monotonic:
   * an earlier time, or the same time with stronger evidence, replaces the stored value; anything later
   * or weaker leaves it alone, so re-running a backfill can only ever confirm or improve it.
   */
  upsertFirstMessageEvidence(input, now, client = 'unknown') {
    if (!this.q.contactById.get(input.contact_id)) throw new ApiError(422, 'unknown_contact', `contact ${input.contact_id} does not exist`, { field: 'contact_id' });
    if (input.thread_id !== undefined) {
      const t = this.q.threadById.get(input.thread_id);
      if (!t || t.contact_id !== input.contact_id) throw new ApiError(422, 'unknown_thread', `thread ${input.thread_id} does not belong to contact ${input.contact_id}`, { field: 'thread_id' });
    }
    const old = this.q.evidenceByKey.get(input.contact_id, input.evidence_key);
    const row = { ...input, thread_id: input.thread_id ?? old?.thread_id ?? null, source: client, now };
    let id = old?.id;
    let action = 'unchanged';
    if (!old) {
      id = Number(this.q.evidenceInsert.run(row).lastInsertRowid);
      action = 'created';
    } else {
      if (old.platform !== input.platform || old.conversation_kind !== input.conversation_kind) {
        throw new ApiError(422, 'evidence_conflict', 'evidence_key already describes a conversation on another platform or of another kind', { field: 'evidence_key' });
      }
      const improves = strongerEvidence(input, old);
      const relinks = input.thread_id !== undefined && input.thread_id !== old.thread_id;
      if (improves || relinks) {
        this.q.evidenceUpdate.run(improves ? { ...row, id } : { ...old, thread_id: row.thread_id, now, id });
        action = improves ? 'updated' : 'relinked';
      }
    }
    const contact = this.contactView(input.contact_id);
    return {
      status: old ? 200 : 201,
      body: {
        id, created: !old, changed: action !== 'unchanged', action, evidence: CrmStore.evidence(this.q.evidenceById.get(id)),
        first_contact: {
          at: contact.first_contact, quality: contact.first_contact_quality, basis: contact.first_contact_basis,
          platform: contact.first_contact_platform, thread_id: contact.first_contact_thread_id, conversation_kind: contact.first_contact_conversation_kind,
        },
      },
      action, entity: 'first_message_evidence', entityId: id,
    };
  }

  upsertThread(input, now) {
    if (!this.q.contactById.get(input.contact_id)) throw new ApiError(422, 'unknown_contact', `contact ${input.contact_id} does not exist`, { field: 'contact_id' });
    const existing = this.q.threadByIdentity.get(input.contact_id, input.app, input.thread_name);
    if (!existing) {
      const r = this.q.threadInsert.run({ contact_id: input.contact_id, app: input.app, thread_name: input.thread_name, last_seen: input.last_seen ?? null, now });
      const id = Number(r.lastInsertRowid);
      return { status: 201, body: { id, created: true, changed: true, thread: CrmStore.thread(this.q.threadViewById.get(id)) }, action: 'created', entity: 'threads', entityId: id };
    }
    const last_seen = existing.last_seen && input.last_seen ? (existing.last_seen > input.last_seen ? existing.last_seen : input.last_seen) : input.last_seen || existing.last_seen || null;
    const changed = last_seen !== existing.last_seen || input.thread_name !== existing.thread_name;
    if (changed) this.q.threadUpdate.run({ id: existing.id, thread_name: input.thread_name, last_seen, now });
    return {
      status: 200, body: { id: existing.id, created: false, changed, thread: CrmStore.thread(this.q.threadViewById.get(existing.id)) },
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
      const fields = ['c.name', 'c.aliases_json', 'c.school', 'c.role', 'c.notes', 'p.organization', 'p.department', 'p.job_title', 'p.location'];
      where.push(`(${fields.map((x) => `${x} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      params.push(...fields.map(() => like));
    }
    if (!f.includeTest) where.push('c.is_test = 0');
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // One read transaction: the total, the page and any embeds come from the same WAL snapshot.
    return this.db.transaction(() => {
      const total = this.db.prepare(`SELECT COUNT(*) AS n FROM contacts c LEFT JOIN contact_profiles p ON p.contact_id = c.id ${sqlWhere}`).get(...params).n;
      const rows = this.db.prepare(`
        SELECT ${CONTACT_COLUMNS},
          (SELECT COUNT(*) FROM threads t WHERE t.contact_id = c.id) AS thread_count,
          (SELECT COUNT(*) FROM extracts e WHERE e.contact_id = c.id) AS extract_count,
          (SELECT MAX(e.created_at) FROM extracts e WHERE e.contact_id = c.id) AS last_extract_at
        FROM contacts c ${CONTACT_JOINS} ${sqlWhere}
        ORDER BY c.last_contact DESC NULLS LAST, c.name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset);
      const contacts = rows.map((r) => CrmStore.contact(r, { thread_count: r.thread_count, extract_count: r.extract_count, last_extract_at: r.last_extract_at }));
      if (f.include.size) {
        const ids = JSON.stringify(contacts.map((c) => c.id));
        if (f.include.has('threads')) {
          const byContact = new Map(contacts.map((c) => [c.id, []]));
          for (const t of this.q.threadsForContacts.all(ids)) byContact.get(t.contact_id).push(CrmStore.thread(t));
          for (const c of contacts) c.threads = byContact.get(c.id);
        }
        if (f.include.has('latest_extract')) {
          const latest = new Map(this.q.latestExtractsForContacts.all(ids).map((e) => [e.contact_id, CrmStore.extract(e)]));
          for (const c of contacts) c.latest_extract = latest.get(c.id) || null;
        }
        if (f.include.has('contact_points')) {
          const byContact = new Map(contacts.map((c) => [c.id, []]));
          for (const pt of this.q.pointsForContacts.all(ids)) byContact.get(pt.contact_id).push(pt);
          for (const c of contacts) Object.assign(c, CrmStore.points(byContact.get(c.id)));
        }
      }
      return { contacts, total, limit: f.limit, offset: f.offset };
    })();
  }

  getContact(id, extractsLimit, include = new Set()) {
    return this.db.transaction(() => {
      if (!this.q.contactById.get(id)) return null;
      const extracts = this.db.prepare('SELECT * FROM extracts WHERE contact_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(id, extractsLimit);
      return {
        contact: this.contactView(id, { points: include.has('contact_points') }),
        threads: this.q.threadsByContact.all(id).map(CrmStore.thread), extracts: extracts.map(CrmStore.extract),
      };
    })();
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
  // Affiliation fields, each with an optional provenance; a source without its field would be a no-op.
  for (const f of PROFILE_FIELDS) {
    out[f] = optText(body, f, LIMITS.profileField);
    out[`${f}_source`] = optSource(body, `${f}_source`);
    if (out[`${f}_source`] !== undefined && out[f] === undefined) {
      throw bad('invalid_field', `${f}_source needs ${f} in the same request`, { field: `${f}_source` });
    }
  }
  out.phones = optPoints(body, 'phones');
  out.emails = optPoints(body, 'emails');
  return out;
}

function parseEvidenceBody(body, nowIso) {
  const out = {
    contact_id: optId(body, 'contact_id', { required: true }),
    thread_id: optId(body, 'thread_id'),
    evidence_key: reqText(body, 'evidence_key', LIMITS.evidenceKey),
    platform: reqText(body, 'platform', LIMITS.platform, { lower: true }),
    conversation_kind: reqEnum(body, 'conversation_kind', CONVERSATION_KINDS),
    first_message_at: reqMessageTime(body, 'first_message_at', nowIso),
    quality: reqEnum(body, 'quality', QUALITIES),
    basis: reqEnum(body, 'basis', BASES),
    direction: reqEnum(body, 'direction', DIRECTIONS, 'unknown'),
  };
  if (!/^[A-Za-z0-9._:-]+$/.test(out.evidence_key)) throw bad('invalid_field', 'evidence_key must be an opaque token of letters, digits and ._:-', { field: 'evidence_key' });
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(out.platform)) throw bad('invalid_field', 'platform must be a short lower-case identifier', { field: 'platform' });
  if (out.quality === 'exact' && out.basis !== 'message_timestamp') {
    throw bad('invalid_field', 'quality exact needs basis message_timestamp; relative labels and observation times are approximate', { field: 'quality' });
  }
  return out;
}

function parseIncludes(params, allowed) {
  const include = new Set();
  // `include=a,b` and `include=a&include=b` are equivalent.
  for (const part of params.getAll('include').join(',').split(',')) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (!allowed.includes(name)) throw bad('invalid_query', `include must list only ${allowed.join(', ')}`, { param: 'include' });
    include.add(name);
  }
  return include;
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
    include: parseIncludes(params, LIST_INCLUDES),
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
      const kind = { '/contacts': 'contacts', '/threads': 'threads', '/extracts': 'extracts', '/first-message-evidence': 'evidence' }[rest];
      if (!kind) throw new ApiError(404, 'not_found');
      const key = idempotencyKey(req);
      const body = await readJsonBody(req, cfg.maxBody);
      const input = kind === 'contacts' ? parseContactBody(body) : kind === 'threads' ? parseThreadBody(body)
        : kind === 'evidence' ? parseEvidenceBody(body, now) : parseExtractBody(body);
      const endpoint = `POST ${PREFIX}${rest}`;
      const requestSha256 = sha256(`${endpoint}\n${canonical(body)}`);
      const result = store.withIdempotency({ client: client.name, key, endpoint, requestSha256, now }, () => {
        if (kind === 'contacts') return store.upsertContact(input, now, client.name);
        if (kind === 'threads') return store.upsertThread(input, now);
        if (kind === 'evidence') return store.upsertFirstMessageEvidence(input, now, client.name);
        return store.appendExtract(input, now);
      });
      store.purgeIdempotency();
      return send(res, result.status, result.body, result.replayed ? { 'Idempotent-Replayed': 'true' } : {});
    }

    // GET
    if (rest === '/contacts') return send(res, 200, store.listContacts(parseListQuery(url.searchParams, now)));
    const m = /^\/contacts\/(\d{1,15})$/.exec(rest);
    if (m) {
      const extractsLimit = intParam(url.searchParams, 'extracts_limit', { min: 0, max: LIMITS.extractsMax, dflt: 20 });
      const found = store.getContact(Number(m[1]), extractsLimit, parseIncludes(url.searchParams, DETAIL_INCLUDES));
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

module.exports = {
  createCrmServer, loadConfig, parseClients, CrmStore, ApiError, canonical, sha256, VERSION, STAGES, LIMITS,
  parseContactBody, parseEvidenceBody, normalizePhone, normalizeEmail, strongerEvidence,
};

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
