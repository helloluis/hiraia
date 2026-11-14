/**
 * In-place upgrade from Tala 0.4.x (PRD ACT-2): importing the Kotlin app's `hiraia-tala.db` into
 * the activity store. The plan is in modules/tala-activity/UPGRADE.md; this is the import step,
 * written against the 0.4.x schema (TalaDatabase.kt, versions 5–9 on branch tala-0.4.x) and
 * tested with a fixture database. It only READS the source; nothing here opens another app's data
 * — today's V1 builds are `com.hiraia.tala.next` and cannot see 0.4.x's files.
 */
import type { ActivityStore, Database } from './store';
import { CLASS_UUID } from './protocol';

export type LegacyClass = {
  id: string;
  enrollmentId: string;
  name: string;
  teacherName: string;
  schoolName: string;
  gradeLevel: string;
  schoolYear: string;
  createdAt: number;
};

export type ImportSummary = {
  schemaVersion: number;
  classes: LegacyClass[];
  students: number;
  events: number;
  devices: number;
  avatars: number;
  /** Keystore aliases `hiraia.tala.class.<id>` that must still exist for students to be readable. */
  enrollmentIds: string[];
};

async function columns(db: Database, table: string): Promise<Set<string>> {
  return new Set(
    (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((r) => r.name)
  );
}

async function hasTable(db: Database, table: string): Promise<boolean> {
  return !!(await db.getFirstAsync(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    table
  ));
}

/** What the source is, before importing: version and classes, so the UI can show them. */
export async function inspectLegacy(source: Database): Promise<{
  schemaVersion: number;
  classes: LegacyClass[];
}> {
  const version =
    (await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ??
    0;
  if (!(await hasTable(source, 'school_classes')) || !(await hasTable(source, 'students')))
    throw new Error('Not a Tala 0.4.x database');
  const cols = await columns(source, 'school_classes');
  if (!cols.has('enrollment_id') || !(await columns(source, 'students')).has('class_id'))
    throw new Error(
      'Tala database is older than 0.3.0 (schema 3); open it in Tala 0.4.x once to migrate it'
    );
  const classes = (
    await source.getAllAsync<Record<string, unknown>>(
      'SELECT id, enrollment_id, name, teacher_name, school_name, grade_level, school_year, created_at FROM school_classes ORDER BY created_at, name'
    )
  ).map((r) => ({
    id: r.id as string,
    enrollmentId: r.enrollment_id as string,
    name: (r.name as string) ?? '',
    teacherName: (r.teacher_name as string) ?? '',
    schoolName: (r.school_name as string) ?? '',
    gradeLevel: (r.grade_level as string) ?? '',
    schoolYear: (r.school_year as string) ?? '',
    createdAt: (r.created_at as number) ?? 0,
  }));
  return { schemaVersion: version, classes };
}

/**
 * Copy classes, learners, events, device state and avatars. `classIdFor` maps a 0.4.x class to
 * the local planning class id it becomes (default: keep the 0.4.x id, so a planning class record
 * can be created with the same id by the caller). Enrollment ids and timestamps are preserved
 * exactly; `left_at`/`removed_at` too when the source has them (schema 9). Re-running is safe:
 * rows already present are left alone.
 */
export async function importLegacy(
  source: Database,
  target: ActivityStore,
  options: { classIdFor?: (legacy: LegacyClass) => string } = {}
): Promise<ImportSummary> {
  const { schemaVersion, classes } = await inspectLegacy(source);
  const classIdFor = options.classIdFor ?? ((c: LegacyClass) => c.id);
  const studentCols = await columns(source, 'students');
  const deviceCols = await columns(source, 'devices');
  const withAvatars = await hasTable(source, 'student_avatars');
  const summary: ImportSummary = {
    schemaVersion,
    classes,
    students: 0,
    events: 0,
    devices: 0,
    avatars: 0,
    enrollmentIds: [],
  };
  for (const legacy of classes) {
    if (!CLASS_UUID.test(legacy.enrollmentId))
      throw new Error(`Class ${legacy.name} has an enrollment id that is not a UUID`);
    const classId = classIdFor(legacy);
    await target.ensureClass({
      classId,
      name: legacy.name || 'Class',
      teacherName: legacy.teacherName,
      schoolName: legacy.schoolName,
      gradeLevel: legacy.gradeLevel,
      schoolYear: legacy.schoolYear,
      enrollmentId: legacy.enrollmentId,
      createdAt: legacy.createdAt,
    });
    summary.enrollmentIds.push(legacy.enrollmentId);
    const students = await source.getAllAsync<Record<string, unknown>>(
      `SELECT installation_id, profile_id, name, first_seen${studentCols.has('left_at') ? ', left_at' : ''}${studentCols.has('removed_at') ? ', removed_at' : ''}
       FROM students WHERE class_id=?`,
      legacy.id
    );
    const events = await source.getAllAsync<Record<string, unknown>>(
      `SELECT installation_id, event_id, profile_id, event_name, correct, occurred_at, received_at, props
       FROM events WHERE class_id=?`,
      legacy.id
    );
    const devices = await source.getAllAsync<Record<string, unknown>>(
      `SELECT installation_id, last_sync${deviceCols.has('last_seen') ? ', last_seen, last_accepted, last_rejected' : ''}
       FROM devices WHERE class_id=?`,
      legacy.id
    );
    const avatars = withAvatars
      ? await source.getAllAsync<Record<string, unknown>>(
          'SELECT installation_id, profile_id, animal_index, color_index FROM student_avatars WHERE class_id=?',
          legacy.id
        )
      : [];
    await target.db.withExclusiveTransactionAsync(async (tx) => {
      for (const s of students) {
        await tx.runAsync(
          `INSERT OR IGNORE INTO activity_students(class_id,installation_id,profile_id,name,first_seen,left_at,removed_at)
           VALUES(?,?,?,?,?,?,?)`,
          classId,
          s.installation_id as string,
          s.profile_id as string,
          (s.name as string) ?? '',
          (s.first_seen as number) ?? 0,
          (s.left_at as number | null) ?? null,
          (s.removed_at as number | null) ?? null
        );
        summary.students++;
      }
      for (const e of events) {
        await tx.runAsync(
          `INSERT OR IGNORE INTO activity_events(class_id,installation_id,event_id,profile_id,event_name,correct,occurred_at,received_at,props)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          classId,
          e.installation_id as string,
          e.event_id as string,
          e.profile_id as string,
          e.event_name as string,
          (e.correct as number) ?? 0,
          (e.occurred_at as number) ?? 0,
          (e.received_at as number) ?? 0,
          (e.props as string) ?? '{}'
        );
        summary.events++;
      }
      for (const d of devices) {
        await tx.runAsync(
          `INSERT OR IGNORE INTO activity_devices(class_id,installation_id,last_sync,last_seen,last_accepted,last_rejected)
           VALUES(?,?,?,?,?,?)`,
          classId,
          d.installation_id as string,
          (d.last_sync as number) ?? 0,
          (d.last_seen as number) ?? (d.last_sync as number) ?? 0,
          (d.last_accepted as number) ?? 0,
          (d.last_rejected as number) ?? 0
        );
        summary.devices++;
      }
      for (const a of avatars) {
        await tx.runAsync(
          `INSERT OR IGNORE INTO activity_avatars(class_id,installation_id,profile_id,animal_index,color_index)
           VALUES(?,?,?,?,?)`,
          classId,
          a.installation_id as string,
          a.profile_id as string,
          a.animal_index as number,
          a.color_index as number
        );
        summary.avatars++;
      }
    });
  }
  return summary;
}
