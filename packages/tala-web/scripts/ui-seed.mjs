// Seeds a fictional teacher through the REAL API and sync engine (no direct DB writes) for the teacher-portal
// walk-throughs and screenshots: a school year from the provisional preset, Science classes paced to today, so
// This Week shows a real next teaching day with competencies the teaching-pack library can match.
//
// Usage (tala-core ships TypeScript source, so run with tsx from packages/tala-web):
//   pnpm exec tsx scripts/ui-seed.mjs <baseUrl> [--db <TALA_DB_PATH>] [--teacher a|b] [--email x] [--lang fil|en] [--pace today|term]
// --db is only needed where email verification is on (local outbox); without it the account stays unverified,
// which none of the library / slides / week screens need.
// Everything here is invented: names, school and emails (@example.com) are fictional.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { engine: pacing } = await import('@hiraia/tala-core/pacing');

const argv = process.argv.slice(2);
const base = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:3410';
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const which = opt('teacher', 'a');
const lang = opt('lang', 'fil');
const dbPath = opt('db', '');
const pace = opt('pace', 'today');
const stamp = Date.now().toString(36);
const TEACHERS = {
  a: {
    displayName: 'Gng. Maria Santos',
    school: 'Mabini Elementary School (demo)',
    classes: [
      { name: 'Grade 4 – Sampaguita', grade: '4', learners: 32, start: '08:00', mathToo: true },
      { name: 'Grade 5 – Narra', grade: '5', learners: 29, start: '10:15', mathToo: false },
    ],
  },
  b: {
    displayName: 'G. Ramon Dela Cruz',
    school: 'Bonifacio National High School (demo)',
    classes: [{ name: 'Grade 7 – Mabini', grade: '7', learners: 38, start: '07:30', mathToo: false }],
  },
};
const T = TEACHERS[which] ?? TEACHERS.a;
const email = opt('email', `teacher.${which}.${stamp}@example.com`);
const password = opt('password', `tala-demo-${stamp}-Aa1!`);

let n = 0;
const newId = () => `seed-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const addDays = (s, k) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const weekday = (s) => {
  const w = new Date(s + 'T12:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
};
const monday = addDays(today, 1 - weekday(today));

const jar = { cookie: '' };
const fetchWithCookies = async (input, init) => {
  const req = new Request(input, init);
  if (jar.cookie) req.headers.set('cookie', jar.cookie);
  const res = await fetch(req);
  const set = res.headers.get('set-cookie');
  if (set) jar.cookie = set.split(';')[0];
  return res;
};
const client = createTalaClient({ baseUrl: base, fetch: fetchWithCookies, validateResponses: false });

await client.call('auth.register', {
  body: { email, password, displayName: T.displayName, uiLanguage: lang, deviceLabel: 'ui seed' },
});
if (dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db
    .prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1")
    .get(email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
}

const engine = createSyncEngine({
  store: createMemoryStore(),
  transport: client.syncTransport,
  deviceId: `ui-seed-${stamp}`,
  now: () => new Date(),
  newId,
});
const put = (entity, data) => engine.put(entity, data);

const presets = (await client.call('calendar.presets')).presets;
const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
const year = {
  id: newId(),
  label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`,
  schoolName: T.school,
  startDate: preset.startDate,
  endDate: preset.endDate,
  terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
  teachingWeekdays: [1, 2, 3, 4, 5],
  presetId: preset.id,
  presetVersion: preset.version,
  provisional: preset.provisional,
};
await put('school_year', year);
for (const d of preset.days)
  await put('calendar_day', {
    id: newId(), schoolYearId: year.id, date: d.date, kind: d.kind, label: d.label, classId: null,
    minutesOverride: null, source: 'preset', followsWeekday: null, assignmentIds: null,
  });
await put('profile', {
  id: 'profile', displayName: T.displayName, uiLanguage: lang, schoolName: T.school, region: 'Region IV-A',
  dataSaver: false, activeSchoolYearId: year.id, pacingParams: {},
});

const index = await client.call('curriculum.index');
const version = index.packs.find((p) => p.learningAreaId === 'science')?.curriculumVersion ?? 'science-bow-2026';
const term = pacing.termForDate(year, today) ?? year.terms[year.terms.length - 1];
const out = { baseUrl: base, email, password, displayName: T.displayName, today, term: term.index, classes: [] };

for (const c of T.classes) {
  const pack = await client.call('curriculum.pack', { params: { packId: `${version}:${c.grade}:science` } });
  const group = { id: newId(), grade: c.grade, learnerCount: c.learners };
  const cls = {
    id: newId(), schoolYearId: year.id, name: c.name, curriculum: 'deped', gradeGroups: [group], languages: [lang === 'fil' ? 'fil' : 'en'],
    profile: {
      materials: ['chalkboard', 'manila paper', 'TV with HDMI'], textbooks: [], electricity: true, projector: false,
      printing: true, outdoorSpace: true, notes: '',
    },
    isSample: false, archived: false,
  };
  await put('class', cls);
  const [hh, mm] = c.start.split(':').map(Number);
  const sci = {
    id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: [group.id], language: 'en',
    slots: [1, 2, 3, 4, 5].map((wd) => ({ id: newId(), weekday: wd, startTime: c.start, minutes: 45, rotation: null })),
  };
  await put('assignment', sci);
  if (c.mathToo) {
    const t2 = `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    await put('assignment', {
      id: newId(), classId: cls.id, learningAreaId: null, subjectName: 'Mathematics', gradeGroupIds: [group.id], language: 'fil',
      slots: [1, 2, 3, 4, 5].map((wd) => ({ id: newId(), weekday: wd, startTime: t2, minutes: 50, rotation: null })),
    });
  }
  for (const t of year.terms) {
    const track = {
      id: newId(), classId: cls.id, assignmentId: sci.id, gradeGroupId: group.id, termId: t.id, curriculumVersion: version,
      startPosition: null, params: {}, overrides: {}, allocation: null,
    };
    // --pace today (default): any-day onboarding, as the set-up wizard does. --pace term: the teacher has been
    // pacing since the term started (no start position), so this week sits where the Budget of Work prints it.
    if (pace === 'today' && t.id === term.id && pack.competencies.length) {
      const proposed = pacing.proposeStartPosition({
        track, schoolYear: year, term: t, assignment: sci, calendarDays: [], competencies: pack.competencies, today,
        defaults: { bufferRatio: 0.1, assessmentSessionsPerTerm: 2, minSessionsPerCompetency: 1, assumeTaught: true, pairingRule: 'theme_then_sequence' },
      });
      if (proposed) track.startPosition = { ...proposed, date: monday < t.startDate ? t.startDate : monday };
    }
    await put('pacing_track', track);
  }
  out.classes.push({ id: cls.id, name: cls.name, grade: c.grade, groupId: group.id, scienceAssignmentId: sci.id });
}
// Push everything (a cycle uploads at most one page of mutations): repeat until the outbox is empty.
let pending = -1;
for (let i = 0; i < 20; i++) {
  const report = await engine.sync();
  const st = await engine.status();
  pending = st.pending;
  if (!pending) break;
  if (report && report.ok === false) await new Promise((r) => setTimeout(r, 500));
}
out.pendingAfterSync = pending;
console.log(JSON.stringify(out, null, 1));
