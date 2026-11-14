/**
 * "What happens when the lesson plan is already locked?"
 *
 * Post-class sections (`outsideLock: true` in the plan's template: `results` and `reflection` in the built-in
 * templates) stay enterable on a locked plan. Everything else is frozen. These tests go through the real
 * kernel and `sync.push`, the way a device does.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_TEMPLATES, PlanRevisionMeta, parseRecordData } from '@hiraia/tala-core';
import type {
  EntityName,
  Mutation,
  MutationResult,
  Plan,
  PlanSection,
  RecordData,
} from '@hiraia/tala-core';
import { createTestServer } from '../../testing';
import type { TestServer, TestUser } from '../../testing';
import { frozenByLock, lockKeysOf, withoutPostClassRequirements } from './plan-rules';

let counter = 0;
const mid = () => `mutation-pc-${String(++counter).padStart(6, '0')}`;
const upsert = <E extends EntityName>(entity: E, data: RecordData<E>, baseRev = 0): Mutation => ({
  mutationId: mid(),
  entity,
  id: data.id,
  op: 'upsert',
  baseRev,
  data,
});
const del = (entity: EntityName, id: string, baseRev: number): Mutation => ({
  mutationId: mid(),
  entity,
  id,
  op: 'delete',
  baseRev,
});

async function push(t: TestServer, token: string, mutations: Mutation[], deviceId = 'device-0001') {
  const res = await t.ok('sync.push', { token, body: { deviceId, mutations } });
  return res.results as MutationResult[];
}
/** Push one mutation and return its result. */
const one = async (t: TestServer, token: string, mutation: Mutation) =>
  (await push(t, token, [mutation]))[0]!;

const DLP = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;
const LOCK = {
  lockedAt: '2026-11-16T00:00:00.000Z',
  lockedBy: 'Gng. Reyes',
  revisionCode: 'K7Q2M9A',
  revision: null,
};
const para = (value: string) => ({
  type: 'text' as const,
  blocks: value ? [{ t: 'p' as const, spans: [{ text: value }] }] : [],
});

function planData(extra: Record<string, unknown> = {}) {
  return parseRecordData('plan', {
    id: 'plan-0001',
    templateId: DLP.id,
    language: 'fil',
    grades: ['4'],
    durationMinutes: 50,
    title: 'Mga Halaman',
    ...extra,
  });
}
const text = (id: string, key: string, value: string, planId = 'plan-0001') =>
  parseRecordData('plan_section', { id, planId, key, content: para(value) });

/** The pre-class parts of a DLP, complete. No `results` record: this is a plan from before that part existed. */
function preClassSections(planId = 'plan-0001'): PlanSection[] {
  return [
    parseRecordData('plan_section', {
      id: `${planId}-objectives`,
      planId,
      key: 'objectives',
      content: { type: 'list', items: ['Natutukoy ang mga bahagi ng halaman'] },
    }),
    parseRecordData('plan_section', {
      id: `${planId}-materials`,
      planId,
      key: 'materials',
      content: { type: 'list', items: ['Tunay na halaman'] },
    }),
    parseRecordData('plan_section', {
      id: `${planId}-procedure`,
      planId,
      key: 'procedure',
      content: {
        type: 'procedure',
        steps: [
          {
            id: 'step-0001',
            title: 'Panimula',
            minutes: 10,
            body: para('Ipakita ang halaman.').blocks,
          },
        ],
      },
    }),
    text(`${planId}-assessment`, 'assessment', 'Iguhit ang halaman.', planId),
    text(`${planId}-reflection`, 'reflection', '', planId),
  ];
}

/** A locked DLP plan as an older app would have left it: pre-class parts and an empty reflection, no `results`. */
async function lockedPlan(t: TestServer, teacher: TestUser, extra: Record<string, unknown> = {}) {
  // Written as a draft first (revision 1), locked in a later sync (revision 2).
  const results = [
    ...(await push(t, teacher.token, [
      upsert('plan', planData({ aiDraft: true, aiAssisted: true, ...extra })),
      ...preClassSections().map((s) => upsert('plan_section', s)),
    ])),
    ...(await push(t, teacher.token, [
      upsert(
        'plan',
        planData({ aiDraft: true, aiAssisted: true, ...extra, state: 'locked', lock: LOCK }),
        1
      ),
    ])),
  ];
  assert.deepEqual(
    results.map((r) => r.status),
    Array(results.length).fill('applied'),
    JSON.stringify(results.filter((r) => r.status !== 'applied'))
  );
  return t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
}
/** What the server wrote down when the plan's current lock was taken. */
const lockKeys = (t: TestServer, planId = 'plan-0001') => {
  const row = t.db
    .prepare(
      "SELECT lock_keys FROM core_plan_revisions WHERE plan_id = ? AND reason = 'lock' ORDER BY revision DESC LIMIT 1"
    )
    .get(planId) as { lock_keys: string | null } | undefined;
  return row?.lock_keys
    ? (JSON.parse(row.lock_keys) as { outside: string[]; inside: string[] })
    : null;
};

const revisionsOf = async (t: TestServer, teacher: TestUser, planId = 'plan-0001') =>
  (await t.ok('plans.revisions', { token: teacher.token, params: { planId } })).revisions;
/** How the server itself labelled each revision, newest first. */
const storedReasons = (t: TestServer, planId = 'plan-0001') =>
  (
    t.db
      .prepare(
        'SELECT revision, reason, locked FROM core_plan_revisions WHERE plan_id = ? ORDER BY revision DESC'
      )
      .all(planId) as Array<{ revision: number; reason: string; locked: number }>
  ).map((r) => `${r.revision}:${r.reason}:${r.locked ? 'locked' : 'open'}`);
/** The reason a client sees for a post-class edit: its own value once the contract has one, `save` until then. */
const POST_CLASS_REASON = (PlanRevisionMeta.shape.reason.options as readonly string[]).includes(
  'post_class'
)
  ? 'post_class'
  : 'save';

test('the built-in templates: results and reflection are the post-class parts, and neither is required', () => {
  for (const template of BUILTIN_TEMPLATES) {
    const postClass = template.sections.filter((s) => s.outsideLock).map((s) => s.key);
    assert.deepEqual(postClass, ['results', 'reflection'], template.id);
    assert.ok(
      template.sections.filter((s) => s.outsideLock).every((s) => !s.required),
      template.id
    );
  }
});

test('(1)(2)(3) on a locked plan, post-class parts can be written and created; everything else is refused as locked', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  await lockedPlan(t, teacher);

  // (1) Editing a post-class part that already exists.
  const reflection = await one(
    t,
    teacher.token,
    upsert(
      'plan_section',
      text('plan-0001-reflection', 'reflection', 'Nahirapan ang ilan sa bahagi 2.'),
      1
    )
  );
  assert.equal(reflection.status, 'applied');
  assert.equal(reflection.record!.rev, 2);

  // (2) CREATING the record for a post-class part the plan never had (an older plan has no `results`).
  const created = await one(
    t,
    teacher.token,
    upsert(
      'plan_section',
      text('plan-0001-results', 'results', '24 sa 28 ang nakakuha ng 4 pataas.')
    )
  );
  assert.equal(created.status, 'applied');
  assert.equal(created.record!.rev, 1);
  // …and editing it again later.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert(
          'plan_section',
          text('plan-0001-results', 'results', '25 sa 28 matapos ang remedial.'),
          1
        )
      )
    ).status,
    'applied'
  );
  // A post-class part can also be cleared or removed.
  assert.equal(
    (await one(t, teacher.token, del('plan_section', 'plan-0001-reflection', 2))).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-reflection', 'reflection', 'Isinulat muli.'), 3)
      )
    ).status,
    'applied'
  );

  // (3) Every pre-class part: editing, creating and deleting are all refused, and the server copy comes back.
  for (const key of ['objectives', 'materials', 'procedure', 'assessment']) {
    const stored = t.services.records.get(teacher.id, 'plan_section', `plan-0001-${key}`)!;
    const edit = await one(
      t,
      teacher.token,
      upsert('plan_section', { ...stored.data, content: para('Binago matapos i-lock') }, stored.rev)
    );
    assert.equal(edit.status, 'locked', `editing ${key}`);
    assert.deepEqual(edit.record!.data, stored.data, `${key} is unchanged`);
    assert.equal(
      (await one(t, teacher.token, del('plan_section', stored.id, stored.rev))).status,
      'locked',
      `deleting ${key}`
    );
  }
  for (const key of ['content', 'differentiation', 'assignment']) {
    // Optional pre-class parts the plan has no record for: they cannot be added now either.
    const res = await one(
      t,
      teacher.token,
      upsert('plan_section', text(`plan-0001-${key}`, key, 'Idinagdag matapos i-lock'))
    );
    assert.equal(res.status, 'locked', `creating ${key}`);
    assert.equal(res.record, null);
  }
  const stored = t.services.records.planSnapshot(teacher.id, 'plan-0001')!;
  assert.deepEqual(stored.sections.map((s) => s.data.key).sort(), [
    'assessment',
    'materials',
    'objectives',
    'procedure',
    'reflection',
    'results',
  ]);
  assert.ok(!JSON.stringify(stored.sections).includes('matapos i-lock'));
  t.close();
});

test('(4) a key cannot be smuggled past the lock: only the template decides what is post-class', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  const plan = await lockedPlan(t, teacher);
  const assessment = t.services.records.get(teacher.id, 'plan_section', 'plan-0001-assessment')!;

  // A flag sent by the client means nothing: the section schema has no such field and the server does not read one.
  const flagged = await one(t, teacher.token, {
    mutationId: mid(),
    entity: 'plan_section',
    id: assessment.id,
    op: 'upsert',
    baseRev: assessment.rev,
    data: {
      ...assessment.data,
      content: para('pinalitan'),
      outsideLock: true,
      postClass: true,
      locked: false,
    },
  });
  assert.equal(flagged.status, 'locked');

  // Relabelling a pre-class part as a post-class one (same record, new key) does not unlock it…
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert(
          'plan_section',
          { ...assessment.data, key: 'results', content: para('pinalitan') },
          assessment.rev
        )
      )
    ).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, key: 'reflection' }, assessment.rev)
      )
    ).status,
    'locked'
  );
  // …and a post-class part cannot be turned into a pre-class one, or moved in from another plan.
  await one(
    t,
    teacher.token,
    upsert('plan_section', text('plan-0001-results', 'results', 'Resulta'))
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-results', 'assessment', 'Resulta'), 1)
      )
    ).status,
    'locked'
  );
  await push(t, teacher.token, [
    upsert('plan', planData({ id: 'plan-0002' })),
    upsert('plan_section', text('other-0001', 'content', 'mula sa ibang plano', 'plan-0002')),
  ]);
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('other-0001', 'content', 'mula sa ibang plano'), 1)
      )
    ).status,
    'locked'
  );

  // A key the template does not define is not post-class, whatever it is called.
  for (const key of ['custom.results', 'custom.reflection', 'custom.postclass', 'resultsx']) {
    assert.equal(
      (
        await one(
          t,
          teacher.token,
          upsert('plan_section', text(`sneaky-${key.replace(/\W/g, '-')}`, key, 'x'))
        )
      ).status,
      'locked',
      key
    );
  }

  // Pointing the locked plan at another template (one where everything is post-class) is itself refused.
  const loose = parseRecordData('template', {
    id: 'tpl-custom-loose',
    kind: 'custom',
    name: { fil: 'Maluwag', en: 'Loose' },
    builtIn: false,
    span: 'session',
    orientation: 'portrait',
    sections: DLP.sections.map((s) => ({ ...s, required: false, outsideLock: true })),
  });
  assert.equal((await one(t, teacher.token, upsert('template', loose))).status, 'applied');
  const retarget = await one(
    t,
    teacher.token,
    upsert(
      'plan',
      { ...plan.data, templateId: loose.id, lock: { ...plan.data.lock!, revision: null } },
      plan.rev
    )
  );
  assert.equal(retarget.status, 'locked');
  // A custom template cannot stand in for a built-in one by taking its id.
  assert.equal(
    (await one(t, teacher.token, upsert('template', { ...loose, id: DLP.id }))).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, content: para('pinalitan') }, assessment.rev)
      )
    ).status,
    'locked'
  );

  assert.deepEqual(
    t.services.records.get(teacher.id, 'plan_section', assessment.id)!.data,
    assessment.data
  );
  t.close();
});

/** A teacher's own template: two pre-class parts and one post-class part. */
function customTemplate(extra: Record<string, unknown> = {}) {
  return parseRecordData('template', {
    id: 'tpl-custom-0001',
    kind: 'custom',
    name: { fil: 'Sariling Banghay', en: 'My Template' },
    builtIn: false,
    span: 'session',
    orientation: 'portrait',
    sections: [
      {
        key: 'objectives',
        label: { fil: 'Layunin', en: 'Objectives' },
        contentType: 'text',
        required: true,
        outsideLock: false,
      },
      {
        key: 'custom.gawain',
        label: { fil: 'Gawain', en: 'Activity' },
        contentType: 'text',
        required: true,
        outsideLock: false,
      },
      {
        key: 'custom.tala',
        label: { fil: 'Tala pagkatapos', en: 'Notes after class' },
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
    ],
    ...extra,
  });
}

async function lockedCustomPlan(t: TestServer, teacher: TestUser, template = customTemplate()) {
  const plan = planData({ templateId: template.id });
  const results = await push(t, teacher.token, [
    upsert('template', template),
    upsert('plan', plan),
    upsert('plan_section', text('c-objectives', 'objectives', 'Layunin')),
    upsert('plan_section', text('c-gawain', 'custom.gawain', 'Gawain')),
    upsert('plan', { ...plan, state: 'locked', lock: LOCK }, 1),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    Array(5).fill('applied'),
    JSON.stringify(results)
  );
}

test('(4) a teacher’s own template: its post-class parts work, and changing the template afterwards unlocks nothing', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  await lockedCustomPlan(t, teacher);
  assert.deepEqual(lockKeys(t), {
    outside: ['custom.tala'],
    inside: ['objectives', 'custom.gawain'],
  });

  // What the template called post-class when the plan was locked can be created and edited.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-tala', 'custom.tala', 'Maayos ang klase.'))
      )
    ).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );

  // The teacher (or a script with their session) now edits the template so the pre-class parts read as post-class.
  const loosened = customTemplate({
    sections: customTemplate().sections.map((s) => ({ ...s, required: false, outsideLock: true })),
  });
  assert.equal(
    (await one(t, teacher.token, upsert('template', loosened, 1))).status,
    'applied',
    'the template itself is theirs to edit'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked',
    'the locked plan goes by what the template said when it was locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-objectives', 'objectives', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );

  // Deleting the template and making it again with other flags does not help either.
  assert.equal(
    (await one(t, teacher.token, del('template', 'tpl-custom-0001', 2))).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );
  assert.equal((await one(t, teacher.token, upsert('template', loosened, 3))).status, 'applied');
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );
  // The part that was post-class at lock time stays enterable through all of that.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-tala', 'custom.tala', 'Dagdag na tala.'), 1)
      )
    ).status,
    'applied'
  );
  assert.equal(
    t.services.records.get(teacher.id, 'plan_section', 'c-gawain')!.data.content.type,
    'text'
  );
  assert.ok(
    JSON.stringify(t.services.records.get(teacher.id, 'plan_section', 'c-gawain')!.data).includes(
      'Gawain'
    )
  );
  // A part this plan never had, which the template did not define when it was locked, cannot be slipped in
  // under a pre-class key…
  const grown = customTemplate({
    sections: [
      ...customTemplate().sections,
      {
        key: 'custom.dagdag',
        label: { fil: 'Dagdag', en: 'Extra' },
        contentType: 'text',
        required: false,
        outsideLock: false,
      },
      {
        key: 'custom.puna',
        label: { fil: 'Puna', en: 'Remarks' },
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
    ],
  });
  assert.equal((await one(t, teacher.token, upsert('template', grown, 4))).status, 'applied');
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-dagdag', 'custom.dagdag', 'bagong bahagi'))
      )
    ).status,
    'locked'
  );
  // …but a NEW post-class part the template gains later is enterable, the way `results` is on older plans.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-puna', 'custom.puna', 'Puna pagkatapos ng klase.'))
      )
    ).status,
    'applied'
  );
  // The template is back to its first shape here except for the two new parts: what was locked is still locked.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );
  // And a part that was post-class at lock time stays so even if the template now says otherwise.
  const tightened = customTemplate({
    sections: customTemplate().sections.map((s) => ({ ...s, outsideLock: false })),
  });
  assert.equal((await one(t, teacher.token, upsert('template', tightened, 5))).status, 'applied');
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-tala', 'custom.tala', 'Huling tala.'), 2)
      )
    ).status,
    'applied'
  );
  assert.equal((await one(t, teacher.token, upsert('template', loosened, 6))).status, 'applied');

  // Unlocking and locking again takes the template as it is then.
  const stored = t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
  const [unlocked] = await push(t, teacher.token, [
    upsert('plan', { ...stored.data, state: 'draft', lock: null }, stored.rev),
  ]);
  assert.equal(unlocked!.status, 'applied');
  const [relocked] = await push(t, teacher.token, [
    upsert(
      'plan',
      {
        ...(unlocked!.record!.data as Plan),
        state: 'locked',
        lock: { ...LOCK, revisionCode: 'SECOND1' },
      },
      unlocked!.record!.rev
    ),
  ]);
  assert.equal(relocked!.status, 'applied');
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('c-gawain', 'custom.gawain', 'ngayon ay post-class na'), 1)
      )
    ).status,
    'applied',
    'by the template’s definition at the new lock'
  );
  t.close();
});

test('(4) a plan locked before its template reached the server: every part it had is frozen, whatever a template that turns up later says', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  const plan = planData({ templateId: 'tpl-custom-late' });
  const results = await push(t, teacher.token, [
    upsert('plan', plan),
    upsert('plan_section', text('late-objectives', 'objectives', 'Layunin')),
    upsert('plan_section', text('late-gawain', 'custom.gawain', 'Gawain')),
    upsert('plan', { ...plan, state: 'locked', lock: LOCK }, 1),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['applied', 'applied', 'applied', 'applied']
  );
  assert.deepEqual(lockKeys(t), { outside: [], inside: ['objectives', 'custom.gawain'] });
  // With no template at all, nothing is post-class.
  assert.equal(
    (await one(t, teacher.token, upsert('plan_section', text('late-tala', 'custom.tala', 'Tala'))))
      .status,
    'locked'
  );

  const everythingPostClass = customTemplate({
    id: 'tpl-custom-late',
    sections: customTemplate().sections.map((s) => ({ ...s, required: false, outsideLock: true })),
  });
  assert.equal(
    (await one(t, teacher.token, upsert('template', everythingPostClass))).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('late-objectives', 'objectives', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('late-gawain', 'custom.gawain', 'pinalitan'), 1)
      )
    ).status,
    'locked'
  );
  assert.equal(
    (await one(t, teacher.token, del('plan_section', 'late-gawain', 1))).status,
    'locked'
  );
  // A post-class part the plan did not have yet is enterable once the template that defines it is there.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('late-tala', 'custom.tala', 'Tala pagkatapos ng klase.'))
      )
    ).status,
    'applied'
  );
  t.close();
});

test('(2) a plan locked by an earlier release (no record of what its lock froze) goes by its template as it is now', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  await lockedPlan(t, teacher);
  assert.deepEqual(lockKeys(t), {
    outside: ['results', 'reflection'],
    inside: [
      'objectives',
      'content',
      'materials',
      'procedure',
      'assessment',
      'differentiation',
      'assignment',
    ],
  });
  // As the live database has it for every plan locked before this column existed.
  t.db.prepare('UPDATE core_plan_revisions SET lock_keys = NULL').run();

  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-results', 'results', 'Resulta ng lumang plano.'))
      )
    ).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert(
          'plan_section',
          text('plan-0001-reflection', 'reflection', 'Pagninilay sa lumang plano.'),
          1
        )
      )
    ).status,
    'applied'
  );
  const assessment = t.services.records.get(teacher.id, 'plan_section', 'plan-0001-assessment')!;
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, content: para('pinalitan') }, assessment.rev)
      )
    ).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, key: 'results' }, assessment.rev)
      )
    ).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-content', 'content', 'bago'))
      )
    ).status,
    'locked'
  );
  assert.equal(
    (await one(t, teacher.token, del('plan_section', assessment.id, assessment.rev))).status,
    'locked'
  );
  assert.equal(storedReasons(t)[0], '3:post_class:locked');
  t.close();
});

test('(5) post-class edits leave the plan, its lock, its revision and aiDraft alone, and get their own entry in the history', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  const before = await lockedPlan(t, teacher);
  assert.deepEqual(
    [before.data.state, before.data.aiDraft, before.data.aiAssisted, before.data.lock!.revision],
    ['locked', false, true, 2]
  );
  assert.deepEqual(storedReasons(t), ['2:lock:locked', '1:save:open']);

  t.clock.advance({ days: 1 });
  await push(t, teacher.token, [
    upsert(
      'plan_section',
      text('plan-0001-results', 'results', '24 sa 28 ang nakakuha ng 4 pataas.')
    ),
    upsert(
      'plan_section',
      text('plan-0001-reflection', 'reflection', 'Nahirapan ang ilan sa bahagi 2.'),
      1
    ),
  ]);

  // The plan record is untouched: same rev, same lock, same revision, still not an "AI draft".
  const after = t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
  assert.deepEqual(after, before);

  // History: a new entry, labelled as a post-class edit on a locked plan; the lock revision is as it was.
  assert.deepEqual(storedReasons(t), ['3:post_class:locked', '2:lock:locked', '1:save:open']);
  const listed = await revisionsOf(t, teacher);
  assert.deepEqual(
    listed.map((r) => [r.revision, r.reason, r.locked]),
    [
      [3, POST_CLASS_REASON, true],
      [2, 'lock', true],
      [1, 'save', false],
    ]
  );
  const lockRevision = await t.ok('plans.revision', {
    token: teacher.token,
    params: { planId: 'plan-0001', revision: '2' },
  });
  assert.ok(
    !JSON.stringify(lockRevision).includes('24 sa 28'),
    'the locked revision does not gain post-class text'
  );
  assert.equal(lockRevision.sections.length, 5);
  const postClass = await t.ok('plans.revision', {
    token: teacher.token,
    params: { planId: 'plan-0001', revision: '3' },
  });
  assert.ok(JSON.stringify(postClass.sections).includes('24 sa 28'));
  assert.equal((postClass.plan.data as Plan).lock!.revision, 2);

  // More post-class writing soon after folds into the same entry; it never folds into the lock revision.
  t.clock.advance({ minutes: 3 });
  await push(t, teacher.token, [
    upsert(
      'plan_section',
      text('plan-0001-results', 'results', '25 sa 28 matapos ang remedial.'),
      1
    ),
  ]);
  assert.deepEqual(storedReasons(t), ['3:post_class:locked', '2:lock:locked', '1:save:open']);
  // A day later it is a new entry.
  t.clock.advance({ days: 1 });
  await push(t, teacher.token, [
    upsert(
      'plan_section',
      text('plan-0001-reflection', 'reflection', 'Uulitin ang bahagi 2 bukas.'),
      2
    ),
  ]);
  assert.deepEqual(storedReasons(t), [
    '4:post_class:locked',
    '3:post_class:locked',
    '2:lock:locked',
    '1:save:open',
  ]);

  // Other things that may change on a locked plan (its dates, the "submitted" note) are ordinary saves, told apart.
  t.clock.advance({ days: 1 });
  const moved = await one(
    t,
    teacher.token,
    upsert(
      'plan',
      { ...after.data, submitted: { date: '2026-11-19', note: 'Kay Gng. Cruz' } },
      after.rev
    )
  );
  assert.equal(moved.status, 'applied');
  assert.equal(storedReasons(t)[0], '5:save:locked');
  assert.deepEqual((moved.record!.data as Plan).lock, before.data.lock);
  assert.equal((moved.record!.data as Plan).aiDraft, false);
  t.close();
});

test('(5) one sync with several kinds of change: the history label is the most telling one, and the plan stays as locked', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  const before = await lockedPlan(t, teacher);

  // The "submitted" note and a post-class part in the same sync: one entry, labelled post-class.
  t.clock.advance({ days: 1 });
  const both = await push(t, teacher.token, [
    upsert(
      'plan',
      { ...before.data, submitted: { date: '2026-11-17', note: 'Kay Gng. Cruz' } },
      before.rev
    ),
    upsert(
      'plan_section',
      text('plan-0001-results', 'results', '24 sa 28 ang nakakuha ng 4 pataas.')
    ),
  ]);
  assert.deepEqual(
    both.map((r) => r.status),
    ['applied', 'applied']
  );
  assert.equal(storedReasons(t)[0], '3:post_class:locked');
  const noted = t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
  assert.deepEqual(noted.data.lock, before.data.lock);

  // Removing a post-class part is post-class writing too.
  t.clock.advance({ days: 1 });
  assert.equal(
    (await one(t, teacher.token, del('plan_section', 'plan-0001-reflection', 1))).status,
    'applied'
  );
  assert.equal(storedReasons(t)[0], '4:post_class:locked');

  // A post-class part that arrives marked as written by AI (Tala's own drafting never writes one) is
  // labelled as an AI rewrite and never folded into the entry before it. The plan is still not an "AI draft".
  t.clock.advance({ minutes: 1 });
  const byAi = parseRecordData('plan_section', {
    id: 'plan-0001-results',
    planId: 'plan-0001',
    key: 'results',
    content: para('Karamihan ay nakapasa.'),
    origin: 'ai',
    gen: {
      provider: 'test',
      model: 'test-model',
      promptId: 'results',
      promptVersion: 1,
      curriculumVersion: null,
      at: '2026-11-18T00:01:00.000Z',
    },
  });
  assert.equal((await one(t, teacher.token, upsert('plan_section', byAi, 1))).status, 'applied');
  assert.equal(storedReasons(t)[0], '5:regenerate:locked');
  const after = t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
  assert.deepEqual(after, noted, 'post-class writing never touches the plan record');
  assert.deepEqual(
    [after.data.aiDraft, after.data.lock!.revision, after.data.lock!.revisionCode],
    [false, 2, 'K7Q2M9A']
  );
  t.close();

  // Locking and post-class writing in the same sync: the lock revision holds the plan as it was locked,
  // the writing gets the entry after it.
  const t2 = createTestServer();
  const other = await t2.registerUser();
  await push(t2, other.token, [
    upsert('plan', planData()),
    ...preClassSections().map((s) => upsert('plan_section', s)),
  ]);
  const together = await push(t2, other.token, [
    upsert('plan', planData({ state: 'locked', lock: LOCK }), 1),
    upsert('plan_section', text('plan-0001-results', 'results', 'Isinulat kasabay ng pag-lock.')),
    upsert('plan_section', text('plan-0001-assessment', 'assessment', 'Huli na ito.'), 1),
  ]);
  assert.deepEqual(
    together.map((r) => r.status),
    ['applied', 'applied', 'locked']
  );
  assert.deepEqual(storedReasons(t2), ['3:post_class:locked', '2:lock:locked', '1:save:open']);
  const lockRevision = await t2.ok('plans.revision', {
    token: other.token,
    params: { planId: 'plan-0001', revision: '2' },
  });
  assert.ok(!JSON.stringify(lockRevision.sections).includes('kasabay ng pag-lock'));
  t2.close();
});

test('the rule itself: what a lock froze is written down once, and decides before the template does', () => {
  const template = customTemplate();
  // Keys in template order; a part the template does not know is inside the lock; a repeated key counts once.
  assert.deepEqual(
    lockKeysOf(template, ['objectives', 'custom.tala', 'custom.ligaw', 'custom.ligaw']),
    {
      outside: ['custom.tala'],
      inside: ['objectives', 'custom.gawain', 'custom.ligaw'],
    }
  );
  assert.deepEqual(lockKeysOf(null, ['objectives']), { outside: [], inside: ['objectives'] });
  // When a template defines a key twice, the first definition decides (as in the shared lockPlan).
  const twice = customTemplate({
    sections: [
      {
        key: 'custom.tala',
        label: { fil: 'Tala', en: 'Notes' },
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
      {
        key: 'custom.tala',
        label: { fil: 'Tala', en: 'Notes' },
        contentType: 'text',
        required: true,
        outsideLock: false,
      },
    ],
  });
  assert.deepEqual(lockKeysOf(twice, []), { outside: ['custom.tala'], inside: [] });
  assert.ok(withoutPostClassRequirements(twice).sections.every((s) => !s.required));
  assert.deepEqual(
    withoutPostClassRequirements(template),
    template,
    'pre-class requirements are untouched'
  );

  const everythingOpen = customTemplate({
    sections: customTemplate().sections.map((s) => ({ ...s, outsideLock: true })),
  });
  const atLock = lockKeysOf(template, []);
  assert.equal(
    frozenByLock(atLock, everythingOpen, 'custom.gawain'),
    true,
    'inside at lock time: frozen whatever the template says now'
  );
  assert.equal(
    frozenByLock(atLock, null, 'custom.tala'),
    false,
    'post-class at lock time: enterable even with the template gone'
  );
  assert.equal(
    frozenByLock(atLock, everythingOpen, 'custom.bago'),
    true,
    'unknown to both: frozen'
  );
  assert.equal(
    frozenByLock(null, everythingOpen, 'custom.gawain'),
    false,
    'no record (an older lock): the template as it is now'
  );
  assert.equal(frozenByLock(null, null, 'reflection'), true, 'no record and no template: frozen');
  // A record that names a key on both sides (it never should) is read as frozen.
  assert.equal(
    frozenByLock({ outside: ['objectives'], inside: ['objectives'] }, everythingOpen, 'objectives'),
    true
  );
});

test('(6) locking never requires a post-class part, even when a template marks one as required', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();

  // Built-in template: no `results` and no `reflection` record at all.
  const plan = planData();
  const builtIn = await push(t, teacher.token, [
    upsert('plan', plan),
    ...preClassSections()
      .filter((s) => s.key !== 'reflection')
      .map((s) => upsert('plan_section', s)),
    upsert('plan', { ...plan, state: 'locked', lock: LOCK }, 1),
  ]);
  assert.equal(builtIn.at(-1)!.status, 'applied', builtIn.at(-1)!.message);

  // A teacher's template that (oddly) marks its post-class part as required: still not needed to lock.
  const template = customTemplate({
    sections: customTemplate().sections.map((s) => (s.outsideLock ? { ...s, required: true } : s)),
  });
  const custom = planData({ id: 'plan-0002', templateId: template.id });
  const results = await push(t, teacher.token, [
    upsert('template', template),
    upsert('plan', custom),
    upsert('plan_section', text('c2-objectives', 'objectives', 'Layunin', 'plan-0002')),
    upsert('plan_section', text('c2-gawain', 'custom.gawain', 'Gawain', 'plan-0002')),
    upsert('plan', { ...custom, state: 'locked', lock: LOCK }, 1),
  ]);
  assert.equal(results.at(-1)!.status, 'applied', results.at(-1)!.message);

  // A required PRE-class part is still required.
  const incomplete = planData({ id: 'plan-0003', templateId: template.id });
  const refused = await push(t, teacher.token, [
    upsert('plan', incomplete),
    upsert('plan_section', text('c3-objectives', 'objectives', 'Layunin', 'plan-0003')),
    upsert('plan', { ...incomplete, state: 'locked', lock: LOCK }, 1),
  ]);
  assert.equal(refused.at(-1)!.status, 'invalid');
  assert.match(refused.at(-1)!.message!, /Activity/);
  t.close();
});

test('(7) an archived plan that keeps its lock behaves exactly the same', async () => {
  const t = createTestServer();
  const teacher = await t.registerUser();
  const locked = await lockedPlan(t, teacher);
  const [archived] = await push(t, teacher.token, [
    upsert('plan', { ...locked.data, state: 'archived' }, locked.rev),
  ]);
  assert.equal(archived!.status, 'applied');
  const plan = archived!.record!.data as Plan;
  assert.deepEqual(
    [plan.state, plan.lock!.revision, plan.lock!.revisionCode, plan.aiDraft],
    ['archived', 2, 'K7Q2M9A', false]
  );

  // Post-class: edit an existing part, create a missing one.
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert(
          'plan_section',
          text('plan-0001-reflection', 'reflection', 'Isinulat habang naka-archive.'),
          1
        )
      )
    ).status,
    'applied'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-results', 'results', 'Resulta habang naka-archive.'))
      )
    ).status,
    'applied'
  );
  // Pre-class: frozen, for edits, new parts, deletions and relabelling alike.
  const assessment = t.services.records.get(teacher.id, 'plan_section', 'plan-0001-assessment')!;
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, content: para('pinalitan') }, assessment.rev)
      )
    ).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', text('plan-0001-content', 'content', 'bago'))
      )
    ).status,
    'locked'
  );
  assert.equal(
    (await one(t, teacher.token, del('plan_section', assessment.id, assessment.rev))).status,
    'locked'
  );
  assert.equal(
    (
      await one(
        t,
        teacher.token,
        upsert('plan_section', { ...assessment.data, key: 'results' }, assessment.rev)
      )
    ).status,
    'locked'
  );
  // The plan record itself stays frozen and cannot be deleted; the lock is the same lock.
  const stored = t.services.records.get(teacher.id, 'plan', 'plan-0001')!;
  assert.deepEqual(stored.data, plan);
  assert.equal(
    (await one(t, teacher.token, upsert('plan', { ...plan, title: 'Bagong pamagat' }, stored.rev)))
      .status,
    'locked'
  );
  assert.equal(
    (await one(t, teacher.token, del('plan', 'plan-0001', stored.rev))).status,
    'locked'
  );
  // History labels the post-class writing the same way as on a locked plan.
  assert.equal(storedReasons(t)[0], '4:post_class:locked');
  assert.equal((await revisionsOf(t, teacher))[0]!.reason, POST_CLASS_REASON);

  // Back from the archive it is still the same locked plan.
  const [restored] = await push(t, teacher.token, [
    upsert('plan', { ...plan, state: 'locked' }, stored.rev),
  ]);
  assert.equal(restored!.status, 'applied');
  assert.deepEqual((restored!.record!.data as Plan).lock, plan.lock);
  t.close();
});
