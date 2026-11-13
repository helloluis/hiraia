import type { Lang, SyncEngine, TeacherProfile, User } from '@hiraia/tala-core/contracts';

/** The one-per-account profile record; created on first use from the signed-in user. */
export async function ensureProfile(engine: SyncEngine, user: User | null, lang: Lang): Promise<TeacherProfile> {
  const existing = await engine.get('profile', 'profile');
  if (existing && !existing.deletedAt) return existing.data;
  const profile: TeacherProfile = {
    id: 'profile',
    displayName: user?.displayName || 'Teacher',
    uiLanguage: lang,
    schoolName: '',
    region: '',
    dataSaver: false,
    activeSchoolYearId: null,
    pacingParams: {},
  };
  await engine.put('profile', profile);
  return profile;
}
