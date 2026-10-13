import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePilotApplication } from './pilot-application';

export const sampleApplication = () => ({
  contactName: 'Sample Teacher',
  role: 'Science teacher',
  email: 'teacher@example.test',
  mobile: '',
  schoolName: 'Example School',
  schoolType: 'Public school',
  city: 'Navotas',
  province: 'Metro Manila',
  classes: [{ name: 'Mabini', grade: '4', students: 40 }],
  devices: '',
  preferredStart: '',
  needs: 'Our classes need more opportunities to practice science with limited learning materials.',
  benefit:
    'An offline tutor could help students review lessons at home and discuss their questions in class.',
  consent: true,
});

test('accepts multiple classes and optional blanks without losing narrative text', () => {
  const application = sampleApplication();
  application.classes.push({ name: 'Mixed group', grade: 'mixed', students: 26 });
  application.needs += '\nA second paragraph with <literal text>.';
  const result = validatePilotApplication(application);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.classes, application.classes);
  assert.equal(result.value.needs, application.needs);
  assert.equal(result.value.mobile, '');
});

test('rejects malformed bodies and missing required teacher, location and narrative fields', () => {
  for (const input of [null, [], 'text', 42, {}])
    assert.equal(validatePilotApplication(input).ok, false);
  for (const field of [
    'contactName',
    'role',
    'email',
    'schoolName',
    'schoolType',
    'city',
    'province',
    'needs',
    'benefit',
  ]) {
    const result = validatePilotApplication({ ...sampleApplication(), [field]: '' });
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.ok(result.errors[field], field);
  }
});

test('rejects invalid class counts, grades, numeric coercion, short answers and missing consent', () => {
  for (const fields of [
    { classes: [] },
    { classes: Array(21).fill(sampleApplication().classes[0]) },
    { classes: [null] },
    { classes: [{ name: '', grade: '11', students: -1 }] },
    { classes: [{ name: 'A', grade: '4', students: '40' }] },
    { classes: [{ name: 'A', grade: '4', students: 1.5 }] },
    { classes: [{ name: 'A', grade: '4', students: 1001 }] },
    { email: 'not-an-address' },
    { province: 'Not a province' },
    { mobile: 'call me' },
    { needs: 'too short' },
    { benefit: 'x'.repeat(4001) },
    { consent: false },
    { consent: 'true' },
  ])
    assert.equal(validatePilotApplication({ ...sampleApplication(), ...fields }).ok, false);
});

test('sanitizes single-line fields and rejects control-only names', () => {
  const result = validatePilotApplication({
    ...sampleApplication(),
    schoolName: 'School\r\nInjected subject\u0000',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.schoolName, 'School Injected subject');
  assert.equal(
    validatePilotApplication({ ...sampleApplication(), contactName: '\u0000\u001b' }).ok,
    false
  );
});
