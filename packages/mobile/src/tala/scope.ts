import { ID } from './protocol';

/**
 * Class membership is per student, not per phone (docs/SHARED-PROFILES.md). A scope is the
 * student an event or a class binding belongs to: a named profile's id, or 'guest' for the
 * Guest, which has no profile id of its own.
 */
export const GUEST_SCOPE = 'guest';

/** The scope an event belongs to, from the same profile props the teacher routes on. */
export function eventScope(props: Record<string, unknown>): string {
  return props.profile_kind === 'student' &&
    typeof props.profile_id === 'string' &&
    ID.test(props.profile_id)
    ? props.profile_id
    : GUEST_SCOPE;
}

/** Profile props for events the phone writes on a scope's behalf (reports, rebuilt history). */
export function scopeProps(scope: string): Record<string, string> {
  return scope === GUEST_SCOPE
    ? { profile_kind: 'guest' }
    : { profile_kind: 'student', profile_id: scope };
}

/** The id a teacher knows this scope by: the Guest travels as the phone's installation id. */
export function wireId(scope: string, installationId: string): string {
  return scope === GUEST_SCOPE ? installationId : scope;
}
