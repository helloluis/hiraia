// Seeds a believable demo teacher through the REAL API and sync engine (no direct DB writes), for the landing
// screenshots. Usage: node scripts/demo-seed.mjs <baseUrl> <dbPath-for-outbox> [email] [password]
// Needs a running tala-web (production build is fine) with TALA_ENV=local and a temp TALA_DB_PATH.
// Run with tsx (tala-core ships TypeScript source):  pnpm exec tsx scripts/demo-seed.mjs <baseUrl> <dbPath>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { engine: pacing } = await import('@hiraia/tala-core/pacing');
const Database = require('better-sqlite3');

const [
  base = 'http://localhost:3105',
  dbPath,
  email = `demo.teacher.${Date.now()}@example.com`,
  password = 'tala-demo-password-2026',
] = process.argv.slice(2);
if (!dbPath)
  throw new Error(
    'dbPath (TALA_DB_PATH of the running server) is required to read the verification mail'
  );
let n = 0;
const newId = () => `demo-${Date.now().toString(36)}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, k) => {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + k);
  return iso(d);
};
const weekday = (s) => {
  const w = new Date(s + 'T12:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
};
const monday = addDays(today, 1 - weekday(today));

const cookieJar = { cookie: '' };
const fetchWithCookies = async (input, init) => {
  const req = new Request(input, init);
  if (cookieJar.cookie) req.headers.set('cookie', cookieJar.cookie);
  const res = await fetch(req);
  const set = res.headers.get('set-cookie');
  if (set) cookieJar.cookie = set.split(';')[0];
  return res;
};
const client = createTalaClient({
  baseUrl: base,
  fetch: fetchWithCookies,
  validateResponses: false,
});

const displayName = 'Gng. Rosario Dimaculangan';
await client.call('auth.register', {
  body: { email, password, displayName, uiLanguage: 'fil', deviceLabel: 'demo seed' },
});
const db = new Database(dbPath, { readonly: true });
const row = db
  .prepare(
    "select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1"
  )
  .get(email);
if (row)
  await client.call('auth.verifyEmail', {
    body: { token: JSON.parse(row.vars).link.split('#token=')[1] },
  });

const engine = createSyncEngine({
  store: createMemoryStore(),
  transport: client.syncTransport,
  deviceId: 'demo-seed',
  now: () => new Date(),
  newId,
});
const put = (entity, data) => engine.put(entity, data);

// School year from the DepEd preset
const presets = (await client.call('calendar.presets')).presets;
const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
const year = {
  id: newId(),
  label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`,
  schoolName: 'Malinaw Elementary School (demo)',
  startDate: preset.startDate,
  endDate: preset.endDate,
  terms: preset.terms.map((t) => ({
    id: newId(),
    index: t.index,
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
  })),
  teachingWeekdays: [1, 2, 3, 4, 5],
  presetId: preset.id,
  presetVersion: preset.version,
  provisional: preset.provisional,
};
await put('school_year', year);
for (const d of preset.days)
  await put('calendar_day', {
    id: newId(),
    schoolYearId: year.id,
    date: d.date,
    kind: d.kind,
    label: d.label,
    classId: null,
    minutesOverride: null,
    source: 'preset',
    followsWeekday: null,
    assignmentIds: null,
  });
await put('profile', {
  id: 'profile',
  displayName,
  uiLanguage: 'fil',
  schoolName: year.schoolName,
  region: 'Region IV-A',
  dataSaver: false,
  activeSchoolYearId: year.id,
  pacingParams: {},
});

const index = await client.call('curriculum.index');
const version =
  index.packs.find((p) => p.learningAreaId === 'science')?.curriculumVersion ?? 'science-bow-2026';
const packs = {};
for (const g of ['3', '4', '5', '6'])
  packs[g] = await client.call('curriculum.pack', {
    params: { packId: `${version}:${g}:science` },
  });
const term = pacing.termForDate(year, today) ?? year.terms[year.terms.length - 1];

async function makeClass({ name, grades, learners, science, mathToo }) {
  const groups = grades.map((grade, i) => ({ id: newId(), grade, learnerCount: learners[i] }));
  const cls = {
    id: newId(),
    schoolYearId: year.id,
    name,
    curriculum: 'deped',
    gradeGroups: groups,
    languages: ['fil'],
    profile: {
      materials: ['chalkboard', 'printed modules', 'manila paper', 'rulers'],
      textbooks: [],
      electricity: true,
      projector: false,
      printing: true,
      outdoorSpace: true,
      notes: 'Multigrade room beside the school garden.',
    },
    isSample: false,
    archived: false,
  };
  await put('class', cls);
  const sci = {
    id: newId(),
    classId: cls.id,
    learningAreaId: 'science',
    subjectName: 'Science',
    gradeGroupIds: groups.map((g) => g.id),
    language: 'en',
    slots: science.map((weekday) => ({
      id: newId(),
      weekday,
      startTime: '08:00',
      minutes: 60,
      rotation: null,
    })),
  };
  await put('assignment', sci);
  if (mathToo)
    await put('assignment', {
      id: newId(),
      classId: cls.id,
      learningAreaId: null,
      subjectName: 'Mathematics',
      gradeGroupIds: groups.map((g) => g.id),
      language: 'fil',
      slots: [1, 2, 3, 4, 5].map((weekday) => ({
        id: newId(),
        weekday,
        startTime: '09:30',
        minutes: 50,
        rotation: null,
      })),
    });
  for (const g of groups) {
    for (const t of year.terms) {
      const track = {
        id: newId(),
        classId: cls.id,
        assignmentId: sci.id,
        gradeGroupId: g.id,
        termId: t.id,
        curriculumVersion: version,
        startPosition: null,
        params: {},
        overrides: {},
        allocation: null,
      };
      const comps = packs[g.grade]?.competencies ?? [];
      if (t.id === term.id && comps.length) {
        const proposed = pacing.proposeStartPosition({
          track,
          schoolYear: year,
          term: t,
          assignment: sci,
          calendarDays: [],
          competencies: comps,
          today,
          defaults: {
            bufferRatio: 0.1,
            assessmentSessionsPerTerm: 2,
            minSessionsPerCompetency: 1,
            assumeTaught: true,
            pairingRule: 'theme_then_sequence',
          },
        });
        // Start this week so the timeline shows paced competencies for every grade (not 'covered before Tala').
        if (proposed)
          track.startPosition = { ...proposed, date: monday < t.startDate ? t.startDate : monday };
      }
      await put('pacing_track', track);
    }
  }
  return { cls, sci, groups };
}

const multi = await makeClass({
  name: 'Grade 3-4-5 Sampaguita (multigrade)',
  grades: ['3', '4', '5'],
  learners: [11, 9, 8],
  science: [1, 3, 5],
  mathToo: true,
});
const g6 = await makeClass({
  name: 'Grade 6 Narra',
  grades: ['6'],
  learners: [34],
  science: [2, 4],
  mathToo: false,
});

// Rosters: invented Filipino names, clearly fictional
const names = {
  3: [
    'Dela Cruz, Juan Miguel',
    'Reyes, Maria Clara',
    'Santos, Jose Rizal Jr.',
    'Bautista, Pedro',
    'Garcia, Ana Marie',
    'Mendoza, Carlos',
    'Torres, Liza',
    'Flores, Mark Anthony',
    'Villanueva, Grace',
    'Ramos, Paolo',
    'Castillo, Jenny',
  ],
  4: [
    'Aquino, Nathaniel',
    'Dizon, Angelica',
    'Navarro, Christian',
    'Pascual, Kristine',
    'Salazar, Joshua',
    'Tolentino, Princess',
    'Velasco, Adrian',
    'Yap, Bea',
    'Zamora, Kyle',
  ],
  5: [
    'Abad, Daniel',
    'Cruz, Sofia',
    'Domingo, Ethan',
    'Enriquez, Mikaela',
    'Fernandez, Lucas',
    'Gonzales, Althea',
    'Hernandez, Rafael',
    'Ignacio, Trisha',
  ],
};
let order = 0;
for (const g of multi.groups)
  for (const full of names[g.grade]) {
    const [family, given] = full.split(', ');
    await put('student', {
      id: newId(),
      classId: multi.cls.id,
      gradeGroupId: g.id,
      displayName: `${given} ${family}`,
      familyName: family,
      givenName: given,
      middleName: '',
      suffix: '',
      sex: null,
      localId: String(++order).padStart(2, '0'),
      order,
      importId: null,
    });
  }

// The real DeepSeek-generated Friction lessons (records exactly as stored), remapped onto this class's groups.
const assets = process.env.TALA_SAMPLE_PLANS_DIR || '/home/b11/code/tala-v1-assets/sample-plans';
const sciDates = pacing.enumerateSessions(year, term, multi.sci, []).map((s) => s.date);
const nextSci =
  sciDates.find((d) => d >= monday && d <= addDays(monday, 6)) ??
  sciDates.find((d) => d >= today) ??
  today;
function loadPlan(file, date, lock) {
  const { plan, sections } = JSON.parse(fs.readFileSync(path.join(assets, file), 'utf8'));
  const map = new Map(plan.gradeGroupIds.map((id, i) => [id, multi.groups[i].id]));
  const remapKeys = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [map.get(k) ?? k, v]));
  const remapContent = (c) => {
    if (c.type === 'pergroup') return { ...c, groups: remapKeys(c.groups) };
    if (c.type === 'multigrade')
      return {
        ...c,
        blocks: c.blocks.map((b) => ({
          ...b,
          id: newId(),
          teacherWith: map.get(b.teacherWith) ?? b.teacherWith,
          pairedGroupIds: b.pairedGroupIds.map((x) => map.get(x) ?? x),
          groups: remapKeys(b.groups),
        })),
      };
    return c;
  };
  const id = newId();
  const nextPlan = {
    ...plan,
    id,
    gradeGroupIds: multi.groups.map((g) => g.id),
    competencies: remapKeys(plan.competencies),
    placements: [{ classId: multi.cls.id, assignmentId: multi.sci.id, dates: [date] }],
    state: lock ? 'locked' : 'draft',
    lock: lock
      ? {
          lockedAt: new Date().toISOString(),
          revisionCode: 'DEMO-7K2',
          revision: null,
          lockedBy: displayName,
        }
      : null,
    aiDraft: !lock,
    aiAssisted: true,
  };
  const nextSections = sections.map((s) => ({
    ...s,
    id: newId(),
    planId: id,
    content: remapContent(s.content),
  }));
  return { plan: nextPlan, sections: nextSections };
}
const en = loadPlan('plan-en.json', nextSci, false);
const fil = loadPlan(
  'plan-fil.json',
  sciDates.find((d) => d > nextSci) ?? addDays(nextSci, 2),
  true
);
for (const { plan, sections } of [en, fil]) {
  for (const s of sections) await put('plan_section', s);
  await put('plan', plan);
}

const report = await engine.sync();
if (!report.ok) throw new Error('sync failed: ' + report.error);
console.log(
  JSON.stringify(
    {
      email,
      password,
      classId: multi.cls.id,
      draftPlanId: en.plan.id,
      lockedPlanId: fil.plan.id,
      pushed: report.pushed,
      week: monday,
    },
    null,
    2
  )
);
