import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeText,
  displayCase,
  emptyName,
  extractText,
  fieldForHeader,
  normalizeName,
  structureRows,
  traceable,
} from './index';

test('UTF-8, UTF-16 and legacy Latin accents are never replaced', () => {
  const value = 'Peña, Zoë Élodie';
  assert.equal(decodeText(new TextEncoder().encode(value)).text, value);
  const bytes = [
    255,
    254,
    ...Array.from(value).flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]),
  ];
  assert.equal(decodeText(Uint8Array.from(bytes)).text, value);
  const legacy = decodeText(Uint8Array.from([80, 101, 241, 97]));
  assert.equal(legacy.text, 'Peña');
  assert.equal(legacy.needsReview, true);
  assert.throws(() => decodeText(Uint8Array.from([255, 254, 65])));
});
test('delimiters, quotes, surname commas, and multiline cells', () => {
  assert.deepEqual(extractText('Peña, Jona\nDela Cruz, Miro'), [
    ['Peña, Jona'],
    ['Dela Cruz, Miro'],
  ]);
  for (const sep of [',', ';', '|', '\t'])
    assert.deepEqual(extractText(`Name${sep}Grade\n"Peña, Jona"${sep}3`, 'csv'), [
      ['Name', 'Grade'],
      ['Peña, Jona', '3'],
    ]);
  assert.deepEqual(extractText('Name,Grade\n"Peña,\nJona",3', 'csv')[1], ['Peña,\nJona', '3']);
});
const names = [
  'DELA CRUZ, JONA MIGUEL S.',
  'DE LOS SANTOS, MIRA A.',
  'DELOS REYES, NILO B.',
  'STA. MARIA, MA. CLARA R.',
  'SAN JOSE, LIRA C.',
  'MACAPAGAL-ARROYO, NERI P.',
  'Peña, Zoë D.',
  'O’Malley, Teri A.',
  'Dela Cruz, Miro Jr.',
  'Reyes, Ivo III',
  'Ma. Lira S. Dela Cruz',
  'Jona Miguel P. De los Santos',
  'Mira Clara D. Sta. Maria',
  'Chen Wei',
  'Ng Mei Lin',
  'Ayu',
  'Nur Aisyah binti Rahim',
  'Kim Min Seo',
  '山田 花子',
  'Mr. Dela Cruz, Jona (transferee)',
  '12. Ms. Peña, Miro - moved',
  '✓ Reyes, Neri',
  'Mira & Jona',
  'Mira and Jona',
  'Total: 32',
  'PeÃ±a, Neri',
  'Pe\uFFFDa, Neri',
  '  DELA   CRUZ, JONA A.  ',
  'de la Peña, Ma. Lira J.',
  'Dela Cruz, J.',
  'Santos, Miro Jose',
  'Santos, Miro J.',
  'López, Éna Q.',
  'Abad, Lira IV',
];
for (const [i, name] of names.entries())
  test(`invented name fixture ${i + 1} remains traceable`, () => {
    const result = normalizeName(name, i);
    assert.equal(result.original, name);
    assert.equal(traceable(name, result.proposed), true);
    assert.ok(result.status !== 'not_student');
  });
test('initial expansion and invented family names are refused', () => {
  assert.equal(traceable('J. Peña', emptyName('Juan Peña')), false);
  assert.equal(traceable('Mira Peña', emptyName('Mira Santos')), false);
  assert.equal(traceable('Mira Peña', emptyName('Mira Mira Peña')), false);
  assert.equal(displayCase('PEÑA'), 'Peña');
  assert.equal(normalizeName('Ma. Mira S. Dela Cruz', 0).proposed.givenName, 'Ma. Mira');
});
test('recognizes and drops every sensitive column before retention', () => {
  for (const header of [
    'LRN',
    'Birthdate',
    'Address',
    'Guardian',
    'Contact',
    'Religion',
    'Ethnicity',
    'Health',
    '4Ps',
    'Attendance',
    'Grades',
    'Photo',
  ]) {
    assert.ok(['drop', 'ignore'].includes(fieldForHeader(header)));
    const result = structureRows([
      ['Name', header, 'Grade'],
      ['Peña, Miro A.', 'SECRET_PRIVATE', '3'],
    ]);
    assert.ok(!JSON.stringify(result).includes('SECRET_PRIVATE'));
  }
});
test('letterhead, numbering, groups, totals and signatures conserve rows', () => {
  const input = [
    ['Invented School'],
    [],
    ['No.', 'Pangalan', 'LRN', 'Baitang'],
    ['Boys'],
    ['1', 'Peña, Miro A.', '123456789012', '3'],
    ['Girls'],
    ['2', 'Reyes, Neri A.', '123456789013', '4'],
    ['Total: 2'],
    ['Prepared by: Invented Teacher'],
  ];
  const result = structureRows(input);
  assert.equal(result.rows.length, 8);
  assert.equal(
    result.counts.linesRead,
    result.counts.students + result.counts.needsReview + result.counts.notStudents
  );
  assert.equal(result.rows[3]!.proposed.sex, 'M');
  assert.equal(result.rows[5]!.proposed.sex, 'F');
  assert.ok(!JSON.stringify(result).includes('123456789012'));
  assert.ok(!JSON.stringify(result).includes('Invented Teacher'));
});
test('near duplicates are flagged and never merged', () => {
  const result = structureRows([
    ['Name', 'Grade'],
    ['Peña, Miro A.', '3'],
    ['PEÑA, MIRO A.', '3'],
    ['Peña, Miro Alfonso', '3'],
  ]);
  assert.equal(result.rows.length, 4);
  for (const r of result.rows.slice(1)) assert.ok(r.flags.includes('possible_duplicate'));
});
test('separate fields and grade subheadings', () => {
  const result = structureRows([
    ['Given Name', 'Middle Name', 'Apelyido'],
    ['Grade 4'],
    ['Ma. Lira', 'Peña', 'Dela Cruz'],
  ]);
  assert.equal(result.rows[2]!.proposed.grade, '4');
  assert.equal(result.rows[2]!.proposed.givenName, 'Ma. Lira');
  assert.equal(result.rows[2]!.status, 'clean');
});
for (const [i, base] of [
  'Ma. Miro A. Dela Cruz',
  'Lira B. De los Santos',
  'Neri C. Sta. Maria',
  'Zoë D. Peña',
  'Jona E. Macapagal-Arroyo',
  'Mika F. San Jose',
  'Teri G. Delos Reyes',
  'Ivo H. de la Peña',
].entries()) {
  for (const [j, transform] of [
    (s: string) => s,
    (s: string) => s.toUpperCase(),
    (s: string) => s.toLowerCase(),
    (s: string) => `  ${s.replace(/ /g, '   ')}  `,
    (s: string) => `Mr. ${s}`,
    (s: string) => `${i + 1}. ${s}`,
    (s: string) => `${s} (transferee)`,
    (s: string) => `${s} - moved`,
    (s: string) => `✓ ${s}`,
  ].entries())
    test(`messy Filipino fixture ${i}-${j} conserves all identity runs`, () => {
      const original = transform(base),
        row = normalizeName(original, i);
      assert.equal(traceable(original, row.proposed), true);
      assert.equal(row.status, 'needs_review');
      assert.equal(row.original, original);
    });
}
test('near spelling variants only group, never autocorrect', () => {
  const result = structureRows([['Miro Peña'], ['Miro Peña'], ['Miro Peñá']]);
  assert.equal(result.rows.length, 3);
  assert.ok(result.rows.every((r) => r.flags.includes('possible_duplicate')));
  assert.deepEqual(
    result.rows.map((r) => r.proposed.displayName),
    ['Miro Peña', 'Miro Peña', 'Miro Peñá']
  );
});
test('exact mode preserves header-like names and layout without guessing', () => {
  const result = structureRows([['  Ma. Miro Peña  '], ['Name'], ['J. Reyes']], {
    exactlyAsWritten: true,
  });
  assert.deepEqual(
    result.rows.map((r) => r.proposed.displayName),
    ['  Ma. Miro Peña  ', 'Name', 'J. Reyes']
  );
  assert.ok(result.rows.every((r) => !r.proposed.familyName && !r.proposed.givenName));
});
test('explicit initial mapping supports sparse/reordered columns but cannot remap sensitive headers', () => {
  const parsed = structureRows(
    [
      ['Unusual', 'LRN', 'Custom'],
      ['Miro', '123456789012', 'Peña'],
    ],
    {
      headerRowIndex: 0,
      columns: [
        { index: 2, field: 'familyName', header: 'Custom' },
        { index: 0, field: 'givenName', header: 'Unusual' },
        { index: 1, field: 'fullName', header: 'LRN' },
      ],
    }
  );
  assert.equal(parsed.rows[1]!.proposed.givenName, 'Miro');
  assert.equal(parsed.rows[1]!.proposed.familyName, 'Peña');
  assert.ok(!JSON.stringify(parsed).includes('123456789012'));
  const sparse = structureRows([['Private', 'Peña, Miro A.']], {
    columns: [{ index: 1, field: 'fullName', header: 'Name' }],
    headerRowIndex: null,
  });
  assert.equal(sparse.rows[0]!.proposed.displayName, 'Peña, Miro A.');
  assert.ok(!JSON.stringify(sparse).includes('Private'));
});
test('oversized display names remain pending for editing without invalid response fields', () => {
  const parsed = structureRows([['X'.repeat(220)]]);
  assert.equal(parsed.rows[0]!.status, 'needs_review');
  assert.equal(parsed.rows[0]!.proposed.displayName, '');
  assert.equal(parsed.rows[0]!.original.length, 220);
});
test('pasted CSV header distinguishes a table from surname-first plain lines', () => {
  assert.deepEqual(extractText('Name,Grade\n"Peña, Miro A.",3'), [
    ['Name', 'Grade'],
    ['Peña, Miro A.', '3'],
  ]);
});
test('500 students plus headers are accepted without permitting 501 students or 101 metadata lines', () => {
  const students = Array.from({ length: 500 }, (_, i) => [
    `Peña, Miro ${String.fromCharCode(65 + (i % 26))}.`,
    '3',
  ]);
  assert.equal(structureRows([['Name', 'Grade'], ...students]).rows.length, 501);
  assert.throws(() => structureRows([['Name', 'Grade'], ...students, ['Reyes, Neri A.', '3']]));
  assert.throws(() =>
    structureRows([...Array.from({ length: 101 }, () => ['Boys']), ['Peña, Miro A.']])
  );
});
