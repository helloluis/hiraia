'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  PILOT_GRADES,
  PILOT_MAX_CLASSES,
  PILOT_PROVINCES,
  PILOT_SCHOOL_TYPES,
  validatePilotApplication,
  type PilotApplication,
  type PilotErrors,
} from '@/lib/pilot-application';
import styles from './PilotApplication.module.css';

function Field({
  name,
  label,
  hint,
  errors,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  errors: PilotErrors;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={name}>{label}</label>
      {hint && (
        <p className={styles.hint} id={`${name}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {errors[name] && (
        <p className={styles.fieldError} id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );
}

export function PilotApplicationForm() {
  const [ready, setReady] = useState(false);
  const [classes, setClasses] = useState([0]);
  const nextClass = useRef(1);
  const [errors, setErrors] = useState<PilotErrors>({});
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [submitted, setSubmitted] = useState<PilotApplication | null>(null);
  const request = useRef<{ body: string; id: string } | null>(null);
  const submitting = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLElement>(null);
  const newClassRef = useRef<HTMLInputElement>(null);
  const focusNewClass = useRef(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (status === 'error') summaryRef.current?.focus();
    if (status === 'success') successRef.current?.focus();
  }, [status, errors]);
  useEffect(() => {
    if (focusNewClass.current) {
      newClassRef.current?.focus();
      focusNewClass.current = false;
    }
  }, [classes]);

  const attrs = (name: string, hint = false) => ({
    id: name,
    name,
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby':
      [hint ? `${name}-hint` : '', errors[name] ? `${name}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  });
  function input(
    name: string,
    label: string,
    options: {
      optional?: boolean;
      type?: string;
      max?: number;
      autoComplete?: string;
      hint?: string;
      placeholder?: string;
    } = {}
  ) {
    return (
      <Field
        name={name}
        label={`${label}${options.optional ? ' (optional)' : ''}`}
        hint={options.hint}
        errors={errors}
      >
        <input
          {...attrs(name, Boolean(options.hint))}
          type={options.type ?? 'text'}
          required={!options.optional}
          maxLength={options.max ?? 160}
          autoComplete={options.autoComplete}
          placeholder={options.placeholder}
        />
      </Field>
    );
  }
  function textarea(name: string, label: string, hint: string, optional = false) {
    return (
      <Field
        name={name}
        label={`${label}${optional ? ' (optional)' : ''}`}
        hint={hint}
        errors={errors}
      >
        <textarea
          {...attrs(name, true)}
          required={!optional}
          minLength={optional ? undefined : 50}
          maxLength={optional ? 1500 : 4000}
          rows={optional ? 3 : 5}
        />
      </Field>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    const raw = Object.fromEntries(data);
    const application = {
      ...raw,
      consent: data.get('consent') === 'on',
      classes: classes.map((_, i) => ({
        name: data.get(`classes.${i}.name`),
        grade: data.get(`classes.${i}.grade`),
        students: Number(data.get(`classes.${i}.students`)),
      })),
    };
    const validated = validatePilotApplication(application);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage('Please check the highlighted fields.');
      setStatus('error');
      return;
    }
    submitting.current = true;
    setErrors({});
    setMessage('');
    setStatus('submitting');
    try {
      const body = JSON.stringify({ ...validated.value, website: data.get('website') ?? '' });
      if (!request.current || request.current.body !== body)
        request.current = { body, id: crypto.randomUUID() };
      const response = await fetch('/api/pilot-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...JSON.parse(body), requestId: request.current.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        setErrors(result?.errors ?? {});
        setMessage(
          result?.error ??
            'We could not submit your application. Your entries are still here; please try again.'
        );
        setStatus('error');
        return;
      }
      setSubmitted(validated.value);
      setStatus('success');
    } catch {
      setMessage(
        'We could not confirm your submission. Check your connection and try again; your entries are still here.'
      );
      setStatus('error');
    } finally {
      submitting.current = false;
    }
  }

  if (status === 'success' && submitted)
    return (
      <section
        id="pilot-form"
        className={`${styles.paper} ${styles.success}`}
        ref={successRef}
        tabIndex={-1}
        aria-labelledby="pilot-success-title"
      >
        <p className={`mc-label ${styles.eyebrow}`}>Thank you</p>
        <h2 id="pilot-success-title">Application received</h2>
        <p>
          We&apos;ve saved the application for <strong>{submitted.schoolName}</strong>.
        </p>
        <p>
          The Hiraia team will review your details and can reach you at{' '}
          <strong>{submitted.email}</strong> to discuss the pilot.
        </p>
        <a href="/" className={styles.submit}>
          Back to Hiraia <span aria-hidden="true">↗</span>
        </a>
      </section>
    );

  return (
    <form
      id="pilot-form"
      className={styles.paper}
      onSubmit={submit}
      method="post"
      action="/api/pilot-applications"
      noValidate
      aria-labelledby="pilot-form-title"
      aria-busy={status === 'submitting'}
    >
      <div className={styles.formHeading}>
        <h2 id="pilot-form-title">Pilot application</h2>
        <p>All fields are required unless marked optional.</p>
      </div>
      <noscript>
        <p className={styles.errorSummary}>
          Please enable JavaScript and reload this page to send your application.
        </p>
      </noscript>
      {status === 'error' && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className={styles.errorSummary}>
          <p>{message}</p>
          {Object.keys(errors).length > 0 && (
            <ul>
              {Object.entries(errors).map(([key, error]) => (
                <li key={key}>
                  <a href={`#${key}`}>{error}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <fieldset disabled={status === 'submitting'} className={styles.formFields}>
        <legend className="sr-only">School pilot application details</legend>
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="pilot-website">Leave this field empty</label>
          <input id="pilot-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <fieldset className={styles.section}>
          <legend>
            <span>01</span> About you
          </legend>
          <div className={styles.grid}>
            {input('contactName', 'Full name', { max: 120, autoComplete: 'name' })}
            {input('role', 'Role or position', {
              max: 120,
              autoComplete: 'organization-title',
              placeholder: 'e.g. Science teacher, school head',
            })}
            {input('email', 'Email address', { type: 'email', max: 200, autoComplete: 'email' })}
            {input('mobile', 'Mobile number', {
              optional: true,
              type: 'tel',
              max: 40,
              autoComplete: 'tel',
            })}
          </div>
        </fieldset>
        <fieldset className={styles.section}>
          <legend>
            <span>02</span> Your institution
          </legend>
          <div className={styles.grid}>
            {input('schoolName', 'Institution name', { max: 200, autoComplete: 'organization' })}
            <Field name="schoolType" label="Institution type" errors={errors}>
              <select {...attrs('schoolType')} required defaultValue="">
                <option value="" disabled>
                  Select a type
                </option>
                {PILOT_SCHOOL_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {input('city', 'City or municipality', { autoComplete: 'address-level2' })}
            <Field name="province" label="Province / Metro Manila" errors={errors}>
              <select {...attrs('province')} required defaultValue="" autoComplete="address-level1">
                <option value="" disabled>
                  Select a province
                </option>
                {PILOT_PROVINCES.map((province) => (
                  <option key={province}>{province}</option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>
        <fieldset id="classes" className={styles.section}>
          <legend>
            <span>03</span> Your pilot classes
          </legend>
          <p className={styles.sectionNote}>
            Add each class or section you&apos;d like to include. Estimates are fine.
          </p>
          {errors.classes && <p className={styles.fieldError}>{errors.classes}</p>}
          <div className={styles.classes}>
            {classes.map((key, i) => (
              <fieldset className={styles.classRow} key={key}>
                <legend>Class {i + 1}</legend>
                <div className={styles.classGrid}>
                  <Field name={`classes.${i}.name`} label="Class / section name" errors={errors}>
                    <input
                      {...attrs(`classes.${i}.name`)}
                      required
                      maxLength={120}
                      placeholder="e.g. Mabini"
                      ref={i === classes.length - 1 ? newClassRef : undefined}
                    />
                  </Field>
                  <Field name={`classes.${i}.grade`} label="Grade level" errors={errors}>
                    <select {...attrs(`classes.${i}.grade`)} required defaultValue="">
                      <option value="" disabled>
                        Select grade
                      </option>
                      {PILOT_GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g === 'mixed' ? 'Mixed grades' : `Grade ${g}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field name={`classes.${i}.students`} label="Number of students" errors={errors}>
                    <input
                      {...attrs(`classes.${i}.students`)}
                      type="number"
                      inputMode="numeric"
                      required
                      min={1}
                      max={1000}
                      step={1}
                    />
                  </Field>
                </div>
                {classes.length > 1 && (
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove class ${i + 1}`}
                    onClick={() => {
                      focusNewClass.current = true;
                      setClasses((c) => c.filter((k) => k !== key));
                      setErrors({});
                    }}
                  >
                    Remove class
                  </button>
                )}
              </fieldset>
            ))}
          </div>
          {classes.length < PILOT_MAX_CLASSES && (
            <button
              type="button"
              className={styles.add}
              onClick={() => {
                const key = nextClass.current++;
                focusNewClass.current = true;
                setClasses((c) => [...c, key]);
                setErrors({});
              }}
            >
              + Add another class
            </button>
          )}
          <div className={styles.extraDetails}>
            {textarea(
              'devices',
              'Devices and internet access',
              'Tell us about available or shared devices, and any access limitations.',
              true
            )}
            {input('preferredStart', 'Preferred start', {
              optional: true,
              placeholder: 'e.g. Next term, November, or flexible',
            })}
          </div>
        </fieldset>
        <fieldset className={styles.section}>
          <legend>
            <span>04</span> How could Hiraia help?
          </legend>
          <p className={styles.sectionNote}>
            Write a few sentences for each answer. Describe class needs without naming individual
            students.
          </p>
          <div className={styles.extraDetails}>
            {textarea(
              'needs',
              'What are the needs of your school and students?',
              'You might describe learning gaps, available resources, or challenges teachers face.'
            )}
            {textarea(
              'benefit',
              'Why would AI-assisted tutoring help your students?',
              'Tell us what you hope would improve and how teachers could use Hiraia with the class.'
            )}
          </div>
        </fieldset>
        <div className={styles.sendSection}>
          <label className={styles.consent} htmlFor="consent">
            <input {...attrs('consent')} type="checkbox" required />
            <span>
              I agree that Hiraia may use these details to review this application and contact me
              about the pilot.
            </span>
          </label>
          {errors.consent && (
            <p className={styles.fieldError} id="consent-error">
              {errors.consent}
            </p>
          )}
          <button type="submit" className={styles.submit} disabled={!ready}>
            {status === 'submitting' ? 'Sending application…' : 'Send pilot application'}
            <span aria-hidden="true">↗</span>
          </button>
          <p className={styles.hint}>
            Your application goes to the Hiraia team. Submitting does not confirm a pilot placement.
          </p>
          <p className="sr-only" role="status">
            {status === 'submitting' ? 'Sending your application. Please wait.' : ''}
          </p>
        </div>
      </fieldset>
    </form>
  );
}
