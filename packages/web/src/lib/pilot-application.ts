/** Shared field validation only. No server dependencies or applicant data in this module. */
import { PILOT_PROVINCES } from '@/config/philippine-provinces';
export { PILOT_PROVINCES };
export const PILOT_MAX_CLASSES = 20;
export const PILOT_GRADES = ['3', '4', '5', '6', '7', '8', '9', '10', 'mixed'] as const;
export const PILOT_SCHOOL_TYPES = [
  'Public school',
  'Private school',
  'Learning center',
  'Other',
] as const;

export type PilotClass = { name: string; grade: string; students: number };
export type PilotApplication = {
  contactName: string;
  role: string;
  email: string;
  mobile: string;
  schoolName: string;
  schoolType: string;
  city: string;
  province: string;
  classes: PilotClass[];
  devices: string;
  preferredStart: string;
  needs: string;
  benefit: string;
  consent: true;
};
export type PilotErrors = Record<string, string>;

export function validatePilotApplication(
  input: unknown
): { ok: true; value: PilotApplication } | { ok: false; errors: PilotErrors } {
  const raw: Record<string, unknown> =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const errors: PilotErrors = {};
  function text(key: string, label: string, max: number, min = 1, multiline = false): string {
    const v = raw[key];
    if (typeof v !== 'string' && !(min === 0 && v === undefined)) {
      errors[key] = `Enter ${label}.`;
      return '';
    }
    const original = (v as string | undefined) ?? '';
    const cleaned = (
      multiline
        ? original.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        : original.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ')
    ).trim();
    if (cleaned.length < min)
      errors[key] =
        min > 1 ? `Write a few sentences (at least ${min} characters).` : `Enter ${label}.`;
    if (original.length > max) errors[key] = `Keep ${label} to ${max} characters or fewer.`;
    return cleaned;
  }
  const contactName = text('contactName', 'your full name', 120);
  const role = text('role', 'your role or position', 120);
  const email = text('email', 'your email address', 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = 'Enter a valid email address.';
  const mobile = text('mobile', 'your mobile number', 40, 0);
  if (mobile && (!/^[+\d\s().-]+$/.test(mobile) || mobile.replace(/\D/g, '').length < 7)) {
    errors.mobile = 'Enter a mobile number, including the area or country code if needed.';
  }
  const schoolName = text('schoolName', 'the institution name', 200);
  const schoolType = text('schoolType', 'the institution type', 40);
  if (!(PILOT_SCHOOL_TYPES as readonly string[]).includes(schoolType))
    errors.schoolType = 'Choose an institution type.';
  const city = text('city', 'the city or municipality', 160);
  const province = text('province', 'the province or Metro Manila', 160);
  if (!(PILOT_PROVINCES as readonly string[]).includes(province))
    errors.province = 'Choose a province or Metro Manila.';
  const devices = text('devices', 'device and internet details', 1500, 0, true);
  const preferredStart = text('preferredStart', 'the preferred start', 160, 0);
  const needs = text('needs', 'the school needs', 4000, 50, true);
  const benefit = text('benefit', 'the expected benefits', 4000, 50, true);
  if (raw.consent !== true)
    errors.consent = 'Please agree to being contacted about your application.';
  const classes: PilotClass[] = [];
  if (
    !Array.isArray(raw.classes) ||
    raw.classes.length < 1 ||
    raw.classes.length > PILOT_MAX_CLASSES
  ) {
    errors.classes = `Include between 1 and ${PILOT_MAX_CLASSES} classes.`;
  } else {
    raw.classes.forEach((entry: unknown, i: number) => {
      const c =
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      const name =
        typeof c.name === 'string' ? c.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
      if (!name || name.length > 120)
        errors[`classes.${i}.name`] = 'Enter a class or section name (up to 120 characters).';
      const grade = typeof c.grade === 'string' ? c.grade : '';
      if (!(PILOT_GRADES as readonly string[]).includes(grade))
        errors[`classes.${i}.grade`] = 'Choose a grade level.';
      const students = typeof c.students === 'number' ? c.students : NaN;
      if (!Number.isInteger(students) || students < 1 || students > 1000)
        errors[`classes.${i}.students`] = 'Enter a whole number from 1 to 1,000.';
      classes.push({ name, grade, students });
    });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      contactName,
      role,
      email,
      mobile,
      schoolName,
      schoolType,
      city,
      province,
      classes,
      devices,
      preferredStart,
      needs,
      benefit,
      consent: true,
    },
  };
}
