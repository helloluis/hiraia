'use strict';
// Client logic for /admin/crm. Evaluates the exact bytes the page inlines, in a vm sandbox.
//   node --test deploy/vps-monitor/crm_contacts.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { URLSearchParams };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'crm_contacts.js'), 'utf8'), sandbox, { filename: 'crm_contacts.js' });
const crm = sandbox.HiraiaCrm;
const plain = (value) => JSON.parse(JSON.stringify(value));      // values from the sandbox realm
const names = (list) => plain(list.map((c) => c.name));
const tidy = (s) => s.replace(/[\u202f\u00a0]/g, ' ');             // ICU puts a narrow no-break space before AM/PM

// 22:00 on Wed 4 Nov 2026 in Manila.
const NOW = Date.parse('2026-11-04T14:00:00Z');

let nextId = 1;
function card(name, fields = {}) {
  return {
    id: nextId++, name, aliases: [], role: null, school: null, stage: 'unknown', notes: null, summary: null,
    next_action: null, dates: [], summary_at: null, thread_count: 0, extract_count: 0, last_contact: null,
    first_seen: null, updated_at: null, activity: { state: 'none', at: null, basis: null, source_approximate: false },
    channels: [], ...fields,
  };
}
const exact = (at) => ({ state: 'exact', at, basis: 'last_contact', source_approximate: false });
const approx = (at, flagged = true) => ({ state: 'approximate', at, basis: 'summary_synced', source_approximate: flagged });
const channel = (platform, kinds = [], record = false) => ({ platform, record, threads: kinds.map((kind) => ({ kind, last_seen: null })) });
const state = (fields = {}) => ({ q: '', platforms: new Set(), stages: new Set(), sort: 'recent', ...fields });

test('default sort: newest exact first, approximate by CRM sync time, never-contacted last', () => {
  const list = [
    card('Zed Record Only'),
    card('Undated Approximate', { activity: approx(null) }),
    card('Older Exact', { activity: exact('2026-11-02T00:00:00.000Z') }),
    card('Aaron Record Only'),
    card('Synced Approximate', { activity: approx('2026-11-03T05:00:00.000Z') }),
    card('Newest Exact', { activity: exact('2026-11-04T01:00:00.000Z') }),
    card('Same Instant Exact', { activity: exact('2026-11-03T05:00:00.000Z') }),
    card('Garbage Time', { activity: exact('not a time') }),
  ];
  assert.deepEqual(names(crm.sortContacts(list, 'recent')), [
    'Newest Exact', 'Same Instant Exact', 'Synced Approximate', 'Older Exact',
    'Garbage Time', 'Undated Approximate',          // unparseable/undated never outranks a real time
    'Aaron Record Only', 'Zed Record Only',         // never contacted: last, by name
  ]);
  assert.deepEqual(names(crm.sortContacts(list, 'no-such-sort')), names(crm.sortContacts(list, 'recent')));
  assert.deepEqual(names(crm.sortContacts(list, 'constructor')), names(crm.sortContacts(list, 'recent')));
  assert.equal(list[0].name, 'Zed Record Only');    // the input is not reordered in place
});

test('quiet sort: longest since contact first; undated and never-contacted still last', () => {
  const list = [
    card('Recent', { activity: exact('2026-11-04T01:00:00.000Z') }),
    card('Never'),
    card('Months Ago', { activity: approx('2026-07-01T00:00:00.000Z') }),
    card('Undated', { activity: approx(null, false) }),
    card('Weeks Ago', { activity: exact('2026-10-10T00:00:00.000Z') }),
  ];
  assert.deepEqual(names(crm.sortContacts(list, 'quiet')), ['Months Ago', 'Weeks Ago', 'Recent', 'Undated', 'Never']);
});

test('name sort ignores case and accents and orders numbers naturally', () => {
  const list = [card('peñaflor, Lourdes'), card('Penaflor, Ana'), card('Teacher 10'), card('Teacher 9'), card('ábalos')];
  assert.deepEqual(names(crm.sortContacts(list, 'name')), ['ábalos', 'Penaflor, Ana', 'peñaflor, Lourdes', 'Teacher 9', 'Teacher 10']);
});

test('search: case, accent and spacing-insensitive; every term must match some field', () => {
  const lourdes = card('Ma. Lourdes Peñaflor', { aliases: ["Ma'am Lou"], role: 'Science teacher', school: 'Mabuhay Hills Elementary School' });
  const jonathan = card('Jonathan Pacquing', { role: 'Division ICT coordinator', school: 'SDO Antipolo', next_action: 'Share the offline install guide', notes: 'Approved the shared tablets.' });
  const rowena = card('Rowena Dimaculangan', { summary: 'Confirmed two pilot sections.', dates: ['Nov 9 start'] });
  const ana = card('Ana', { school: 'Liza School' });
  const list = [lourdes, jonathan, rowena, ana];
  const find = (q) => names(crm.filterContacts(list, state({ q })));
  assert.deepEqual(find('penaflor'), ['Ma. Lourdes Peñaflor']);
  assert.deepEqual(find('  PEÑAFLOR   '), ['Ma. Lourdes Peñaflor']);
  assert.deepEqual(find("ma'am lou"), ['Ma. Lourdes Peñaflor']);             // alias
  assert.deepEqual(find('lou mabuhay'), ['Ma. Lourdes Peñaflor']);           // alias + school, AND
  assert.deepEqual(find('ict coordinator'), ['Jonathan Pacquing']);          // role
  assert.deepEqual(find('antipolo'), ['Jonathan Pacquing']);                 // school / organization
  assert.deepEqual(find('tablets'), ['Jonathan Pacquing']);                  // notes
  assert.deepEqual(find('install guide'), ['Jonathan Pacquing']);            // next action
  assert.deepEqual(find('pilot sections'), ['Rowena Dimaculangan']);         // latest summary
  assert.deepEqual(find('nov 9'), ['Rowena Dimaculangan']);                  // dates mentioned
  assert.deepEqual(find('lou antipolo'), []);                                // AND, not OR
  assert.deepEqual(find('analiza'), []);                                     // no match across two fields
  assert.deepEqual(find('   '), names(list));
  assert.equal(crm.fold('Ñiño  DE\tla Cruz'), 'nino de la cruz');
});

test('combined filters: OR within a facet, AND across facets and search; channels come from threads', () => {
  const list = [
    card('Messenger record with Viber group', { stage: 'pilot', channels: [channel('messenger', ['direct'], true), channel('viber', ['group'])] }),
    card('Viber pilot', { stage: 'pilot', school: 'Talim Island', channels: [channel('viber', ['direct'], true)] }),
    card('Viber dormant', { stage: 'dormant', channels: [channel('viber', [], true)] }),
    card('Telegram active', { stage: 'active', school: 'Talim Island', channels: [channel('telegram', ['direct'], true)] }),
    card('WhatsApp intro', { stage: 'intro', channels: [channel('whatsapp', [], true)] }),
  ];
  const pick = (fields) => names(crm.filterContacts(list, state(fields)));
  assert.deepEqual(pick({ platforms: new Set(['viber']) }), ['Messenger record with Viber group', 'Viber pilot', 'Viber dormant']);
  assert.deepEqual(pick({ platforms: new Set(['viber']), stages: new Set(['pilot']) }), ['Messenger record with Viber group', 'Viber pilot']);
  assert.deepEqual(pick({ platforms: new Set(['viber', 'telegram']), stages: new Set(['pilot', 'active']), q: 'talim' }), ['Viber pilot', 'Telegram active']);
  assert.deepEqual(pick({ platforms: new Set(['whatsapp']) }), ['WhatsApp intro']);
  assert.deepEqual(pick({ platforms: new Set(['telegram']), stages: new Set(['dormant']) }), []);
  assert.deepEqual(plain(crm.platformOptions(list, state({ platforms: new Set(['signal']) }))), ['messenger', 'viber', 'telegram', 'signal', 'whatsapp']);

  // Each facet's counts apply every *other* active filter, so options never count themselves out.
  const counts = plain(crm.facetCounts(list, state({ platforms: new Set(['viber']), stages: new Set(['pilot']) })));
  assert.deepEqual(counts.platform, { messenger: 1, viber: 2 });       // stage=pilot applied, platform ignored
  assert.deepEqual(counts.stage, { pilot: 2, dormant: 1 });            // platform=viber applied, stage ignored
  const odd = card('Odd platform', { channels: [channel('constructor', [], true)] });
  assert.deepEqual(plain(crm.facetCounts([odd], state())).platform, { constructor: 1 });
  assert.equal(crm.isFiltered(state()), false);
  assert.equal(crm.isFiltered(state({ q: ' x ' })), true);
  assert.deepEqual(plain(crm.activeFilters(state({ q: ' santos ', platforms: new Set(['viber']), stages: new Set(['pilot', 'intro']) }))).map((f) => f.label),
    ['“santos”', 'Viber', 'Intro', 'Pilot']);
});

test('multi-platform labels name every channel and its threads', () => {
  const lourdes = card('Ma. Lourdes Peñaflor', { channels: [
    channel('messenger', ['direct', 'direct', 'conversation'], true), channel('viber', ['group', 'group']), channel('telegram', []),
  ] });
  assert.deepEqual(plain(crm.channelLabels(lourdes)), [
    'Messenger · 2 direct chats + conversation', 'Viber · 2 group chats', 'Telegram · No synced thread']);
  assert.equal(crm.channelSummary(channel('viber', ['direct', 'group'])), 'Direct chat + group chat');
  assert.equal(crm.channelSummary(channel('viber', ['toString'])), 'Conversation');
  assert.deepEqual(plain(crm.channelLabels(card('No channels'))), []);
  assert.equal(crm.platformLabel('messenger'), 'Messenger');
  assert.equal(crm.platformTitle('messenger'), 'Facebook Messenger');
  assert.equal(crm.platformLabel('whatsapp'), 'WhatsApp');
  assert.equal(crm.platformLabel('kakao_talk'), 'Kakao Talk');
  assert.equal(crm.platformLabel('constructor'), 'Constructor');
  assert.equal(crm.countsText(card('x', { thread_count: 1, extract_count: 0 })), '1 thread · 0 extracts');
  assert.equal(crm.countsText(card('x', { thread_count: 3, extract_count: 1 })), '3 threads · 1 extract');
});

test('empty, no-match, error and stale states', () => {
  const one = [card('Only')];
  assert.equal(crm.viewState({ loading: true, error: null, contacts: null, visible: [] }), 'loading');
  assert.equal(crm.viewState({ loading: false, error: { code: 'crm_unavailable' }, contacts: null, visible: [] }), 'error');
  assert.equal(crm.viewState({ loading: true, error: { code: 'crm_unavailable' }, contacts: null, visible: [] }), 'loading');
  assert.equal(crm.viewState({ loading: false, error: null, contacts: [], visible: [] }), 'empty');
  assert.equal(crm.viewState({ loading: false, error: null, contacts: one, visible: [] }), 'no-match');
  assert.equal(crm.viewState({ loading: false, error: null, contacts: one, visible: one }), 'results');
  // A failed refresh keeps the last good contacts on screen (the banner explains it).
  assert.equal(crm.viewState({ loading: false, error: { code: 'network' }, contacts: one, visible: one }), 'results');
  assert.equal(crm.resultSummary(48, 48), '48 contacts');
  assert.equal(crm.resultSummary(1, 1), '1 contact');
  assert.equal(crm.resultSummary(12, 1048), '12 of 1,048 contacts');
  assert.equal(crm.noMatchText(state({ q: 'santos', platforms: new Set(['viber', 'messenger']), stages: new Set(['pilot']) })),
    'No contacts matching “santos” on Messenger or Viber in Pilot.');
  assert.equal(crm.errorMessage({ code: 'crm_rate_limited', retryAfter: 7 }), 'The CRM is limiting requests right now. Try again in 7 s.');
  assert.match(crm.errorMessage({ code: 'crm_outdated' }), /older than 1\.2/);
  assert.equal(crm.errorMessage({ code: 'constructor' }), 'The admin server could not load contacts.');
});

test('times are Manila time; exact shows the minute, approximate shows ≈ and never a clock time', () => {
  assert.equal(tidy(crm.formatDateTime('2026-11-03T04:07:00.000Z')), 'Nov 3, 2026, 12:07 PM');
  // 16:30 UTC on Nov 3 is already 00:30 on Nov 4 in Manila: "Today", not "Yesterday".
  assert.equal(crm.relativeDay('2026-11-03T16:30:00.000Z', NOW), 'Today');
  assert.equal(crm.relativeDay('2026-11-03T15:59:00.000Z', NOW), 'Yesterday');
  assert.equal(crm.relativeDay('2026-10-31T00:00:00.000Z', NOW), '4 days ago');
  assert.equal(crm.relativeDay('2026-10-21T00:00:00.000Z', NOW), '2 weeks ago');
  assert.equal(crm.relativeDay('2026-08-20T00:00:00.000Z', NOW), '2 months ago');
  assert.equal(crm.relativeDay('2025-10-01T00:00:00.000Z', NOW), 'Over a year ago');
  assert.equal(crm.relativeDay('2023-10-01T00:00:00.000Z', NOW), '3 years ago');
  assert.equal(crm.relativeDay('2026-11-06T00:00:00.000Z', NOW), null);

  const today = plain(crm.activityView(card('a', { activity: exact('2026-11-04T01:12:00.000Z') }), NOW));
  assert.deepEqual([today.tone, today.primary, tidy(today.secondary), today.approximate], ['exact', 'Today', '9:12 AM', false]);
  const earlier = plain(crm.activityView(card('b', { activity: exact('2026-11-03T04:07:00.000Z') }), NOW));
  assert.deepEqual([earlier.primary, tidy(earlier.secondary)], ['Yesterday', 'Nov 3, 12:07 PM']);
  assert.match(tidy(earlier.title), /Nov 3, 2026, 12:07 PM \(Manila time\)/);
  const lastYear = plain(crm.activityView(card('c', { activity: exact('2025-12-30T02:00:00.000Z') }), NOW));
  assert.equal(tidy(lastYear.secondary), 'Dec 30, 2025, 10:00 AM');

  const rough = plain(crm.activityView(card('d', { activity: approx('2026-11-03T02:15:00.000Z') }), NOW));
  assert.deepEqual([rough.tone, rough.primary, rough.secondary, rough.approximate], ['approximate', '≈ Yesterday', 'Time approximate · synced Nov 3', true]);
  assert.doesNotMatch(rough.primary + rough.secondary, /\d:\d\d/);
  const unrecorded = plain(crm.activityView(card('e', { activity: approx('2026-10-01T00:00:00.000Z', false) }), NOW));
  assert.deepEqual([unrecorded.primary, unrecorded.secondary], ['≈ 1 month ago', 'Time not recorded · synced Oct 1']);
  const undated = plain(crm.activityView(card('f', { activity: approx(null) }), NOW));
  assert.deepEqual([undated.primary, undated.secondary], ['Time approximate', '']);
  const none = plain(crm.activityView(card('g'), NOW));
  assert.deepEqual([none.tone, none.primary], ['none', 'No contact recorded']);
});

test('filter state round-trips through the URL and ignores invalid values', () => {
  const s = crm.parseState('?q=santos%20es&platform=Viber,messenger,Bad!,&stage=pilot,won,INTRO&sort=quiet');
  assert.deepEqual([s.q, [...s.platforms], [...s.stages], s.sort], ['santos es', ['viber', 'messenger'], ['pilot', 'intro'], 'quiet']);
  assert.equal(crm.serializeState(s), 'q=santos+es&platform=messenger%2Cviber&stage=intro%2Cpilot&sort=quiet');
  assert.equal(crm.serializeState(crm.parseState('')), '');
  assert.equal(crm.parseState('?sort=constructor').sort, 'recent');
  assert.equal(crm.parseState(`?q=${'x'.repeat(500)}`).q.length, 200);
});

// ---------------------------------------------------------------------------------------------
// Contact fields, organization and first contact

const fc = (at, quality = 'exact', basis = 'message_timestamp', platform = 'messenger', kind = 'direct') => ({ at, quality, basis, platform, conversation_kind: kind });

test('search covers organization, job title, location, contact details and first-contact dates, and composes with filters', () => {
  const rosario = card('Rosario Villaflor', { role: 'teacher', organization: 'Department of Education (DepEd)', channels: [channel('viber', [], true)],
    phones: [{ value: '+639000000001', label: 'mobile', primary: true, source: 'google_contacts' }], first_contact: null });
  const danilo = card('Danilo Ocampo', { role: 'teacher', job_title: 'Instructional Leader', school: 'Mabini Heights ES',
    channels: [channel('messenger', ['direct'], true)], emails: [{ value: 'teacher@example.org', label: 'work', primary: false, source: 'manual_note' }],
    first_contact: fc('2026-09-05T11:25:00.000Z') });
  const liezel = card('Liezel Joy Panganiban', { location: 'Bayugan, Agusan del Sur', department: 'Science Department', channels: [channel('messenger', [], true)],
    first_contact: fc('2026-10-27T05:24:00.000Z', 'approximate', 'relative_label') });
  const list = [rosario, danilo, liezel];
  const find = (q, extra = {}) => names(crm.filterContacts(list, state({ q, ...extra })));
  assert.deepEqual(find('deped'), ['Rosario Villaflor']);
  assert.deepEqual(find('department of education'), ['Rosario Villaflor']);
  assert.deepEqual(find('instructional leader'), ['Danilo Ocampo']);
  assert.deepEqual(find('agusan'), ['Liezel Joy Panganiban']);
  assert.deepEqual(find('science department'), ['Liezel Joy Panganiban']);
  assert.deepEqual(find('9000000001'), ['Rosario Villaflor']);                  // phone digits, with or without "+63"
  assert.deepEqual(find('+639000000001'), ['Rosario Villaflor']);
  assert.deepEqual(find('09000000001'), ['Rosario Villaflor']);                 // national form of a +63 number
  assert.deepEqual(find('example.org'), ['Danilo Ocampo']);
  assert.deepEqual(find('sep 5, 2026'), ['Danilo Ocampo']);                 // first contact date
  assert.deepEqual(find('september 2026'), ['Danilo Ocampo']);
  assert.deepEqual(find('october 2026'), ['Liezel Joy Panganiban']);
  assert.deepEqual(find('deped', { platforms: new Set(['messenger']) }), []);   // search AND channel filter
  assert.deepEqual(find('2026', { platforms: new Set(['messenger']), stages: new Set(['unknown']) }), ['Danilo Ocampo', 'Liezel Joy Panganiban']);
});

test('first-contact sort: earliest first, exact wins a tie, unknown last by name', () => {
  const list = [
    card('No Evidence B'), card('Later Exact', { first_contact: fc('2026-10-20T08:07:00.000Z') }),
    card('No Evidence A'), card('Tie Approx', { first_contact: fc('2026-09-05T11:25:00.000Z', 'approximate', 'relative_label') }),
    card('Tie Exact', { first_contact: fc('2026-09-05T11:25:00.000Z') }), card('Broken', { first_contact: fc('not a time') }),
  ];
  assert.deepEqual(names(crm.sortContacts(list, 'first')), ['Tie Exact', 'Tie Approx', 'Later Exact', 'Broken', 'No Evidence A', 'No Evidence B']);
  assert.equal(crm.parseState('?sort=first').sort, 'first');
  assert.equal(crm.serializeState(crm.parseState('?sort=first')), 'sort=first');
});

test('first-contact wording: exact date, "≈" for a resolved label, "by" for an observation upper bound, nothing without evidence', () => {
  const exact = plain(crm.firstContactView(card('a', { first_contact: fc('2026-09-05T11:25:00.000Z') })));
  assert.deepEqual([exact.value, exact.approximate, exact.where], ['Sep 5, 2026', false, 'Messenger']);
  assert.match(tidy(exact.title), /Sep 5, 2026, 7:25 PM \(Manila time\) on Messenger/);
  const label = plain(crm.firstContactView(card('b', { first_contact: fc('2026-10-27T05:24:00.000Z', 'approximate', 'relative_label') })));
  assert.deepEqual([label.value, label.approximate], ['≈ Oct 27, 2026', true]);
  assert.doesNotMatch(label.value + label.detail, /\d:\d\d/);                     // never a clock time when approximate
  const observed = plain(crm.firstContactView(card('c', { first_contact: fc('2026-10-28T23:20:37.756Z', 'approximate', 'first_observed', 'telegram') })));
  assert.deepEqual([observed.value, observed.where], ['by Oct 29, 2026', 'Telegram']);   // Manila date of an UTC evening
  assert.match(observed.detail, /upper bound/);
  const group = plain(crm.firstContactView(card('d', { first_contact: fc('2026-10-05T02:00:00.000Z', 'exact', 'message_timestamp', 'messenger', 'group') })));
  assert.equal(group.where, 'Messenger group');
  assert.equal(crm.firstContactView(card('e')), null);
  assert.equal(crm.firstContactView(card('f', { first_contact: fc('garbage') })), null);
  assert.match(observed.title, /^Approximate first contact on Telegram: .*upper bound\)\. Earlier messages may predate the capture\.$/);
  for (const v of [exact, label, observed]) assert.match(v.detail, /earliest message on record$/);   // never claimed as the true first contact
  // per-thread lines use the same marks; nothing is shown for a thread without evidence
  const fm = (at, quality = 'exact', basis = 'message_timestamp') => ({ at, quality, basis });
  assert.equal(crm.firstMessageText(fm('2026-09-21T01:35:00.000Z'), NOW), 'first message Sep 21');
  assert.equal(crm.firstMessageText(fm('2026-08-27T01:35:00.000Z', 'approximate', 'first_observed'), NOW), 'first message by Aug 27');
  assert.equal(crm.firstMessageText(fm('2026-10-12T01:35:00.000Z', 'approximate', 'relative_label'), NOW), 'first message ≈ Oct 12');
  assert.equal(crm.firstMessageText(fm('2025-12-30T20:00:00.000Z'), NOW), 'first message Dec 31, 2025');   // Manila date, other year
  for (const none of [null, undefined, fm('garbage'), fm('')]) assert.equal(crm.firstMessageText(none, NOW), '');
});

test('affiliation line prefers the job title, keeps organization apart from school, and never repeats a value', () => {
  assert.equal(crm.affiliationLine(card('a', { role: 'teacher', job_title: 'Instructional Leader', school: 'MHES' })), 'Instructional Leader · MHES');
  assert.equal(crm.affiliationLine(card('b', { role: 'teacher', organization: 'Department of Education (DepEd)' })), 'teacher · Department of Education (DepEd)');
  assert.equal(crm.affiliationLine(card('c', { organization: 'Bituin Foundation', school: 'bituin foundation' })), 'Bituin Foundation');
  assert.equal(crm.affiliationLine(card('d')), '');
  assert.equal(crm.sourceLabel('google_contacts'), 'Google Contacts');
  assert.equal(crm.sourceLabel('constructor'), 'constructor');
  assert.equal(crm.countsText(card('e', { thread_count: 1, extract_count: 2, phones: [{ value: '+639000000001' }], emails: [{ value: 'a@b.org' }, { value: 'c@d.org' }] })),
    '1 thread · 2 extracts · 1 phone · 2 e-mails');
});
