import 'server-only';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import type { PilotApplication } from '@/lib/pilot-application';

export function savePilotApplication(requestId: string, application: PilotApplication) {
  const payload = JSON.stringify(application);
  const digest = createHash('sha256').update(payload).digest('hex');
  const db = getDb();
  return db.transaction(() => {
    const previous = db
      .prepare('SELECT id, payload_sha256 FROM pilot_applications WHERE request_id = ?')
      .get(requestId) as { id: number; payload_sha256: string } | undefined;
    if (previous)
      return { id: previous.id, duplicate: true, conflict: previous.payload_sha256 !== digest };
    const result = db
      .prepare(
        `INSERT INTO pilot_applications
      (request_id, payload_sha256, contact_name, email, school_name, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        requestId,
        digest,
        application.contactName,
        application.email,
        application.schoolName,
        payload
      );
    return { id: Number(result.lastInsertRowid), duplicate: false, conflict: false };
  })();
}

/** Persist first; delivery failure never loses an application or asks a teacher to resubmit. */
export async function notifyPilotApplication(id: number, application: PilotApplication) {
  const update = (status: string) =>
    getDb()
      .prepare('UPDATE pilot_applications SET notification_status = ? WHERE id = ?')
      .run(status, id);
  if (!process.env.RESEND_API_KEY) {
    update('unconfigured');
    return;
  }
  const a = application;
  const text = [
    `Pilot application #${id}`,
    '',
    `Contact: ${a.contactName}`,
    `Role: ${a.role}`,
    `Email: ${a.email}`,
    `Mobile: ${a.mobile || 'Not provided'}`,
    '',
    `Institution: ${a.schoolName}`,
    `Type: ${a.schoolType}`,
    `Location: ${[a.city, a.province, 'Philippines'].join(', ')}`,
    '',
    'Proposed classes:',
    ...a.classes.map(
      (c) =>
        `- ${c.name}: ${c.grade === 'mixed' ? 'Mixed grades' : `Grade ${c.grade}`}, ${c.students} students`
    ),
    '',
    `Devices / internet: ${a.devices || 'Not provided'}`,
    `Preferred start: ${a.preferredStart || 'Not provided'}`,
    '',
    'School needs:',
    a.needs,
    '',
    'Why AI-assisted tutoring could help:',
    a.benefit,
    '',
    'Applicant agreed to contact about this application.',
  ].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `pilot-application-${id}`,
      },
      body: JSON.stringify({
        from: 'Hiraia <feedback@hiraia.org>',
        to: process.env.PILOT_APPLICATION_TO || process.env.FEEDBACK_TO || 'lb@hiraia.org',
        reply_to: a.email,
        subject: `Hiraia pilot application: ${a.schoolName}`,
        text,
      }),
    });
    update(response.ok ? 'sent' : 'failed');
    if (!response.ok)
      console.error(`[pilot-application] Notification failed for #${id}: ${response.status}`);
  } catch {
    update('failed');
    console.error(`[pilot-application] Notification failed for #${id}`);
  }
}
