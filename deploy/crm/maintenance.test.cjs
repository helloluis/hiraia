'use strict';
// Maintenance tasks: note reconciliation and first-contact bundles. Every number here is fake; the
// note shapes mirror the manual-context notes written for the production contacts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, migrate } = require('./db.cjs');
const { CrmStore, parseContactBody, parseEvidenceBody } = require('./server.cjs');
const { proposeFromNotes, reconcileNotes, applyFirstContact, revertReconcile, revertFirstContact, loadSnapshots, sensitiveLeft, BUNDLE_FORMAT } = require('./maintenance.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-crm-maint-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOTES = {
  rosario: "Manual context supplied by Luis on 5 November 2026 (Asia/Manila): teacher working for the Department of Education (DepEd); DepEd is her organization/affiliation, not her school. Google Contacts (Luis's personal contact people/c1111111111111111111, https://contacts.google.com/person/c1111111111111111111): phone +639000000001.",
  danilo: "Manual context supplied by Luis on 5 November 2026 (Asia/Manila): teacher at Mabini Heights Elementary School. Google Contacts (Luis's personal contact people/c2222222222222222222, https://contacts.google.com/person/c2222222222222222222): listed as Instructional Leader at Mabini Heights Elementary School; phone +63 900 000 0002.",
  teresita: "Manual context supplied by Luis on 5 November 2026 (Asia/Manila): principal at Dalisay Elementary School. Google Contacts (Luis's personal contacts; two entries for the same person, people/c3333333333333333333 and people/c4444444444444444444): phone 09000000003.",
  ramil: 'Manual context supplied by Luis on 30 October 2026 (Asia/Manila), not a harvested conversation or classifier extraction. Affiliation: Bituin Foundation. Ramil Santiago Ybanez connects Hiraia with foundation-awardee educators.',
  liezel: 'Manual context supplied by Luis on 30 October 2026 (Asia/Manila), not a harvested conversation or classifier extraction. Location: Bayugan, Agusan del Sur. School and learner context: approximately 900 students across 14 barangays.',
  corazon: 'Manual context supplied by Luis on 4 November 2026 (Asia/Manila): key pilot contact at Bayanihan Elementary School, Pasig; she uses Hiraia with her classroom TV.',
  stray: 'Manual context supplied by Luis on 4 November 2026 (Asia/Manila): call her at 0917 000 0009 after classes, or write to someone@example.org.',
};
const FAKE_DIGITS = ['9000000001', '900 000 0002', '9000000002', '9000000003', '0917 000 0009'];
const contact = (id, name, notes, extra = {}) => ({ id, name, platform: 'messenger', notes, school: null, role: 'teacher', organization: null, job_title: null, location: null, phones: [], emails: [], ...extra });
const fields = (proposal) => Object.fromEntries(proposal.changes.map((c) => [c.field, c.value]));

test('DepEd-teacher note: DepEd goes to organization (acronym expanded from the note), phone to contact details', () => {
  const p = proposeFromNotes(contact(21, 'Rosario Villaflor', NOTES.rosario, { platform: 'viber' }));
  assert.deepEqual(fields(p), { organization: 'Department of Education (DepEd)', phone: '+639000000001' });
  const phone = p.changes.find((c) => c.field === 'phone');
  assert.deepEqual([phone.source, phone.source_ref, phone.describe], ['google_contacts', 'google-contacts:people/c1111111111111111111', 'E.164 phone, 12 digits']);
  assert.equal(p.changes.find((c) => c.field === 'organization').source, 'manual_note');
  assert.match(p.notes, /Google Contacts \(.*people\/c1111111111111111111.*\): phone in contact details\./);
  assert.ok(!p.notes.includes('639000000001'));
  assert.deepEqual(p.left, { phones: 0, emails: 0 });
});

test('Job-title note: Google Contacts job title and a formatted phone; school is not touched', () => {
  const p = proposeFromNotes(contact(19, 'Danilo Ocampo', NOTES.danilo, { school: 'Mabini Heights Elementary School' }));
  assert.deepEqual(fields(p), { job_title: 'Instructional Leader', phone: '+639000000002' });
  assert.equal(p.changes.find((c) => c.field === 'job_title').source, 'google_contacts');
  assert.deepEqual(p.skipped, []);
  assert.ok(p.notes.endsWith('listed as Instructional Leader at Mabini Heights Elementary School; phone in contact details.'));
});

test('National-format note: national format becomes E.164 only under the PH default; both Google entries are kept as provenance', () => {
  const ph = proposeFromNotes(contact(20, 'Teresita Lumbad', NOTES.teresita));
  const phone = ph.changes.find((c) => c.field === 'phone');
  assert.deepEqual([phone.value, phone.source_ref, phone.describe], ['+639000000003', 'google-contacts:people/c3333333333333333333,people/c4444444444444444444', 'E.164 phone, 12 digits (from national format)']);
  const raw = proposeFromNotes(contact(20, 'Teresita Lumbad', NOTES.teresita), { defaultRegion: 'none' });
  assert.equal(raw.changes.find((c) => c.field === 'phone').value, '09000000003');
});

test('only explicit statements count: affiliation, location; nothing is invented from schools or prose', () => {
  // ISO dates in a classified summary are not phone numbers; a stray number still is.
  assert.deepEqual(sensitiveLeft('Demo on 2026-10-27 and 2026-11-03 14:00 at the division office.'), { phones: 0, emails: 0 });
  assert.deepEqual(sensitiveLeft('Call 0917 000 0009 on 2026-10-27.'), { phones: 1, emails: 0 });
  assert.deepEqual(fields(proposeFromNotes(contact(9, 'Ramil Santiago Ybanez', NOTES.ramil))), { organization: 'Bituin Foundation' });
  assert.deepEqual(fields(proposeFromNotes(contact(10, 'Liezel Joy Panganiban', NOTES.liezel, { school: 'Bayugan National High School' }))), { location: 'Bayugan, Agusan del Sur' });
  const corazon = proposeFromNotes(contact(5, 'Corazon Baylon', NOTES.corazon, { school: 'Bayanihan Elementary School, Pasig' }));
  assert.deepEqual([corazon.changes, corazon.notes], [[], null]);
  const stray = proposeFromNotes(contact(30, 'Stray Mention', NOTES.stray));
  assert.deepEqual([stray.changes, stray.notes, stray.left], [[], null, { phones: 1, emails: 1 }]);   // reported, not migrated
});

test('a different value already in a structured field is kept, and the conflict is reported', () => {
  const p = proposeFromNotes(contact(21, 'Rosario Villaflor', NOTES.rosario, { organization: 'Some Other Org' }));
  assert.deepEqual(fields(p), { phone: '+639000000001' });
  assert.ok(p.skipped.includes('organization already set to a different value (kept)'));
  const already = proposeFromNotes(contact(21, 'Rosario Villaflor', NOTES.rosario, { organization: 'Department of Education (DepEd)', phones: [{ value: '+639000000001' }] }));
  assert.deepEqual(already.changes, []);                                     // nothing left to do; notes still rewritten
  assert.ok(already.notes.includes('phone in contact details'));
});

function freshStore(name) {
  const db = openDatabase(path.join(tmp, `${name}.db`));
  migrate(db);
  return { db, store: new CrmStore(db) };
}
function seed(store, body) {
  return store.upsertContact(parseContactBody(body), '2026-11-05T00:00:00.000Z', 'mbp-harvestd').body.id;
}

test('reconcile-notes end to end: dry run writes nothing, apply migrates with provenance and a private backup, re-run is a no-op', () => {
  const { db, store } = freshStore('reconcile');
  const ids = {
    danilo: seed(store, { name: 'Danilo Ocampo', platform: 'messenger', role: 'teacher', school: 'Mabini Heights Elementary School', notes: NOTES.danilo }),
    teresita: seed(store, { name: 'Teresita Lumbad', platform: 'messenger', role: 'principal', school: 'Dalisay Elementary School', notes: NOTES.teresita }),
    rosario: seed(store, { name: 'Rosario Villaflor', platform: 'viber', role: 'teacher', stage: 'intro', notes: NOTES.rosario }),
    corazon: seed(store, { name: 'Corazon Baylon', platform: 'messenger', notes: NOTES.corazon }),
  };
  const load = () => db.prepare('SELECT id FROM contacts ORDER BY id').all().map((r) => store.contactView(r.id, { points: true }));
  const lines = [];
  const log = (l) => lines.push(l);
  const now = '2026-11-05T02:00:00.000Z';
  const backup = path.join(tmp, 'maintenance', 'notes-before.json');
  const before = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;

  const dry = reconcileNotes({ store, contacts: load(), apply: false, now, backup, defaultRegion: 'PH', log });
  assert.deepEqual([dry.toChange, dry.applied], [3, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_points').get().n, 0);
  assert.equal(fs.existsSync(backup), false);

  const applied = reconcileNotes({ store, contacts: load(), apply: true, now, backup, defaultRegion: 'PH', log });
  assert.equal(applied.applied, 3);
  const s = store.contactView(ids.rosario, { points: true });
  assert.deepEqual([s.organization, s.organization_source, s.school, s.role, s.stage], ['Department of Education (DepEd)', 'manual_note', null, 'teacher', 'intro']);
  assert.deepEqual(s.phones.map((p) => [p.value, p.source, p.source_ref]), [['+639000000001', 'google_contacts', 'google-contacts:people/c1111111111111111111']]);
  assert.ok(!s.notes.includes('9000000001') && s.notes.includes('phone in contact details'));
  const e = store.contactView(ids.danilo, { points: true });
  assert.deepEqual([e.job_title, e.job_title_source, e.school, e.phones[0].value], ['Instructional Leader', 'google_contacts', 'Mabini Heights Elementary School', '+639000000002']);
  const m = store.contactView(ids.teresita, { points: true });
  assert.deepEqual([m.phones.length, m.phones[0].value, m.organization], [1, '+639000000003', null]);
  assert.deepEqual([store.contactView(ids.corazon).organization, store.contactView(ids.corazon).notes], [null, NOTES.corazon]);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  assert.ok(JSON.parse(fs.readFileSync(backup, 'utf8')).some((c) => c.notes === NOTES.rosario));
  const events = db.prepare('SELECT source, endpoint, action FROM events WHERE id > ?').all(before);
  assert.ok(events.length === 3 && events.every((ev) => ev.source === 'maintenance' && ev.endpoint === 'MAINTENANCE reconcile-notes' && ev.action === 'updated'));

  const again = reconcileNotes({ store, contacts: load(), apply: true, now, backup: path.join(tmp, 'maintenance', 'second.json'), defaultRegion: 'PH', log });
  assert.equal(again.applied, 0);
  assert.equal(fs.existsSync(path.join(tmp, 'maintenance', 'second.json')), false);   // nothing to do: no backup, no write
  const output = lines.join('\n');
  for (const d of FAKE_DIGITS) assert.ok(!output.includes(d), `output leaked ${d}`);
  db.close();
});

test('reconcile-notes reads saved snapshot files for a local dry run', () => {
  const file = path.join(tmp, 'snapshot-verified.json');
  fs.writeFileSync(file, JSON.stringify({ saved: { contact: { id: 21, name: 'Rosario Villaflor', platform: 'viber', notes: NOTES.rosario, school: null, role: 'teacher', is_test: false }, threads: [] } }));
  const contacts = loadSnapshots([file]);
  assert.deepEqual(contacts.map((c) => c.id), [21]);
  const lines = [];
  const r = reconcileNotes({ store: null, contacts, apply: false, now: '2026-11-05T00:00:00Z', defaultRegion: 'PH', log: (l) => lines.push(l) });
  assert.equal(r.toChange, 1);
  assert.ok(lines.some((l) => l.includes('organization') && l.includes('Department of Education (DepEd)')));
  assert.ok(!lines.join('\n').includes('9000000001'));
});

test('apply-first-contact: dry run, apply, idempotent re-run, monotonic improvements, and every rejection', () => {
  const { db, store } = freshStore('bundle');
  const now = new Date().toISOString();
  const cid = seed(store, { name: 'Noel Abarca', platform: 'messenger' });
  const other = seed(store, { name: 'Someone Else', platform: 'messenger' });
  const thread = store.upsertThread({ contact_id: cid, app: 'messenger', thread_name: 'Noel Abarca' }, now).body.id;
  const otherThread = store.upsertThread({ contact_id: other, app: 'messenger', thread_name: 'Someone Else' }, now).body.id;
  const item = (over) => ({ contact_id: cid, contact_name: 'Noel Abarca', thread_id: thread, evidence_key: 'fm1:aaaa', platform: 'messenger', conversation_kind: 'direct',
    first_message_at: '2026-10-12T07:45:00.000Z', quality: 'exact', basis: 'message_timestamp', direction: 'outgoing', ...over });
  const run = (items, apply) => applyFirstContact({ store, bundle: { format: BUNDLE_FORMAT, items }, apply, now, log: () => {} });

  assert.deepEqual(run([item({})], false), { items: 1, writes: 1, applied: 0, rejected: 0 });
  assert.equal(store.contactView(cid).first_contact, null);                 // a dry run writes nothing
  assert.equal(run([item({})], true).applied, 1);
  assert.deepEqual([store.contactView(cid).first_contact, store.contactView(cid).first_contact_quality], ['2026-10-12T07:45:00.000Z', 'exact']);
  assert.equal(run([item({})], true).applied, 0);                           // idempotent
  assert.equal(run([item({ first_message_at: '2026-10-30T00:00:00.000Z' })], true).applied, 0);   // later: ignored
  assert.equal(run([item({ quality: 'approximate', basis: 'first_observed' })], true).applied, 0); // weaker: ignored
  assert.equal(run([item({ evidence_key: 'fm1:bbbb', platform: 'telegram', thread_id: undefined, first_message_at: '2026-10-01T00:00:00.000Z', quality: 'approximate', basis: 'first_observed' })], true).applied, 1);
  assert.deepEqual([store.contactView(cid).first_contact, store.contactView(cid).first_contact_platform], ['2026-10-01T00:00:00.000Z', 'telegram']);

  const rejected = run([
    item({ contact_name: 'Somebody Different' }), item({ contact_id: 99999 }), item({ thread_id: otherThread }),
    item({ first_message_at: 'Wednesday 9:41am' }), item({ quality: 'exact', basis: 'first_observed' }), item({ platform: 'viber' }),
  ], true);
  assert.deepEqual([rejected.rejected, rejected.applied], [6, 0]);
  assert.throws(() => applyFirstContact({ store, bundle: { format: 'other', items: [] }, apply: false, now, log: () => {} }), /bundle/);
  db.close();
});

test('revert-reconcile: restores exactly what the run changed, keeps later edits, and is a no-op the second time', () => {
  const { db, store } = freshStore('revert-reconcile');
  const rosario = seed(store, { name: 'Rosario Villaflor', platform: 'viber', role: 'teacher', notes: NOTES.rosario });
  const danilo = seed(store, { name: 'Danilo Ocampo', platform: 'messenger', role: 'teacher', school: 'Mabini Heights Elementary School', notes: NOTES.danilo });
  const teresita = seed(store, { name: 'Teresita Lumbad', platform: 'messenger', role: 'principal', school: 'Dalisay Elementary School', notes: NOTES.teresita });
  const load = () => db.prepare('SELECT id FROM contacts ORDER BY id').all().map((r) => store.contactView(r.id, { points: true }));
  const original = Object.fromEntries(load().map((c) => [c.id, c]));
  const backup = path.join(tmp, 'maintenance', 'revert-source.json');
  const lines = [];
  const log = (l) => lines.push(l);
  assert.equal(reconcileNotes({ store, contacts: load(), apply: true, now: '2026-11-05T02:00:00.000Z', backup, defaultRegion: 'PH', log }).applied, 3);

  // After the run: harvestd replaces Danilo's notes, and Luis corrects Teresita's number's label by hand.
  seed(store, { name: 'Danilo Ocampo', platform: 'messenger', notes: 'A newer classified summary.' });
  store.upsertContact(parseContactBody({ name: 'Teresita Lumbad', platform: 'messenger', phones: [{ value: '+639000000003', label: 'school', source: 'manual_note' }] }), '2026-11-05T03:00:00.000Z', 'hiraia-console');

  const snapshots = loadSnapshots([backup]);
  const dry = revertReconcile({ store, snapshots, apply: false, now: '2026-11-05T04:00:00.000Z', defaultRegion: 'PH', log });
  assert.deepEqual([dry.toRevert, dry.applied], [3, 0]);
  assert.equal(store.contactView(rosario).organization, 'Department of Education (DepEd)');      // a dry run writes nothing

  const before = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  assert.equal(revertReconcile({ store, snapshots, apply: true, now: '2026-11-05T04:00:00.000Z', defaultRegion: 'PH', log }).applied, 3);
  const s = store.contactView(rosario, { points: true });
  assert.deepEqual([s.notes, s.organization, s.organization_source, s.phones.length, s.role], [original[rosario].notes, null, null, 0, 'teacher']);
  const e = store.contactView(danilo, { points: true });
  assert.deepEqual([e.notes, e.job_title, e.job_title_source, e.phones.length, e.school],
    ['A newer classified summary.', null, null, 0, 'Mabini Heights Elementary School']);   // newer notes kept
  const m = store.contactView(teresita, { points: true });
  assert.deepEqual([m.notes, m.phones.map((pt) => [pt.value, pt.source])], [original[teresita].notes, [['+639000000003', 'manual_note']]]);   // hand edit kept
  const events = db.prepare('SELECT source, endpoint FROM events WHERE id > ?').all(before);
  assert.ok(events.length === 3 && events.every((ev) => ev.source === 'maintenance' && ev.endpoint === 'MAINTENANCE revert-reconcile'));
  assert.ok(lines.some((l) => l.includes('notes changed since the run (kept)')) && lines.some((l) => l.includes('phone edited since the run (kept)')));

  assert.equal(revertReconcile({ store, snapshots, apply: true, now: '2026-11-05T05:00:00.000Z', defaultRegion: 'PH', log }).applied, 0);
  // A renamed or vanished contact is never touched.
  const gone = revertReconcile({ store, snapshots: [{ ...original[rosario], id: 99999 }, { ...original[teresita], name: 'Someone Else' }], apply: true, now: '2026-11-05T05:00:00.000Z', defaultRegion: 'PH', log });
  assert.equal(gone.applied, 0);
  const output = lines.join('\n');
  for (const d of FAKE_DIGITS) assert.ok(!output.includes(d), `output leaked ${d}`);
  db.close();
});

test('revert-first-contact: deletes only the rows maintenance wrote for the bundle, and recomputes first contact', () => {
  const { db, store } = freshStore('revert-bundle');
  const now = new Date().toISOString();
  const cid = seed(store, { name: 'Noel Abarca', platform: 'messenger' });
  const thread = store.upsertThread({ contact_id: cid, app: 'messenger', thread_name: 'Noel Abarca' }, now).body.id;
  const item = (over) => ({ contact_id: cid, contact_name: 'Noel Abarca', thread_id: thread, evidence_key: 'fm1:aaaa', platform: 'messenger', conversation_kind: 'direct',
    first_message_at: '2026-10-12T07:45:00.000Z', quality: 'exact', basis: 'message_timestamp', direction: 'outgoing', ...over });
  const bundle = { format: BUNDLE_FORMAT, items: [item({}), item({ evidence_key: 'fm1:bbbb', platform: 'telegram', thread_id: undefined, first_message_at: '2026-10-01T00:00:00.000Z', quality: 'approximate', basis: 'first_observed' })] };
  assert.equal(applyFirstContact({ store, bundle, apply: true, now, log: () => {} }).applied, 2);
  // harvestd later posts its own evidence for another conversation; the revert must leave it alone.
  store.upsertFirstMessageEvidence(parseEvidenceBody({ contact_id: cid, evidence_key: 'fm1:cccc', platform: 'viber', conversation_kind: 'direct',
    first_message_at: '2026-10-20T00:00:00.000Z', quality: 'approximate', basis: 'relative_label' }, now), now, 'mbp-harvestd');
  const withHarvestd = { ...bundle, items: [...bundle.items, item({ evidence_key: 'fm1:cccc', platform: 'viber', thread_id: undefined })] };

  const lines = [];
  const dry = revertFirstContact({ store, bundle: withHarvestd, apply: false, now, log: (l) => lines.push(l) });
  assert.deepEqual([dry.deletes, dry.applied], [2, 0]);
  assert.equal(store.contactView(cid).first_contact, '2026-10-01T00:00:00.000Z');
  const r = revertFirstContact({ store, bundle: withHarvestd, apply: true, now, log: (l) => lines.push(l) });
  assert.equal(r.applied, 2);
  const v = store.contactView(cid);
  assert.deepEqual([v.first_contact, v.first_contact_platform, v.first_contact_quality], ['2026-10-20T00:00:00.000Z', 'viber', 'approximate']);
  assert.equal(CrmStore.thread(store.q.threadViewById.get(thread)).first_message_at, null);   // the thread's own evidence is gone too
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE endpoint = 'MAINTENANCE revert-first-contact' AND action = 'deleted'").get().n, 2);
  assert.ok(lines.some((l) => l.includes('kept (written by mbp-harvestd)')));
  assert.equal(revertFirstContact({ store, bundle: withHarvestd, apply: true, now, log: () => {} }).applied, 0);   // re-run: nothing left
  assert.throws(() => revertFirstContact({ store, bundle: { format: 'other', items: [] }, apply: false, now, log: () => {} }), /bundle/);
  db.close();
});
