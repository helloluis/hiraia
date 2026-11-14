/**
 * ACCEPTANCE: a teacher of a multi-grade class builds a one-hour lesson with the model's help, adjusts it,
 * locks it and exports it.
 *
 *   Persona   Gng. Maria Santos, one room, 15 learners: Grade 3 (6), Grade 4 (5), Grade 5 (4).
 *             No electricity, no printing; a short list of things actually in the room.
 *   Lesson    Science, FRICTION, 60 minutes, one session for all three grades.
 *   Grounding The competencies are the real DepEd records in the repository's Science packs
 *             (2026 Budget of Work, Grades 3–5). The plan must align to those, not to invented ones.
 *   Lifecycle roster import → class → generate (model) → teacher adjusts → re-validate → lock → PDF.
 *
 * Two modes, same assertions:
 *   - default: a deterministic scripted model. No network. This is what CI runs.
 *   - TALA_ACCEPTANCE_LIVE=1: the real gateway, DeepSeek primary with Qwen fallback, on their direct APIs.
 *     Keys are read from the environment by NAME (DEEPSEEK_API_KEY; DASHSCOPE_API_KEY or ALIBABACLOUD_API_KEY)
 *     and are never printed. Two live calls (English and Filipino).
 *   - TALA_ACCEPTANCE_OUT=<dir>: also write the generated and adjusted plans (text, HTML, PDF, JSON) there.
 *
 * Everything runs on the real module registry through the real client sync engine; only the model is
 * swapped in the default mode.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BUILTIN_TEMPLATES,
  GenerationInput,
  parseRecordData,
  plan as planHelpers,
  print as printHelpers,
  sync as syncEngine,
} from '@hiraia/tala-core';
import type {
  ClassRecord,
  Competency,
  GenerationJob,
  Plan,
  PlanSection,
  SchoolYear,
  SectionContent,
  SyncEngine,
} from '@hiraia/tala-core';
import { validateGeneratedSections } from '@hiraia/tala-core/generation';
import type { LlmRequest } from '../../kernel/types';
import { modules as registry } from '../../modules';
import { createFakeLlm, createTestServer } from '../index';
import type { TestServer, TestUser } from '../index';

const LIVE = process.env.TALA_ACCEPTANCE_LIVE === '1';
const OUT = process.env.TALA_ACCEPTANCE_OUT;
const MG = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.multigrade.v1')!;
const CURRICULUM_VERSION = 'science-bow-2026';
const MINUTES = 60;

/** What is actually in the room. Deliberately more than "paper, pencils", and nothing powered. */
const MATERIALS = [
  'chalkboard and chalk',
  'wooden board (for a ramp)',
  'books (to raise the ramp)',
  'sandpaper',
  'cloth or towel',
  'plastic sheet',
  'small toy car or bottle cap',
  'ruler or meter stick',
  'notebook',
  'pencil',
];

/** Invented names only. Six in Grade 3, five in Grade 4, four in Grade 5. */
const ROSTER: Record<'3' | '4' | '5', Array<[family: string, given: string]>> = {
  '3': [
    ['Aguilar', 'Bituin'],
    ['Bautista', 'Dakila'],
    ['Castillo', 'Hiraya'],
    ['Domingo', 'Lakan'],
    ['Espino', 'Mayumi'],
    ['Francisco', 'Luningning'],
  ],
  '4': [
    ['Garcia', 'Amihan'],
    ['Hernandez', 'Bayani'],
    ['Ilagan', 'Diwata'],
    ['Javier', 'Ligaya'],
    ['Katigbak', 'Makisig'],
  ],
  '5': [
    ['Lualhati', 'Sinag'],
    ['Mendoza', 'Tadhana'],
    ['Navarro', 'Ulan'],
    ['Ocampo', 'Dalisay'],
  ],
};
const ROSTER_TEXT = (['3', '4', '5'] as const)
  .map(
    (g) =>
      `Grade ${g}\n` + ROSTER[g].map(([f, n], i) => `${i + 1}. ${f.toUpperCase()}, ${n}`).join('\n')
  )
  .join('\n');
const ALL_NAMES = Object.values(ROSTER).flatMap((rows) => rows.flatMap(([f, g]) => [f, g]));

/** The real competencies this lesson is built on, by the end of their stored id. */
const WANTED: Record<'3' | '4' | '5', string[]> = {
  '3': ['.science.g3.t2.9'], // …things that affect the movement of objects, including … surface texture
  '4': ['.science.g4.t2.6'], // Measure accurately the distance and time when things move…
  '5': ['.science.g5.t2.8', '.science.g5.t2.9'], // frictional forces; friction and heat
};

type Lang = 'en' | 'fil';

async function step<T>(what: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const wrapped = new Error(`[${what}] ${err instanceof Error ? err.message : String(err)}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
}

/* ------------------------------------------------------------------------------------------------
 * The scripted model for the default mode. It is given exactly what the real model is given and answers
 * in the same compact format, using only the objective references, time slots and materials it was sent.
 * ---------------------------------------------------------------------------------------------- */
const SCRIPT: Record<
  Lang,
  {
    title: string;
    labels: (grade: string) => { open: string; direct: string; close: string };
    objective: Record<string, string>;
    open: Record<string, string>;
    direct: Record<string, string>;
    alone: Record<string, [string, string]>;
    close: Record<string, string>;
    assess: Record<string, string>;
    reflection: string;
  }
> = {
  en: {
    title: 'Friction on Different Surfaces: a Ramp Investigation',
    labels: (g) => ({
      open: 'Opening',
      direct: `Grade ${g} with the teacher`,
      close: 'Closing',
    }),
    objective: {
      '3': 'Say which surface is rough and which is smooth, and how each changes the way the car moves.',
      '4': 'Use the ruler to measure how far the car rolls on each surface and count the seconds it takes.',
      '5': 'Plan a fair test of which surface gives the most friction, and show that rubbing makes heat.',
    },
    open: {
      '3': 'Feel the sandpaper, cloth and plastic sheet and say which is rough and which is smooth.',
      '4': 'Guess which surface will let the car roll farthest and write the guess in your notebook.',
      '5': 'Write one question about how the surface changes friction and how you could test it.',
    },
    direct: {
      '3': 'With the teacher, roll the car down the ramp on each surface and describe how the surface changes its movement.',
      '4': 'With the teacher, measure with the ruler how far the car rolls on each surface and count the seconds aloud.',
      '5': 'With the teacher, compare your results, explain which surface has the most friction, and rub two surfaces to feel the heat.',
    },
    alone: {
      '3': [
        'On your own, draw the three surfaces and label each one rough or smooth.',
        'On your own, write one sentence about where the car moved slowest and why.',
      ],
      '4': [
        'On your own, set up the ramp on two books and practise measuring three rolls with the ruler.',
        'On your own, copy your measurements into a table and circle the longest distance.',
      ],
      '5': [
        'On your own, write the plan for your friction test: question, prediction, steps and what you will measure.',
        'On your own, run the test on two surfaces and record the distance for each.',
      ],
    },
    close: {
      '3': 'Name one surface that slowed the car and one that let it go fast.',
      '4': 'Read one distance you measured and say which surface gave it.',
      '5': 'State one finding about friction and one way to reduce it.',
    },
    assess: {
      '3': 'Ask the learner to point to the rough and the smooth surface and say how each changed the movement.',
      '4': 'Check the notebook table: the learner shows how the ruler was used and how the time was counted.',
      '5': 'Read the written plan and results; the learner explains which surface gave the most friction and how rubbing showed heat.',
    },
    reflection: 'Note how the shared ramp worked for three grades and what to change next time.',
  },
  fil: {
    title: 'Friction sa Iba’t Ibang Ibabaw: Pagsisiyasat Gamit ang Rampa',
    labels: (g) => ({
      open: 'Pagbubukas',
      direct: `Baitang ${g} kasama ang guro`,
      close: 'Pagtatapos',
    }),
    objective: {
      '3': 'Sabihin kung aling ibabaw ang magaspang at alin ang makinis, at kung paano nito binabago ang galaw ng kotse.',
      '4': 'Gamitin ang ruler upang sukatin kung gaano kalayo ang narating ng kotse sa bawat ibabaw at bilangin ang segundo.',
      '5': 'Magplano ng patas na pagsubok kung aling ibabaw ang may pinakamalakas na friction, at ipakita na nagdudulot ng init ang pagkiskis.',
    },
    open: {
      '3': 'Hawakan ang sandpaper, tela at plastik at sabihin kung alin ang magaspang at alin ang makinis.',
      '4': 'Hulaan kung aling ibabaw ang pinakamalayo ang mararating ng kotse at isulat ang hula sa kuwaderno.',
      '5': 'Sumulat ng isang tanong kung paano binabago ng ibabaw ang friction at kung paano ito masusubok.',
    },
    direct: {
      '3': 'Kasama ang guro, padausdusin ang kotse sa rampa sa bawat ibabaw at ilarawan kung paano nagbabago ang galaw nito.',
      '4': 'Kasama ang guro, sukatin gamit ang ruler kung gaano kalayo ang narating ng kotse sa bawat ibabaw at bilangin nang malakas ang segundo.',
      '5': 'Kasama ang guro, ihambing ang mga resulta, ipaliwanag kung aling ibabaw ang may pinakamalakas na friction, at pagkiskisin ang dalawang ibabaw upang maramdaman ang init.',
    },
    alone: {
      '3': [
        'Mag-isa, iguhit ang tatlong ibabaw at lagyan ang bawat isa ng salitang magaspang o makinis.',
        'Mag-isa, sumulat ng isang pangungusap kung saan pinakamabagal ang kotse at kung bakit.',
      ],
      '4': [
        'Mag-isa, ayusin ang rampa sa ibabaw ng dalawang aklat at magsanay sumukat ng tatlong padausdos gamit ang ruler.',
        'Mag-isa, ilipat ang mga sukat sa isang talaan at bilugan ang pinakamahabang layo.',
      ],
      '5': [
        'Mag-isa, isulat ang plano ng pagsubok sa friction: tanong, hula, mga hakbang at kung ano ang susukatin.',
        'Mag-isa, gawin ang pagsubok sa dalawang ibabaw at itala ang layo sa bawat isa.',
      ],
    },
    close: {
      '3': 'Magsabi ng isang ibabaw na nagpabagal sa kotse at isang nagpabilis dito.',
      '4': 'Basahin ang isang layo na nasukat mo at sabihin kung aling ibabaw iyon.',
      '5': 'Magsabi ng isang natuklasan tungkol sa friction at isang paraan upang bawasan ito.',
    },
    assess: {
      '3': 'Ipaturo sa mag-aaral ang magaspang at ang makinis na ibabaw at ipasabi kung paano nito binago ang galaw.',
      '4': 'Tingnan ang talaan sa kuwaderno: ipakita ng mag-aaral kung paano ginamit ang ruler at paano binilang ang oras.',
      '5': 'Basahin ang nakasulat na plano at resulta; ipaliwanag ng mag-aaral kung aling ibabaw ang may pinakamalakas na friction at paano ipinakita ng pagkiskis ang init.',
    },
    reflection:
      'Itala kung paano gumana ang iisang rampa para sa tatlong baitang at kung ano ang babaguhin.',
  },
};

function scriptedFrictionLesson(request: LlmRequest<unknown>): unknown {
  const asked = JSON.parse(request.vars.input ?? '{}') as {
    language: Lang;
    groups: Array<{ grade: string; objectives: Array<{ ref: string }> }>;
    schedule: Array<{ slot: number; teacherWith: string }>;
    sections: Array<{ key: string; format: string }>;
    profile?: { materials?: string[] };
  };
  const s = SCRIPT[asked.language];
  const available = asked.profile?.materials ?? [];
  const has = (needle: string) => available.filter((m) => m.includes(needle));
  const shared = [
    ...has('wooden board'),
    ...has('books'),
    ...has('sandpaper'),
    ...has('cloth'),
    ...has('plastic'),
    ...has('toy car'),
    ...has('notebook'),
    ...has('pencil'),
  ];
  const lastSlot = Math.max(...asked.schedule.map((x) => x.slot));
  const seen: Record<string, number> = {};
  return {
    title: s.title,
    sections: asked.sections.map((section) => {
      if (section.format === 'pergroup') {
        if (section.key === 'materials')
          return {
            key: section.key,
            groups: asked.groups.map((g) => ({
              grade: g.grade,
              items: g.grade === '3' ? shared : [...shared, ...has('ruler')],
            })),
          };
        const texts = section.key === 'assessment' ? s.assess : s.objective;
        return {
          key: section.key,
          groups: asked.groups.map((g) => ({
            grade: g.grade,
            text: texts[g.grade],
            targets: g.objectives.map((o) => o.ref),
          })),
        };
      }
      if (section.format === 'multigrade')
        return {
          key: section.key,
          blocks: asked.schedule.map((slot) => {
            const labels = s.labels(slot.teacherWith);
            return {
              slot: slot.slot,
              label:
                slot.slot === 1
                  ? labels.open
                  : slot.slot === lastSlot
                    ? labels.close
                    : labels.direct,
              activities: asked.groups.map((g) => {
                if (slot.slot === 1) return { grade: g.grade, text: s.open[g.grade] };
                if (slot.slot === lastSlot) return { grade: g.grade, text: s.close[g.grade] };
                if (slot.teacherWith === g.grade)
                  return { grade: g.grade, text: s.direct[g.grade] };
                const turn = seen[g.grade] ?? 0;
                seen[g.grade] = turn + 1;
                return { grade: g.grade, text: s.alone[g.grade]![turn % 2] };
              }),
            };
          }),
        };
      if (section.format === 'text') return { key: section.key, text: s.reflection };
      throw new Error(`scripted model: no script for a "${section.format}" part`);
    }),
  };
}

/* ------------------------------------------------------------------------------------------------ */

function device(t: TestServer, user: TestUser, name: string) {
  let n = 0;
  const newId = () => `${name}-${String(++n).padStart(6, '0')}`;
  const engine: SyncEngine = syncEngine.createSyncEngine({
    store: syncEngine.createMemoryStore(),
    transport: t.client(user.token).syncTransport,
    deviceId: `device-${name}`,
    now: () => t.clock.now(),
    newId,
  });
  return { engine, newId };
}

async function cleanSync(engine: SyncEngine): Promise<void> {
  const r = await engine.sync();
  assert.deepEqual(
    {
      ok: r.ok,
      error: r.error,
      conflicts: r.conflicts,
      rejected: r.rejected,
      copies: r.lockCopies.length,
    },
    { ok: true, error: null, conflicts: 0, rejected: 0, copies: 0 },
    'sync did not go through cleanly'
  );
}

async function waitForJob(t: TestServer, token: string, jobId: string): Promise<GenerationJob> {
  const deadline = Date.now() + (LIVE ? 240_000 : 10_000);
  while (Date.now() < deadline) {
    const job = await t.ok('generation.get', { token, params: { jobId } });
    if (job.status === 'done') return job;
    if (job.status === 'failed' || job.status === 'cancelled')
      throw new Error(
        `generation ended as ${job.status}: ${job.failure?.reason} ${job.failure?.message}`
      );
    await new Promise((resolve) => setTimeout(resolve, LIVE ? 500 : 10));
  }
  throw new Error('generation did not finish in time');
}

/**
 * The words a teacher actually reads in a piece of content: span text, list items, labels and titles.
 * Structural values (record ids, modes, which group the teacher is with) are not text and are left out.
 */
const NOT_TEXT = new Set([
  'id',
  't',
  'type',
  'mode',
  'teacherWith',
  'pairedGroupIds',
  'key',
  'date',
  'weekday',
]);
function readable(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) readable(v, out);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) if (!NOT_TEXT.has(k)) readable(v, out);
  return out;
}
const text = (content: unknown, _groupIds: string[] = []) => readable(content).join('\n');
const words = (s: string) => new Set(s.toLowerCase().match(/[a-zñáéíóú'’-]{3,}/g) ?? []);
function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  const both = [...x].filter((w) => y.has(w)).length;
  return both / Math.max(1, x.size + y.size - both);
}
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Topic words: the plan must be about friction and surfaces, in whichever language it is written. */
const TOPIC =
  /friction|friksyon|frictional|surface|ibabaw|rough|smooth|magaspang|makinis|ramp|rampa|kiskis|alitan/i;
/** Function words that only occur in Filipino running text (not "at"/"sa", which collide with English). */
const FILIPINO = /\b(ang|mga|ng|kung|bawat|nang|upang|gamit|kasama|isulat|sabihin|alin)\b/gi;
/** Powered equipment has no place in a room without electricity. */
const POWERED =
  /projector|laptop|computer|video|slideshow|powerpoint|printer|photocop|tablet|speaker/i;

interface World {
  t: TestServer;
  teacher: TestUser;
  phone: ReturnType<typeof device>;
  schoolYear: SchoolYear;
  klass: ClassRecord;
  assignmentId: string;
  groups: Array<{ id: string; grade: '3' | '4' | '5'; learnerCount: number }>;
  chosen: Record<string, Competency[]>;
  packIds: Set<string>;
  llm: ReturnType<typeof createFakeLlm> | null;
}

/** Sign-up, the real packs, the class of 15 with its roster, and the Science assignment. Runs once. */
async function buildWorld(): Promise<World> {
  const llm = LIVE
    ? null
    : createFakeLlm({
        answers: { 'lesson.generate': scriptedFrictionLesson },
        routes: { 'roster.names': 'rules', 'roster.columns': 'rules' },
        provider: 'deepseek',
      });
  const fallbackKey = process.env.DASHSCOPE_API_KEY ? 'DASHSCOPE_API_KEY' : 'ALIBABACLOUD_API_KEY';
  const rate = (name: string, otherwise: number) =>
    Number.isFinite(Number(process.env[name])) && process.env[name]
      ? Number(process.env[name])
      : otherwise;
  if (LIVE)
    assert.ok(
      process.env.DEEPSEEK_API_KEY,
      'TALA_ACCEPTANCE_LIVE=1 needs DEEPSEEK_API_KEY in the environment (load packages/tala-server/.env first)'
    );
  const t = createTestServer({
    modules: registry.filter((m) => m.name !== 'core'),
    ...(llm ? { services: { llm } } : {}),
    now: '2026-11-16T00:00:00.000Z',
    quiet: true,
    config: LIVE
      ? {
          features: { generation: true, community: true, rosterAi: true, googleSignIn: false },
          llm: {
            primary: {
              apiKeyEnv: 'DEEPSEEK_API_KEY',
              baseUrl: 'https://api.deepseek.com',
              model: process.env.TALA_LLM_PRIMARY_MODEL || 'deepseek-flash',
              timeoutMs: 120_000,
              // Conservative list price used only to meter the test's own spend.
              pricing: {
                inputUsdPerMillion: rate('TALA_LLM_PRIMARY_INPUT_USD_PER_MILLION', 0.3),
                outputUsdPerMillion: rate('TALA_LLM_PRIMARY_OUTPUT_USD_PER_MILLION', 1.2),
              },
            },
            fallback: {
              apiKeyEnv: fallbackKey,
              baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
              model: process.env.TALA_LLM_FALLBACK_MODEL || 'qwen-flash',
              timeoutMs: 120_000,
              pricing: {
                inputUsdPerMillion: rate('TALA_LLM_FALLBACK_INPUT_USD_PER_MILLION', 0.3),
                outputUsdPerMillion: rate('TALA_LLM_FALLBACK_OUTPUT_USD_PER_MILLION', 1.2),
              },
            },
          },
        }
      : {},
  });

  const teacher = await t.registerUser({
    email: 'maria.santos@example.test',
    displayName: 'Gng. Maria Santos',
  });
  const phone = device(t, teacher, 'phone');

  const { chosen, packIds } = await step(
    'the DepEd Science packs for Grades 3–5 are in the repository',
    async () => {
      const index = await t.ok('curriculum.index', {});
      const chosen: Record<string, Competency[]> = {};
      const packIds = new Set<string>();
      for (const grade of ['3', '4', '5'] as const) {
        const meta = index.packs.find(
          (p) =>
            p.grade === grade &&
            p.learningAreaId === 'science' &&
            p.curriculumVersion === CURRICULUM_VERSION
        );
        assert.ok(meta, `no real Science pack for Grade ${grade}`);
        const pack = await t.ok('curriculum.pack', { params: { packId: meta.packId } });
        for (const c of pack.competencies) packIds.add(c.id);
        chosen[grade] = WANTED[grade].map((suffix) => {
          const c = pack.competencies.find((x) => x.id.endsWith(suffix));
          assert.ok(c, `competency …${suffix} is not in the Grade ${grade} pack`);
          // A source document and page are what make this DepEd material and not sample data.
          assert.ok(
            c.source.document.length > 5 && typeof c.source.page === 'number',
            `${c.id} has no source page`
          );
          assert.ok(!/sample data/i.test(c.text), `${c.id} is fixture text`);
          return c;
        });
      }
      assert.match(chosen['3']![0]!.text, /surface texture/i);
      assert.match(chosen['4']![0]!.text, /distance and time/i);
      assert.match(chosen['5']![0]!.text, /frictional forces/i);
      assert.match(chosen['5']![1]!.text, /friction can produce heat/i);
      return { chosen, packIds };
    }
  );

  const groups = (['3', '4', '5'] as const).map((grade) => ({
    id: phone.newId(),
    grade,
    learnerCount: ROSTER[grade].length,
  }));
  const ids = { schoolYear: phone.newId(), klass: phone.newId(), assignment: phone.newId() };

  const { schoolYear, klass } = await step(
    'school year, the class of 15 and its Science hour',
    async () => {
      const calendar = await t.ok('calendar.preset', { params: { presetId: 'deped-2026-2027' } });
      const schoolYear = parseRecordData('school_year', {
        id: ids.schoolYear,
        label: '2026-2027',
        schoolName: 'Mababang Paaralan ng San Isidro',
        startDate: calendar.startDate,
        endDate: calendar.endDate,
        terms: calendar.terms.map((term) => ({ ...term, id: phone.newId() })),
        presetId: calendar.id,
        presetVersion: calendar.version,
        provisional: calendar.provisional,
      });
      const klass = parseRecordData('class', {
        id: ids.klass,
        schoolYearId: ids.schoolYear,
        name: 'Multigrade 3-4-5 Sampaguita',
        curriculum: 'deped',
        gradeGroups: groups,
        languages: ['fil', 'en'],
        profile: {
          materials: MATERIALS,
          electricity: false,
          projector: false,
          printing: false,
          outdoorSpace: true,
        },
      });
      assert.equal(
        klass.gradeGroups.reduce((n, g) => n + (g.learnerCount ?? 0), 0),
        15
      );
      await phone.engine.batch([
        { op: 'put', entity: 'school_year', data: schoolYear },
        { op: 'put', entity: 'class', data: klass },
        {
          op: 'put',
          entity: 'assignment',
          data: parseRecordData('assignment', {
            id: ids.assignment,
            classId: ids.klass,
            learningAreaId: 'science',
            subjectName: 'Science',
            gradeGroupIds: groups.map((g) => g.id),
            language: 'en',
            slots: [1, 2, 3, 4, 5].map((weekday) => ({
              id: phone.newId(),
              weekday,
              startTime: '09:00',
              minutes: MINUTES,
            })),
          }),
        },
      ]);
      await cleanSync(phone.engine);
      return { schoolYear, klass };
    }
  );

  await step(
    'the teacher pastes her class list; 15 learners land in the right grade groups',
    async () => {
      const draft = await t.ok('roster.import', {
        token: teacher.token,
        body: { classId: ids.klass, filename: 'klase.txt', text: ROSTER_TEXT, useAi: false },
      });
      assert.equal(draft.aiUsed, false, 'no learner name may go to a model in this test');
      const confirmed = await t.ok('roster.confirm', {
        token: teacher.token,
        params: { importId: draft.importId },
        body: {
          resolutions: draft.rows
            .filter((r) => r.status === 'needs_review')
            .map((r) => ({ rowIndex: r.rowIndex, action: 'accept' as const })),
          acceptAllChanged: true,
          idempotencyKey: phone.newId(),
        },
      });
      assert.deepEqual(confirmed.pendingRows, []);
      assert.equal(confirmed.students.length, 15, 'the import did not produce exactly 15 learners');
      await phone.engine.batch(
        confirmed.students.map((s, order) => {
          const { rowIndex: _rowIndex, grade, gradeGroupId: _gradeGroupId, ...fields } = s;
          const group = groups.find((g) => g.grade === grade);
          assert.ok(group, `the grade of "${s.displayName}" was not read from the list`);
          return {
            op: 'put' as const,
            entity: 'student' as const,
            data: parseRecordData('student', {
              ...fields,
              id: phone.newId(),
              classId: ids.klass,
              gradeGroupId: group.id,
              order,
            }),
          };
        })
      );
      await cleanSync(phone.engine);
      const stored = t.services.records.list(teacher.id, 'student').map((r) => r.data);
      assert.equal(stored.length, 15);
      for (const g of groups)
        assert.equal(
          stored.filter((s) => s.gradeGroupId === g.id).length,
          g.learnerCount,
          `Grade ${g.grade} head count`
        );
    }
  );

  return {
    t,
    teacher,
    phone,
    schoolYear,
    klass,
    assignmentId: ids.assignment,
    groups,
    chosen,
    packIds,
    llm,
  };
}

async function lessonLifecycle(w: World, language: Lang): Promise<void> {
  const { t, teacher, phone, groups, chosen } = w;
  const groupIds = groups.map((g) => g.id);
  const planId = phone.newId();
  const competencies = Object.fromEntries(
    groups.map((g) => [g.id, chosen[g.grade]!.map((c) => c.id)])
  );
  const storedText = (grade: string) => chosen[grade]!.map((c) => c.text);
  const save = (name: string, data: string | Uint8Array) => {
    if (!OUT) return;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${name}`, data);
  };

  await step(
    `${language}: a blank multi-grade plan tagged to the four DepEd competencies`,
    async () => {
      await phone.engine.batch([
        {
          op: 'put',
          entity: 'plan',
          data: parseRecordData('plan', {
            id: planId,
            templateId: MG.id,
            language,
            subjectName: 'Science',
            learningAreaId: 'science',
            grades: ['3', '4', '5'],
            gradeGroupIds: groupIds,
            competencies,
            curriculumVersion: CURRICULUM_VERSION,
            durationMinutes: MINUTES,
            placements: [
              { classId: w.klass.id, assignmentId: w.assignmentId, dates: ['2026-11-18'] },
            ],
          }),
        },
        ...planHelpers
          .blankSections(MG, planId, groups, phone.newId)
          .map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
      ]);
      await cleanSync(phone.engine);
    }
  );

  const request = GenerationInput.parse({
    kind: 'full',
    idempotencyKey: phone.newId(),
    planId,
    templateId: MG.id,
    language,
    subjectName: 'Science',
    learningAreaId: 'science',
    timeBudgetMinutes: MINUTES,
    gradeGroups: groups,
    competencies,
    curriculumVersion: CURRICULUM_VERSION,
    classProfile: w.klass.profile,
    guidance:
      'Topic: friction — how different surfaces change the way things move. One shared activity: a ramp made from the wooden board raised on books, covered in turn with sandpaper, cloth and the plastic sheet.',
  });
  const draftInput = {
    ...request,
    template: MG,
    resolvedCompetencies: Object.fromEntries(
      groups.map((g) => [g.id, chosen[g.grade]!.map((c) => ({ code: c.code, text: c.text }))])
    ),
  };

  const started = Date.now();
  const job = await step(
    `${language}: the model drafts the lesson (${LIVE ? 'live' : 'scripted'})`,
    async () => {
      const callsBefore = w.llm?.calls.length ?? 0;
      const created = await t.ok('generation.create', { token: teacher.token, body: request });
      const done = await waitForJob(t, teacher.token, created.id);
      assert.ok(done.result, 'the job finished without a result');
      if (w.llm) {
        assert.equal(w.llm.calls.length, callsBefore + 1, 'exactly one model call per lesson');
        const call = w.llm.calls.at(-1)!;
        const sent = call.vars.input ?? '';
        // Grounding: the model is handed the stored DepEd text for every selected competency…
        for (const c of Object.values(chosen).flat())
          assert.ok(sent.includes(c.text), `the stored text of ${c.id} was not given to the model`);
        // …the size of each group…
        const sentGroups = (JSON.parse(sent) as { groups: Array<Record<string, unknown>> }).groups;
        for (const g of groups) {
          const row = sentGroups.find((x) => x.grade === g.grade);
          assert.ok(
            row && Object.values(row).includes(g.learnerCount),
            `the model was not told that Grade ${g.grade} has ${g.learnerCount} learners`
          );
        }
        // …and never a learner's name.
        for (const name of ALL_NAMES)
          assert.ok(
            !JSON.stringify(call.vars).includes(name),
            `learner name "${name}" was sent to the model`
          );
      } else {
        assert.equal(done.result.provider, 'deepseek', 'the live draft did not come from DeepSeek');
      }
      return done;
    }
  );
  const seconds = (Date.now() - started) / 1000;
  const generated = job.result!.sections;
  const byKey = (sections: Array<{ key: string; content: SectionContent }>, key: string) => {
    const s = sections.find((x) => x.key === key);
    assert.ok(s, `the plan has no "${key}" part`);
    return s.content;
  };

  /** Everything that must hold for the draft AND again after the teacher's edits. */
  const assertSound = (sections: Array<{ key: string; content: SectionContent }>, when: string) => {
    assert.deepEqual(
      validateGeneratedSections(draftInput, sections),
      [],
      `${when}: the shared multi-grade rules do not hold`
    );
    const flow = byKey(sections, 'multigrade');
    assert.equal(flow.type, 'multigrade');
    if (flow.type !== 'multigrade') return;

    // Timing: the blocks add up to exactly one hour.
    assert.equal(
      flow.blocks.reduce((n, b) => n + b.minutes, 0),
      MINUTES,
      `${when}: the time blocks do not add up to ${MINUTES} minutes`
    );

    // Three grade tracks: every grade has an activity in every block, and gets the teacher at least once.
    for (const g of groups) {
      for (const b of flow.blocks) {
        const a = b.groups[g.id];
        assert.ok(
          a && text({ type: 'text', blocks: a.activity }).trim().length > 10,
          `${when}: Grade ${g.grade} has nothing to do in "${b.label}"`
        );
      }
      assert.ok(
        flow.blocks.some((b) => b.teacherWith === g.id && b.groups[g.id]?.mode === 'direct'),
        `${when}: Grade ${g.grade} never gets the teacher`
      );
    }
    // One teacher: she is never directly teaching two grades in the same block.
    for (const b of flow.blocks)
      assert.ok(
        Object.values(b.groups).filter((a) => a.mode === 'direct').length <= 1,
        `${when}: the teacher is with two grades at once in "${b.label}"`
      );

    // Differentiated: the three grades are not doing the same thing, and each is on topic.
    const track = (gid: string) =>
      flow.blocks.map((b) => text({ type: 'text', blocks: b.groups[gid]!.activity })).join(' ');
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const sim = similarity(track(groupIds[a]!), track(groupIds[b]!));
      assert.ok(
        sim < 0.7,
        `${when}: Grades ${groups[a]!.grade} and ${groups[b]!.grade} have near-identical activities (${sim.toFixed(2)})`
      );
    }
    for (const g of groups)
      assert.match(
        track(g.id),
        TOPIC,
        `${when}: Grade ${g.grade}'s activities are not about friction`
      );

    // Grounded objectives: each grade shows its stored DepEd competency text, exactly once, and no internal id.
    const objectives = byKey(sections, 'objectives');
    assert.equal(objectives.type, 'pergroup');
    const assessment = byKey(sections, 'assessment');
    assert.equal(assessment.type, 'pergroup');
    const materials = byKey(sections, 'materials');
    assert.equal(materials.type, 'pergroup');
    if (
      objectives.type !== 'pergroup' ||
      assessment.type !== 'pergroup' ||
      materials.type !== 'pergroup'
    )
      return;
    for (const g of groups) {
      const objectiveText = text({ type: 'text', blocks: objectives.groups[g.id] ?? [] });
      for (const stored of storedText(g.grade))
        assert.equal(
          count(normalise(objectiveText), normalise(stored)),
          1,
          `${when}: Grade ${g.grade}'s objectives must show the DepEd competency text exactly once`
        );
      // Assessment: present for each grade and tied to that grade's competency.
      const assessText = text({ type: 'text', blocks: assessment.groups[g.id] ?? [] });
      assert.ok(assessText.trim().length > 30, `${when}: Grade ${g.grade} has no assessment`);
      assert.ok(
        storedText(g.grade).some((stored) => normalise(assessText).includes(normalise(stored))),
        `${when}: Grade ${g.grade}'s assessment is not tied to its competency`
      );
      // Materials: non-trivial, only what the room has, nothing powered.
      const items = text({ type: 'text', blocks: materials.groups[g.id] ?? [] })
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      assert.ok(
        items.length >= 4,
        `${when}: Grade ${g.grade}'s materials list is trivial (${items.join(', ')})`
      );
      for (const item of items)
        assert.ok(MATERIALS.includes(item), `${when}: "${item}" is not in the room`);
      assert.ok(
        items.some((item) => !/^(notebook|pencil|chalkboard and chalk)$/.test(item)),
        `${when}: Grade ${g.grade} only has writing materials`
      );
    }
    const whole = sections.map((s) => text(s.content, groupIds)).join('\n');
    assert.ok(
      !POWERED.test(whole),
      `${when}: the plan uses powered equipment in a room without electricity`
    );
    for (const id of w.packIds)
      assert.ok(
        !whole.includes(id),
        `${when}: internal competency id ${id} is shown to the teacher`
      );
    for (const gid of groupIds)
      assert.ok(!whole.includes(gid), `${when}: internal group id is shown to the teacher`);
    for (const name of ALL_NAMES)
      assert.ok(!whole.includes(name), `${when}: learner name "${name}" appears in the plan`);

    // Language: activities are written in the language asked for. Competency text stays as DepEd wrote it.
    const activities = groupIds.map(track).join(' ');
    const filipinoWords = (activities.match(FILIPINO) ?? []).length;
    if (language === 'fil')
      assert.ok(
        filipinoWords >= 15,
        `${when}: a Filipino plan with only ${filipinoWords} Filipino function words`
      );
    else
      assert.ok(
        filipinoWords <= 2,
        `${when}: an English plan with ${filipinoWords} Filipino function words`
      );
  };

  await step(`${language}: the draft is a sound, grounded, three-track hour`, () => {
    assert.ok(job.result!.title.trim().length > 5);
    assertSound(generated, 'draft');
    // Only competencies that exist in the packs are attached to the plan: nothing invented.
    for (const id of Object.values(competencies).flat())
      assert.ok(w.packIds.has(id), `${id} is not a pack competency`);
  });

  await step(
    `${language}: the draft is written to the plan through sync and marked as an AI draft`,
    async () => {
      const current = (await phone.engine.get('plan', planId))!.data;
      const existing = (await phone.engine.list('plan_section'))
        .map((r) => r.data)
        .filter((s) => s.planId === planId);
      const applied = planHelpers.applyGeneratedSections({
        plan: current,
        sections: existing,
        generated,
        gen: generated[0]!.gen,
        newId: phone.newId,
      });
      await phone.engine.batch([
        ...applied.revisions.map((r) => ({
          op: 'put' as const,
          entity: 'section_revision' as const,
          data: r,
        })),
        ...applied.sections.map((s) => ({
          op: 'put' as const,
          entity: 'plan_section' as const,
          data: s,
        })),
        {
          op: 'put' as const,
          entity: 'plan' as const,
          data: { ...applied.plan, title: job.result!.title },
        },
      ]);
      await cleanSync(phone.engine);
      const stored = t.services.records.planSnapshot(teacher.id, planId)!;
      assert.equal(stored.plan.data.aiDraft, true);
      assert.equal(stored.plan.data.state, 'draft');
    }
  );

  const sectionsNow = async (): Promise<PlanSection[]> =>
    (await phone.engine.list('plan_section')).map((r) => r.data).filter((s) => s.planId === planId);
  const renderOptions = async () => ({
    plan: (await phone.engine.get('plan', planId))!.data,
    sections: await sectionsNow(),
    template: MG,
    class: w.klass,
    schoolYear: w.schoolYear,
    teacherName: 'Gng. Maria Santos',
    paper: 'a4' as const,
    lang: language,
    competencyLookup: (id: string) =>
      Object.values(chosen)
        .flat()
        .find((c) => c.id === id) ?? null,
  });
  save(`friction-${language}-1-generated.txt`, printHelpers.renderPlanText(await renderOptions()));

  /* ---------------- the teacher makes it hers: three small edits ---------------- */
  const RENAMED = language === 'fil' ? 'Baitang 3: Karera sa rampa' : 'Grade 3: Ramp race';
  const SWAPPED =
    language === 'fil'
      ? 'Mag-isa, hanapin sa silid ang tatlong bagay na madulas at tatlong magaspang ang ibabaw, at ilista ang mga ito sa kuwaderno.'
      : 'On your own, find three things in the room with a slippery surface and three with a rough surface, and list them in your notebook.';

  await step(
    `${language}: the teacher renames a segment, swaps one activity and shortens a segment by 5 minutes`,
    async () => {
      const sections = await sectionsNow();
      const flowSection = sections.find((s) => s.key === 'multigrade')!;
      assert.equal(flowSection.content.type, 'multigrade');
      if (flowSection.content.type !== 'multigrade') return;
      const blocks = structuredClone(flowSection.content.blocks);
      const g3 = groups[0]!.id;
      const g3Block = blocks.find((b) => b.teacherWith === g3)!;
      const g5Block = blocks.find((b) => b.teacherWith === groups[2]!.id)!;
      const closing = blocks.at(-1)!;

      // 1. Rename the segment where Grade 3 has the teacher.
      g3Block.label = RENAMED;
      // 2. Swap what Grade 3 does on its own while Grade 5 has the teacher.
      g5Block.groups[g3] = {
        mode: 'independent',
        activity: [{ t: 'p', spans: [{ text: SWAPPED }] }],
      };
      // 3. Shorten Grade 3's segment by five minutes…
      const before = g3Block.minutes;
      g3Block.minutes = before - 5;

      // …which leaves the hour five minutes short. The plan must say so, not silently accept it.
      const short = sections.map((s) =>
        s.key === 'multigrade'
          ? { key: s.key, content: { type: 'multigrade' as const, blocks } }
          : { key: s.key, content: s.content }
      );
      const problems = validateGeneratedSections(draftInput, short);
      assert.ok(
        problems.length > 0,
        'a 55-minute plan for a 60-minute period was accepted without comment'
      );
      assert.equal(
        blocks.reduce((n, b) => n + b.minutes, 0),
        MINUTES - 5
      );

      // She gives the five minutes to the closing discussion; now it is an hour again.
      closing.minutes += 5;
      const edited: PlanSection = {
        ...flowSection,
        content: { type: 'multigrade', blocks },
        editedByTeacher: true,
      };
      await phone.engine.batch([
        {
          op: 'put',
          entity: 'section_revision',
          data: planHelpers.sectionRevision(flowSection, {
            id: phone.newId(),
            savedAt: t.clock.now().toISOString(),
            reason: 'edit',
          }),
        },
        { op: 'put', entity: 'plan_section', data: edited },
        {
          op: 'put',
          entity: 'plan',
          data: { ...(await phone.engine.get('plan', planId))!.data, aiDraft: false },
        },
      ]);
      await cleanSync(phone.engine);

      // The server holds the teacher's version, the earlier text is kept as history, and the plan is still sound.
      const stored = t.services.records.planSnapshot(teacher.id, planId)!;
      const storedFlow = stored.sections.find((s) => s.data.key === 'multigrade')!.data;
      assert.equal(storedFlow.editedByTeacher, true);
      const flat = JSON.stringify(storedFlow.content);
      assert.ok(flat.includes(RENAMED), 'the renamed segment was not saved');
      assert.ok(flat.includes(SWAPPED), 'the swapped activity was not saved');
      assert.ok(
        t.services.records
          .list(teacher.id, 'section_revision')
          .some((r) => r.data.sectionId === flowSection.id && r.data.reason === 'edit'),
        'the text before the edit was not kept'
      );
      if (storedFlow.content.type === 'multigrade') {
        assert.equal(
          storedFlow.content.blocks.find((b) => b.label === RENAMED)!.minutes,
          before - 5
        );
        assert.equal(storedFlow.content.blocks.at(-1)!.minutes, closing.minutes);
      }
      assertSound(
        stored.sections.map((s) => ({ key: s.data.key, content: s.data.content })),
        'after the teacher’s edits'
      );
    }
  );

  await step(`${language}: the adjusted plan locks`, async () => {
    const locked: Plan = planHelpers.lockPlan({
      plan: (await phone.engine.get('plan', planId))!.data,
      sections: await sectionsNow(),
      template: MG,
      class: { curriculum: 'deped' },
      teacherName: 'Gng. Maria Santos',
      at: t.clock.now().toISOString(),
      revision: null,
    });
    await phone.engine.put('plan', locked);
    await cleanSync(phone.engine);
    const after = (await phone.engine.get('plan', planId))!.data;
    assert.equal(after.state, 'locked');
    assert.equal(after.aiDraft, false);
    assert.equal(typeof after.lock?.revision, 'number');
    assert.equal(after.lock?.lockedBy, 'Gng. Maria Santos');
  });

  await step(
    `${language}: the locked plan exports as a PDF and as printable pages that carry her edits`,
    async () => {
      const pdf = await t.call('print.planPdf', {
        token: teacher.token,
        params: { planId },
        query: { paper: 'a4' },
      });
      assert.equal(pdf.status, 200, pdf.error?.message);
      const bytes = Buffer.from(pdf.data as ArrayBuffer);
      assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
      assert.ok(bytes.length > 4000, 'the PDF is suspiciously small');

      const options = await renderOptions();
      const html = printHelpers.renderPlanHtml(options);
      const plain = printHelpers.renderPlanText(options);
      for (const [name, out] of [
        ['printable page', html],
        ['plain-text export', plain],
      ] as const) {
        assert.ok(out.includes(RENAMED), `${name}: the renamed segment is missing`);
        assert.ok(out.includes(SWAPPED), `${name}: the swapped activity is missing`);
        for (const c of Object.values(chosen).flat())
          assert.ok(out.includes(c.text), `${name}: competency text missing`);
        assert.ok(
          !/DRAFT/.test(out.replace(/<style[\s\S]*?<\/style>/g, '')),
          `${name}: a locked plan is still marked DRAFT`
        );
        for (const gid of groupIds)
          assert.ok(!out.includes(gid), `${name}: an internal group id is printed`);
        for (const name2 of ALL_NAMES)
          assert.ok(!out.includes(name2), `${name}: a learner name is printed`);
      }
      for (const g of groups)
        assert.match(
          plain,
          new RegExp(`(Grade|Baitang) ${g.grade}`),
          `plain-text export does not name Grade ${g.grade}`
        );

      save(`friction-${language}-2-adjusted-locked.txt`, plain);
      save(`friction-${language}-2-adjusted-locked.html`, html);
      save(`friction-${language}-2-adjusted-locked.pdf`, bytes);
      save(
        `friction-${language}-run.json`,
        JSON.stringify(
          {
            mode: LIVE ? 'live' : 'scripted',
            language,
            provider: job.result!.provider,
            model: job.result!.model,
            seconds,
            warnings: job.result!.warnings,
            title: job.result!.title,
          },
          null,
          2
        )
      );
    }
  );
}

test(
  `acceptance: multi-grade Friction lesson for Grades 3, 4 and 5 — generate, adjust, lock, PDF (${LIVE ? 'LIVE DeepSeek' : 'scripted model'})`,
  { timeout: LIVE ? 600_000 : 60_000 },
  async () => {
    const world = await buildWorld();
    try {
      // Science is taught in English; a teacher may still want the activities in Filipino. Both must work.
      await lessonLifecycle(world, 'en');
      await lessonLifecycle(world, 'fil');
      if (LIVE && OUT) {
        const usage = world.t.db
          .prepare(
            "SELECT provider, input_tokens, output_tokens, cost FROM llm_usage WHERE feature = 'lesson.generate'"
          )
          .all();
        mkdirSync(OUT, { recursive: true });
        writeFileSync(`${OUT}/friction-usage.json`, JSON.stringify(usage, null, 2));
      }
      assert.deepEqual(world.t.errors, [], 'the server reported unexpected errors');
    } finally {
      world.t.close();
    }
  }
);
