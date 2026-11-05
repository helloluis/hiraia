#!/usr/bin/env node
'use strict';
/**
 * Hiraia CRM maintenance tasks. Run ON the origin, as the service user, against the live database:
 *
 *   runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs <task> [options]
 *
 *   reconcile-notes       Move what Luis's manual notes state explicitly into the structured fields:
 *                         Google Contacts phone/e-mail clauses -> phones/emails (source google_contacts),
 *                         "listed as <title> at ..." -> job_title, "Affiliation: X." and
 *                         "X is her/his/their organization" -> organization, "Location: X." -> location.
 *                         Nothing else is inferred. The migrated number in the note is replaced with
 *                         "in contact details"; the original notes go to a private backup first.
 *   apply-first-contact   Apply a first-message evidence bundle made on the MBP by
 *                         deploy/crm/tools/first_contact_evidence.py.
 *   revert-reconcile      Undo one reconcile-notes run from its backup file: puts back exactly what that run
 *                         changed, and only where nothing has changed since (newer notes or hand edits stay).
 *   revert-first-contact  Delete the evidence rows a bundle wrote (only rows still written by maintenance).
 *
 * All are dry runs unless --apply is given. Writes go through the same parsing and store code as the
 * API, one transaction per run, each change recorded in the append-only events log. Output never
 * contains a phone number or an e-mail address. A --from-json run reads saved contact snapshots instead
 * of the database (for a local dry run) and cannot apply.
 */
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, migrationStatus } = require('./db.cjs');
const { CrmStore, parseContactBody, parseEvidenceBody, normalizePhone, normalizeEmail, strongerEvidence, canonical, sha256 } = require('./server.cjs');

const BUNDLE_FORMAT = 'hiraia-first-contact-evidence/1';
const MAINTENANCE_CLIENT = 'maintenance';

// ---------------------------------------------------------------------------------------- masking
/** "E.164, 12 digits" style descriptions: never a digit of the number itself. */
function describePhone(raw, value) {
  const digits = value.replace(/\D/g, '').length;
  const national = !raw.trim().startsWith('+') && !raw.trim().startsWith('00');
  return value.startsWith('+') ? `E.164 phone, ${digits} digits${national ? ' (from national format)' : ''}` : `phone, ${digits} digits (no country code)`;
}
function describeEmail(value) { return `e-mail at a ${value.split('@')[1].split('.').pop()} domain`; }

// --------------------------------------------------------------------------------- note parsing
const NAME = "[A-Z][\\w&'-]*";
const CONNECTOR = '(?:of|the|and|for|de|del|ng|sa)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
const same = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase();

/** National Philippine mobile format (09XXXXXXXXX) -> E.164, only when the default region is PH. */
function canonicalPhone(raw, defaultRegion) {
  const value = normalizePhone(raw);
  if (!value) return null;
  if (defaultRegion === 'PH' && /^09\d{9}$/.test(value)) return `+63${value.slice(1)}`;
  return value;
}

/** Phone- or e-mail-like text a note still contains (Google people ids, years and ISO dates excluded). */
function sensitiveLeft(notes) {
  const text = notes.replace(/(?:people|person)\/c\d+/g, ' ')
    .replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?!\d)/g, ' ');   // ISO dates and times
  const phones = (text.match(/(?<![\w/])\+?\d[\d \u00a0().-]{6,}\d(?!\d)/g) || []).filter((m) => normalizePhone(m));
  const emails = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];
  return { phones: phones.length, emails: emails.length };
}

/**
 * Proposals for one contact from its notes. Only these explicit forms count; everything else is left
 * alone and reported. Returns {changes, notes, skipped, left}.
 */
function proposeFromNotes(contact, { defaultRegion = 'PH' } = {}) {
  const notes = contact.notes || '';
  const changes = [];
  const skipped = [];
  let rewritten = notes;
  const existing = { phones: new Set((contact.phones || []).map((p) => p.value)), emails: new Set((contact.emails || []).map((e) => e.value)) };

  // Google Contacts sentences: "Google Contacts (<refs>): clause; clause." Dots inside numbers are kept.
  for (const m of notes.matchAll(/Google Contacts \(([^)]*)\):\s*((?:[^.]|\.(?=\d))*)\.?/g)) {
    const refs = [...new Set(m[1].match(/people\/c\d+/g) || [])];
    const sourceRef = refs.length ? `google-contacts:${refs.join(',')}` : 'google-contacts';
    for (const clause of m[2].split(';').map((s) => s.trim()).filter(Boolean)) {
      let c;
      if ((c = /^(phones?|e-?mails?)\s+(.+)$/i.exec(clause))) {
        const kind = /^p/i.test(c[1]) ? 'phone' : 'email';
        const values = c[2].split(/\s*(?:,|\band\b|\bor\b|\/)\s*/).map((s) => s.trim()).filter(Boolean);
        const migrated = [];
        for (const raw of values) {
          const value = kind === 'phone' ? canonicalPhone(raw, defaultRegion) : normalizeEmail(raw);
          if (!value) { skipped.push(`unparsed ${kind} in a Google Contacts clause (left in notes)`); continue; }
          migrated.push(raw);
          if (existing[`${kind}s`].has(value)) continue;
          existing[`${kind}s`].add(value);
          changes.push({ field: kind, value, source: 'google_contacts', source_ref: sourceRef,
            describe: kind === 'phone' ? describePhone(raw, value) : describeEmail(value), refs: refs.length });
        }
        if (migrated.length === values.length && migrated.length) {
          const replacement = `${c[1]} in contact details`;
          rewritten = rewritten.replace(clause, clause.replace(c[0], replacement));
        }
      } else if ((c = /^listed as (.+?) at (.+)$/i.exec(clause))) {
        changes.push({ field: 'job_title', value: c[1].trim(), source: 'google_contacts', describe: 'job title listed in Google Contacts' });
        if (!same(c[2], contact.school) && !same(c[2], contact.organization)) skipped.push('Google Contacts place differs from school and organization (not reconciled)');
      } else {
        skipped.push('unrecognized Google Contacts clause (left as is)');
      }
    }
  }

  // "Affiliation: X." and "X is her/his/their organization[/affiliation]".
  const orgs = [];
  for (const m of notes.matchAll(/\bAffiliation:\s*([^.;]+?)\s*[.;]/g)) orgs.push({ value: m[1], via: 'stated as Affiliation' });
  for (const m of notes.matchAll(new RegExp(`(${NAME}(?:\\s+(?:${CONNECTOR}|${NAME}))*) is (?:her|his|their) organi[sz]ation(?:/affiliation)?`, 'g'))) {
    let value = m[1];
    // Expand an acronym only when the note itself defines it: "Department of Education (DepEd)".
    const def = new RegExp(`(${NAME}(?:\\s+(?:${CONNECTOR}|${NAME}))*)\\s+\\(${escapeRe(value)}\\)`).exec(notes);
    if (def) value = `${def[1]} (${value})`;
    orgs.push({ value, via: 'stated as her/his/their organization' });
  }
  const distinctOrgs = [...new Map(orgs.map((o) => [o.value.toLowerCase(), o])).values()];
  if (distinctOrgs.length > 1) skipped.push('several organizations stated (none applied)');
  else if (distinctOrgs.length === 1) {
    if (same(distinctOrgs[0].value, contact.school)) skipped.push('stated organization equals the school (not applied)');
    else changes.push({ field: 'organization', value: distinctOrgs[0].value.trim(), source: 'manual_note', describe: distinctOrgs[0].via });
  }

  const loc = [...notes.matchAll(/\bLocation:\s*([^.;]+?)\s*[.;]/g)];
  if (loc.length === 1) changes.push({ field: 'location', value: loc[0][1].trim(), source: 'manual_note', describe: 'stated as Location' });
  else if (loc.length > 1) skipped.push('several locations stated (none applied)');

  // A structured field that already holds a different value is never overwritten.
  const kept = [];
  for (const ch of changes) {
    if (['organization', 'job_title', 'location'].includes(ch.field)) {
      const current = contact[ch.field];
      if (current && same(current, ch.value)) continue;
      if (current) { skipped.push(`${ch.field} already set to a different value (kept)`); continue; }
    }
    kept.push(ch);
  }
  return { changes: kept, notes: rewritten !== notes ? rewritten : null, skipped, left: sensitiveLeft(rewritten) };
}

/** The API request body that applies a contact's proposals. */
function reconcileBody(contact, proposal) {
  const body = { name: contact.name, platform: contact.platform };
  for (const ch of proposal.changes) {
    if (ch.field === 'phone' || ch.field === 'email') {
      const list = (body[`${ch.field}s`] = body[`${ch.field}s`] || []);
      list.push({ value: ch.value, source: ch.source, source_ref: ch.source_ref });
    } else {
      body[ch.field] = ch.value;
      body[`${ch.field}_source`] = ch.source;
    }
  }
  if (proposal.notes !== null) body.notes = proposal.notes;
  return body;
}

// ------------------------------------------------------------------------------------- database
function openStore(dbPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);
  const db = openDatabase(dbPath);
  const pending = migrationStatus(db).filter((m) => !m.applied_at);
  if (pending.length) {
    db.close();
    throw new Error(`database needs migrations ${pending.map((m) => m.name).join(', ')}: restart hiraia-crm (it migrates on start) first`);
  }
  return { db, store: new CrmStore(db) };
}

function loadSnapshots(files) {
  const out = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const found = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        if (Number.isInteger(v.id) && typeof v.name === 'string' && typeof v.platform === 'string' && 'notes' in v) found.push(v);
        else Object.values(v).forEach(walk);
      }
    };
    walk(data);
    out.push(...found);
  }
  // The newest snapshot of each contact wins (files are read in the order given).
  return [...new Map(out.map((c) => [c.id, c])).values()].sort((a, b) => a.id - b.id);
}

// ----------------------------------------------------------------------------------------- tasks
function reconcileNotes({ store, contacts, apply, now, backup, defaultRegion, log }) {
  const plans = contacts
    .filter((c) => !c.is_test && c.notes)
    .map((c) => ({ contact: c, proposal: proposeFromNotes(c, { defaultRegion }) }));
  let changed = 0;
  for (const { contact, proposal } of plans) {
    log(`#${contact.id} ${contact.name}`);
    for (const ch of proposal.changes) {
      const shown = ch.field === 'phone' || ch.field === 'email' ? ch.describe : JSON.stringify(ch.value);
      log(`  + ${ch.field.padEnd(13)} ${shown}  (${ch.source}${ch.refs ? `, ${ch.refs} Google Contacts entr${ch.refs === 1 ? 'y' : 'ies'}` : ''}${ch.field !== 'phone' && ch.field !== 'email' ? `; ${ch.describe}` : ''})`);
    }
    if (proposal.notes !== null) log('  ~ notes         migrated number(s) replaced with "in contact details"');
    for (const s of proposal.skipped) log(`  · ${s}`);
    if (proposal.left.phones || proposal.left.emails) log(`  ! notes still hold ${proposal.left.phones} phone-like and ${proposal.left.emails} e-mail-like value(s) not in a recognised form`);
    if (!proposal.changes.length && proposal.notes === null) log('  = nothing to reconcile');
    else changed += 1;
  }
  if (!apply) return { contacts: plans.length, toChange: changed, applied: 0 };
  const todo = plans.filter((p) => p.proposal.changes.length || p.proposal.notes !== null);
  if (!todo.length) return { contacts: plans.length, toChange: 0, applied: 0 };
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.writeFileSync(backup, `${JSON.stringify(todo.map((p) => p.contact), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  store.db.transaction(() => {
    for (const { contact, proposal } of todo) {
      const body = reconcileBody(contact, proposal);
      const input = parseContactBody(body);
      store.withIdempotency({ client: MAINTENANCE_CLIENT, key: null, endpoint: 'MAINTENANCE reconcile-notes', requestSha256: sha256(canonical(body)), now },
        () => store.upsertContact(input, now, MAINTENANCE_CLIENT));
    }
  })();
  return { contacts: plans.length, toChange: changed, applied: todo.length };
}

function applyFirstContact({ store, bundle, apply, now, log }) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT || !Array.isArray(bundle.items)) throw new Error(`not a ${BUNDLE_FORMAT} bundle`);
  const outcomes = [];
  for (const item of bundle.items) {
    let input;
    try {
      input = parseEvidenceBody(item, now);
    } catch (e) {
      outcomes.push({ item, outcome: `rejected (${e.code || e.message})` });
      continue;
    }
    const contact = store.q.contactById.get(input.contact_id);
    const names = contact ? [contact.name, ...JSON.parse(contact.aliases_json)] : [];
    if (!contact) { outcomes.push({ item, outcome: 'rejected (no such contact)' }); continue; }
    if (item.contact_name && !names.some((n) => same(n, item.contact_name))) { outcomes.push({ item, outcome: 'rejected (contact name does not match the bundle)' }); continue; }
    if (input.thread_id !== undefined) {
      const t = store.q.threadById.get(input.thread_id);
      if (!t || t.contact_id !== input.contact_id) { outcomes.push({ item, outcome: 'rejected (thread is not this contact\'s)' }); continue; }
    }
    const old = store.q.evidenceByKey.get(input.contact_id, input.evidence_key);
    let outcome = 'create';
    if (old) {
      if (old.platform !== input.platform || old.conversation_kind !== input.conversation_kind) outcome = 'rejected (evidence key conflict)';
      else if (strongerEvidence(input, old)) outcome = 'improve';
      else if (input.thread_id !== undefined && input.thread_id !== old.thread_id) outcome = 'relink';
      else outcome = 'unchanged (stored evidence is as early and as strong)';
    }
    outcomes.push({ item, input, outcome, contact });
  }
  for (const o of outcomes) {
    const it = o.item;
    log(`#${it.contact_id} ${it.contact_name || ''} · ${it.platform} ${it.conversation_kind} ${it.thread_id ? `thread #${it.thread_id}` : '(no CRM thread)'} · ${it.first_message_at} ${it.quality}/${it.basis} -> ${o.outcome}`);
  }
  const writes = outcomes.filter((o) => ['create', 'improve', 'relink'].includes(o.outcome));
  if (apply && writes.length) {
    store.db.transaction(() => {
      for (const o of writes) {
        store.withIdempotency({ client: MAINTENANCE_CLIENT, key: null, endpoint: 'MAINTENANCE apply-first-contact', requestSha256: sha256(canonical(o.item)), now },
          () => store.upsertFirstMessageEvidence(o.input, now, MAINTENANCE_CLIENT));
      }
    })();
  }
  const byContact = new Map();
  for (const o of outcomes) if (o.contact) byContact.set(o.contact.id, o.contact.name);
  if (apply) {
    for (const [id, name] of byContact) {
      const v = store.contactView(id);
      log(`  first_contact #${id} ${name}: ${v.first_contact || 'none'} ${v.first_contact ? `${v.first_contact_quality}/${v.first_contact_basis} via ${v.first_contact_platform}` : ''}`);
    }
  }
  return { items: outcomes.length, writes: writes.length, applied: apply ? writes.length : 0, rejected: outcomes.filter((o) => o.outcome.startsWith('rejected')).length };
}

// ------------------------------------------------------------------------------------------ undo
/**
 * Undo a reconcile-notes run. Its changes are recomputed from each backed-up contact with the same parser,
 * and a change is reverted only while the CRM still holds exactly what the run wrote: notes harvestd has
 * since replaced, or a field or number edited by hand, are kept and reported.
 */
function revertReconcile({ store, snapshots, apply, now, defaultRegion, log }) {
  const bodies = [];
  for (const before of snapshots) {
    log(`#${before.id} ${before.name}`);
    const current = store.q.contactById.get(before.id) ? store.contactView(before.id, { points: true }) : null;
    if (!current || current.platform !== before.platform || !same(current.name, before.name)) { log('  ! contact is gone or renamed (not reverted)'); continue; }
    const proposal = proposeFromNotes(before, { defaultRegion });
    const body = { name: current.name, platform: current.platform };
    const steps = [];
    if (proposal.notes !== null) {                            // stored text is whitespace-collapsed by the API
      if (squash(current.notes) === squash(proposal.notes)) { body.notes = before.notes; steps.push('notes restored'); }
      else if (squash(current.notes) !== squash(before.notes)) log('  · notes changed since the run (kept)');
    }
    for (const ch of proposal.changes) {
      if (ch.field === 'phone' || ch.field === 'email') {
        const point = (current[`${ch.field}s`] || []).find((pt) => pt.value === ch.value);
        if (!point || (before[`${ch.field}s`] || []).some((pt) => pt.value === ch.value)) continue;
        if (point.source === ch.source && point.source_ref === ch.source_ref) {
          (body[`${ch.field}s`] = body[`${ch.field}s`] || []).push({ value: ch.value, remove: true });
          steps.push(`${ch.field} removed (${ch.describe})`);
        } else log(`  · ${ch.field} edited since the run (kept)`);
      } else if (same(current[ch.field], ch.value) && current[`${ch.field}_source`] === ch.source) {
        body[ch.field] = before[ch.field] || '';               // the run only fills empty fields: this clears it
        if (before[ch.field]) body[`${ch.field}_source`] = before[`${ch.field}_source`];
        steps.push(`${ch.field} cleared`);
      } else if (!same(current[ch.field], before[ch.field])) log(`  · ${ch.field} changed since the run (kept)`);
    }
    for (const step of steps) log(`  - ${step}`);
    if (steps.length) bodies.push(body);
    else log('  = nothing to revert');
  }
  if (apply && bodies.length) {
    store.db.transaction(() => {
      for (const body of bodies) {
        const input = parseContactBody(body);
        store.withIdempotency({ client: MAINTENANCE_CLIENT, key: null, endpoint: 'MAINTENANCE revert-reconcile', requestSha256: sha256(canonical(body)), now },
          () => store.upsertContact(input, now, MAINTENANCE_CLIENT));
      }
    })();
  }
  return { contacts: snapshots.length, toRevert: bodies.length, applied: apply ? bodies.length : 0 };
}

/** Delete the evidence rows a bundle wrote. Rows written or since improved by another client stay. */
function revertFirstContact({ store, bundle, apply, now, log }) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT || !Array.isArray(bundle.items)) throw new Error(`not a ${BUNDLE_FORMAT} bundle`);
  const rows = [];
  for (const item of bundle.items) {
    const row = Number.isInteger(item.contact_id) && typeof item.evidence_key === 'string'
      ? store.q.evidenceByKey.get(item.contact_id, item.evidence_key) : undefined;
    const what = `#${item.contact_id} ${item.contact_name || ''} · ${item.platform} ${item.conversation_kind}`;
    if (!row) log(`${what} -> nothing stored`);
    else if (row.source !== MAINTENANCE_CLIENT) log(`${what} -> kept (written by ${row.source})`);
    else { rows.push(row); log(`${what} -> delete`); }
  }
  if (apply && rows.length) {
    const remove = store.db.prepare('DELETE FROM first_message_evidence WHERE id = ?');
    store.db.transaction(() => {
      for (const row of rows) {
        store.withIdempotency({ client: MAINTENANCE_CLIENT, key: null, endpoint: 'MAINTENANCE revert-first-contact',
          requestSha256: sha256(canonical({ contact_id: row.contact_id, evidence_key: row.evidence_key })), now },
        () => { remove.run(row.id); return { status: 200, body: null, action: 'deleted', entity: 'first_message_evidence', entityId: row.id }; });
      }
    })();
  }
  return { items: bundle.items.length, deletes: rows.length, applied: apply ? rows.length : 0 };
}

// ------------------------------------------------------------------------------------------- CLI
function main(argv) {
  const [task, ...rest] = argv;
  const opts = { apply: false, files: [], db: process.env.HIRAIA_CRM_DB_PATH || '/var/lib/hiraia-crm/crm.db', region: 'PH', backup: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--db') opts.db = rest[++i];
    else if (a === '--from-json') opts.fromJson = true;
    else if (a === '--default-region') opts.region = rest[++i];
    else if (a === '--backup') opts.backup = rest[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.files.push(a);
  }
  const now = new Date().toISOString();
  const log = (line) => process.stdout.write(`${line}\n`);
  if (task === 'reconcile-notes') {
    if (opts.fromJson) {
      if (opts.apply) throw new Error('--from-json is a read-only dry run; it cannot --apply');
      const result = reconcileNotes({ store: null, contacts: loadSnapshots(opts.files), apply: false, now, defaultRegion: opts.region, log });
      log(`\n${result.contacts} contact(s) with notes; ${result.toChange} would change (dry run from snapshots)`);
      return 0;
    }
    const { db, store } = openStore(opts.db);
    try {
      const ids = db.prepare('SELECT id FROM contacts WHERE is_test = 0 AND notes IS NOT NULL ORDER BY id').all().map((r) => r.id);
      const contacts = ids.map((id) => store.contactView(id, { points: true }));
      const backup = opts.backup || path.join(path.dirname(opts.db), 'maintenance', `reconcile-notes-${now.replace(/[:.]/g, '')}.json`);
      const result = reconcileNotes({ store, contacts, apply: opts.apply, now, backup, defaultRegion: opts.region, log });
      log(`\n${result.contacts} contact(s) with notes; ${result.toChange} ${opts.apply ? `changed (backup of the originals: ${backup})` : 'would change — dry run, re-run with --apply'}`);
    } finally { db.close(); }
    return 0;
  }
  if (task === 'apply-first-contact') {
    if (opts.files.length !== 1) throw new Error('usage: apply-first-contact BUNDLE.json [--apply]');
    const bundle = JSON.parse(fs.readFileSync(opts.files[0], 'utf8'));
    const { db, store } = openStore(opts.db);
    try {
      const r = applyFirstContact({ store, bundle, apply: opts.apply, now, log });
      log(`\n${r.items} item(s): ${r.writes} would write, ${r.rejected} rejected${opts.apply ? `; ${r.applied} applied` : ' — dry run, re-run with --apply'}`);
    } finally { db.close(); }
    return 0;
  }
  if (task === 'revert-reconcile') {
    if (opts.files.length !== 1) throw new Error('usage: revert-reconcile RECONCILE-BACKUP.json [--apply]');
    const snapshots = loadSnapshots(opts.files);
    const { db, store } = openStore(opts.db);
    try {
      const r = revertReconcile({ store, snapshots, apply: opts.apply, now, defaultRegion: opts.region, log });
      log(`\n${r.contacts} contact(s) in the backup; ${r.toRevert} ${opts.apply ? 'reverted' : 'would revert — dry run, re-run with --apply'}`);
    } finally { db.close(); }
    return 0;
  }
  if (task === 'revert-first-contact') {
    if (opts.files.length !== 1) throw new Error('usage: revert-first-contact BUNDLE.json [--apply]');
    const bundle = JSON.parse(fs.readFileSync(opts.files[0], 'utf8'));
    const { db, store } = openStore(opts.db);
    try {
      const r = revertFirstContact({ store, bundle, apply: opts.apply, now, log });
      log(`\n${r.items} item(s): ${r.deletes} ${opts.apply ? 'deleted' : 'would be deleted — dry run, re-run with --apply'}`);
    } finally { db.close(); }
    return 0;
  }
  throw new Error('usage: maintenance.cjs reconcile-notes|apply-first-contact|revert-reconcile|revert-first-contact [options]');
}

module.exports = { proposeFromNotes, reconcileBody, reconcileNotes, applyFirstContact, revertReconcile, revertFirstContact, loadSnapshots, canonicalPhone, sensitiveLeft, BUNDLE_FORMAT };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`maintenance: ${e.message}\n`);
    process.exitCode = 1;
  }
}
