import test from 'node:test';
import assert from 'node:assert/strict';
import type { SectionContent } from '../contracts/content';
import {
  detectPersonalData,
  hasBlockingFinding,
  knownNameVariants,
  moderationText,
  textUnits,
} from './index';

const p = (...lines: string[]): SectionContent => ({
  type: 'text',
  blocks: lines.map((text) => ({ t: 'p' as const, spans: [{ text }] })),
});
const list = (...items: string[]): SectionContent => ({ type: 'list', items });
const ul = (...items: string[]): SectionContent => ({
  type: 'text',
  blocks: [{ t: 'ul', items: items.map((text) => [{ text }]) }],
});
const kinds = (sections: Array<{ key: string; content: SectionContent }>, opts = {}) =>
  detectPersonalData({ sections }, opts).map((f) => `${f.kind}:${f.confidence}:${f.sectionKey}`);

/* ---------- things a mediocre but ordinary lesson contains: never blocking ---------- */

test('an ordinary lesson with numbers, a materials list and a history topic has no blocking finding', () => {
  const sections = [
    {
      key: 'objectives',
      content: list('Identify the parts of a plant', 'Explain why plants need sunlight'),
    },
    {
      key: 'materials',
      content: list(
        'Manila Paper',
        'Masking Tape',
        'Pentel Pen',
        'Science Textbook Grade 4',
        'Colored Pencils'
      ),
    },
    {
      key: 'content',
      content: p(
        'Read 1,000,000 and 999,999,999,999 aloud. The year 1898. Page 45-47.',
        'Group work: 5 learners per group, 10 minutes.'
      ),
    },
    {
      key: 'procedure',
      content: {
        type: 'procedure',
        steps: [
          {
            id: 'step-0001',
            title: 'Motivation',
            minutes: 5,
            body: [
              {
                t: 'p',
                spans: [
                  { text: 'Ask learners about Jose Rizal, Andres Bonifacio and Emilio Aguinaldo.' },
                ],
              },
            ],
          },
        ],
      } as SectionContent,
    },
    {
      key: 'assessment',
      content: p(
        'Write the number 100000000000 in words.',
        'Our community is in Brgy. San Isidro.'
      ),
    },
  ];
  const f = detectPersonalData({ title: 'Parts of a Plant', sections });
  assert.equal(hasBlockingFinding(f), false, JSON.stringify(f));
  // Low hints are allowed (passed to the model), but nothing high.
  assert.ok(f.every((x) => x.confidence === 'low'));
});

test('a history lesson listing several heroes is a hint at most', () => {
  const sections = [
    {
      key: 'content',
      content: ul(
        'Jose Rizal',
        'Andres Bonifacio',
        'Emilio Aguinaldo',
        'Apolinario Mabini',
        'Gabriela Silang',
        'Melchora Aquino'
      ),
    },
  ];
  const f = detectPersonalData({ sections });
  assert.equal(hasBlockingFinding(f), false);
});

/* ---------- strict: student personal data ---------- */

test('a class list in Family, Given order is returned', () => {
  const sections = [
    {
      key: 'differentiation',
      content: ul(
        'Dela Cruz, Juan P.',
        'Santos, Maria L.',
        'Reyes, Ana',
        'Bautista, Mark Anthony',
        'Garcia, Kristine Joy',
        'Mendoza, Paolo'
      ),
    },
  ];
  assert.deepEqual(kinds(sections), ['name_list:high:differentiation']);
});

test('groupings of named learners are returned', () => {
  const sections = [
    {
      key: 'procedure',
      content: p(
        'Group 1: Juan Santos, Maria Reyes, Ana Cruz',
        'Group 2: Mark Garcia, Paolo Mendoza, Kristine Torres'
      ),
    },
  ];
  assert.deepEqual(kinds(sections), ['name_list:high:procedure']);
});

test('a long numbered list of names is returned even without a heading', () => {
  const names = [
    'Juan Santos',
    'Maria Reyes',
    'Ana Cruz',
    'Mark Garcia',
    'Paolo Mendoza',
    'Kristine Torres',
    'Angelo Ramos',
    'Nicole Flores',
    'Joshua Castro',
    'Camille Rivera',
    'Kevin Aquino',
    'Hannah Navarro',
    'Miguel Salazar',
    'Bea Mercado',
    'Carlo Lopez',
    'Jasmine Perez',
  ];
  const sections = [{ key: 'content', content: list(...names.map((n, i) => `${i + 1}. ${n}`)) }];
  assert.deepEqual(kinds(sections), ['name_list:high:content']);
});

test('names with M/F markers count as a roster signal', () => {
  const sections = [
    {
      key: 'content',
      content: p(
        'Juan Santos M',
        'Maria Reyes F',
        'Ana Cruz F',
        'Mark Garcia M',
        'Paolo Mendoza M'
      ),
    },
  ];
  assert.deepEqual(kinds(sections), ['name_list:high:content']);
});

test('LRNs: labelled is strict, one bare twelve-digit number is a hint, several are strict', () => {
  assert.deepEqual(kinds([{ key: 'content', content: p('LRN: 136512345678') }]), [
    'lrn:high:content',
  ]);
  assert.deepEqual(kinds([{ key: 'content', content: p('Write 136512345678 in words.') }]), [
    'lrn:low:content',
  ]);
  assert.deepEqual(
    kinds([
      { key: 'content', content: list('136512345678', '136512345679', '136512 345680') },
    ]).filter((k) => k.startsWith('lrn')),
    ['lrn:high:content', 'lrn:high:content', 'lrn:high:content']
  );
});

test('phone numbers, emails and home addresses are strict', () => {
  assert.deepEqual(kinds([{ key: 'assignment', content: p('Text me at 0917 123 4567.') }]), [
    'phone:high:assignment',
  ]);
  assert.deepEqual(kinds([{ key: 'assignment', content: p('Call +63 917-123-4567') }]), [
    'phone:high:assignment',
  ]);
  assert.deepEqual(kinds([{ key: 'assignment', content: p('Tel. no.: (02) 8123 4567') }]), [
    'phone:high:assignment',
  ]);
  assert.deepEqual(kinds([{ key: 'assignment', content: p('Send to juan.santos@gmail.com') }]), [
    'email:high:assignment',
  ]);
  assert.deepEqual(kinds([{ key: 'assignment', content: p('Example: juan@example.com') }]), [
    'email:low:assignment',
  ]);
  assert.deepEqual(
    kinds([{ key: 'content', content: p('Lives at 123 Rizal Street, Brgy. Poblacion') }]),
    ['address:high:content']
  );
  assert.deepEqual(kinds([{ key: 'content', content: p('Blk 4 Lot 12, Camella Homes') }]), [
    'address:high:content',
  ]);
  assert.deepEqual(
    kinds([{ key: 'content', content: p('Address: Purok 3, Sitio Malinao') }]).includes(
      'address:high:content'
    ),
    true
  );
  // A blank form line is not an address.
  assert.deepEqual(kinds([{ key: 'content', content: p('Address: ____________') }]), []);
});

test('names from the teacher roster match accent- and case-insensitively, in title and body', () => {
  const knownNames = [
    ...knownNameVariants({
      displayName: 'José Dela Cruz',
      givenName: 'José',
      familyName: 'Dela Cruz',
    }),
    'Joy',
  ];
  const f = detectPersonalData(
    {
      title: 'Lesson for jose dela cruz',
      sections: [
        { key: 'content', content: p('Bring joy to class.', 'Dela Cruz, José will lead.') },
      ],
    },
    { knownNames }
  );
  assert.deepEqual(f.map((x) => `${x.kind}:${x.sectionKey}`).sort(), [
    'roster_name:content',
    'roster_name:title',
  ]);
  // "Joy" alone (one word) is never matched.
  assert.ok(!f.some((x) => x.excerpt.includes('Bring joy')));
});

test('ids and generated numbers are not read as personal data', () => {
  const content: SectionContent = {
    type: 'multigrade',
    blocks: [
      {
        id: 'block-091712345678',
        label: 'Opening',
        minutes: 10,
        transitionMinutes: 0,
        teacherWith: 'all',
        pairedGroupIds: [],
        groups: {
          'grp-136512345678': {
            mode: 'shared',
            activity: [{ t: 'p', spans: [{ text: 'Sing a song.' }] }],
          },
        },
      },
    ],
  };
  assert.deepEqual(kinds([{ key: 'multigrade', content }]), []);
});

test('excerpts are short and point at the passage', () => {
  const long =
    'This is a long paragraph about plants and how they grow in the school garden every rainy season. '.repeat(
      3
    ) + 'Contact 09171234567 for details.';
  const [f] = detectPersonalData({ sections: [{ key: 'content', content: p(long) }] });
  assert.ok(f);
  assert.ok(f.excerpt.length <= 120);
  assert.match(f.excerpt, /09171234567/);
});

test('text helpers group lines by container and bound prompt text', () => {
  const units = textUnits({
    title: 'T',
    sections: [
      { key: 'a', content: p('x', 'y') },
      { key: 'b', content: list('z') },
    ],
  });
  assert.deepEqual(
    units.map((u) => [u.sectionKey, u.text, u.group]),
    [
      ['title', 'T', 1],
      ['a', 'x', 2],
      ['a', 'y', 2],
      ['b', 'z', 3],
    ]
  );
  const r = moderationText({ sections: [{ key: 'a', content: p('x'.repeat(50)) }] }, 20);
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, 20);
});
