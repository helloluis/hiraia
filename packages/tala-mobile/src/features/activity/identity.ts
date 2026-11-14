/**
 * A class's collection identity: its enrollment id (the QR's class_id), its keystore key, its hint,
 * endpoint name and QR payload. ClassIdentity.kt + ClassNames.kt + ClassHint.kt of Tala 0.4.4.
 */
import type { ActivityCrypto } from './crypto';
import { classHint, displayClassName, endpointNameFor, qrPayload } from './protocol';
import type { ActivityClass, ActivityStore } from './store';

export type ClassIdentity = {
  cls: ActivityClass;
  enrollmentId: string;
  publicKey: string;
  hint: string;
  endpointName: string;
  /** The name on the wire: typed name, else a stable derived one; never blank; ≤ 48. */
  displayName(): Promise<string>;
  /** The exact QR JSON, name included. */
  qrPayload(): Promise<string>;
};

/**
 * Ensures the class row and key exist and returns the identity. Idempotent; the enrollment id
 * and key never change once made, so students never have to re-join (ACT-2).
 */
export async function classIdentity(
  store: ActivityStore,
  crypto: ActivityCrypto,
  input: {
    classId: string;
    name: string;
    teacherName?: string;
    schoolName?: string;
    gradeLevel?: string;
    schoolYear?: string;
  }
): Promise<ClassIdentity> {
  const cls = await store.ensureClass(input);
  const publicKey = await crypto.ensureClassKey(cls.enrollmentId);
  const hint = await classHint(cls.enrollmentId, (b) => crypto.sha256(b));
  const displayName = async () => {
    const current = (await store.classById(cls.classId)) ?? cls;
    return displayClassName(cls.enrollmentId, current.name, (b) => crypto.sha256(b));
  };
  return {
    cls,
    enrollmentId: cls.enrollmentId,
    publicKey,
    hint,
    endpointName: endpointNameFor(hint),
    displayName,
    qrPayload: async () => qrPayload(cls.enrollmentId, await displayName(), publicKey),
  };
}

/** Deleting a class: its activity and its key go together (PRIV-10). */
export async function deleteClassIdentity(
  store: ActivityStore,
  crypto: ActivityCrypto,
  classId: string
): Promise<void> {
  const cls = await store.classById(classId);
  await store.deleteClass(classId);
  if (cls) await crypto.deleteClassKey(cls.enrollmentId);
}
