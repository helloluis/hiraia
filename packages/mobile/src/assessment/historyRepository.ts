import { assessmentStorageKey, decodeAssessmentData } from './storage';
import type { AdmissionMode, AssessmentResult } from './types';

export interface HistoryDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...parameters: string[]): Promise<T | null>;
  closeAsync(): Promise<void>;
}
export interface HistoryReadAdapter {
  directory: string;
  knownProfileIds: ReadonlySet<string>;
  exists(uri: string): Promise<boolean>;
  open(name: string, options: { useNewConnection: true }, directory: string): Promise<HistoryDatabase>;
}

async function nativeAdapter(): Promise<HistoryReadAdapter> {
  const [SQLite, fileSystem, profiles] = await Promise.all([
    import('expo-sqlite'),
    import('expo-file-system/legacy'),
    import('../profiles'),
  ]);
  await profiles.initializeProfiles();
  const directory: unknown = SQLite.defaultDatabaseDirectory;
  if (typeof directory !== 'string' || !directory) throw new Error('The local database directory is unavailable.');
  return {
    directory,
    knownProfileIds: new Set(['guest', ...profiles.profileSnapshot().profiles.map((profile) => profile.id)]),
    exists: async (uri) => {
      const info = await fileSystem.getInfoAsync(uri);
      return info.exists && !info.isDirectory;
    },
    open: (name, options, location) => SQLite.openDatabaseAsync(name, options, location),
  };
}

/** Read an existing profile DB without changing identity, migrating, or sharing its writer. */
export async function readAssessmentHistory(
  profileId: string,
  mode: AdmissionMode,
  adapter?: HistoryReadAdapter,
): Promise<AssessmentResult[]> {
  const io = adapter ?? await nativeAdapter();
  if (!io.knownProfileIds.has(profileId) || (profileId !== 'guest' && !/^[a-zA-Z0-9_-]{16,80}$/.test(profileId))) {
    throw new Error('This student profile is not available on this device.');
  }
  if (mode !== 'local_evaluation' && mode !== 'production') throw new Error('Invalid assessment admission mode.');
  const name = profileId === 'guest' ? 'hiraia.db' : `hiraia-profile-${profileId}.db`;
  const path = `${io.directory.replace(/\/+$/, '')}/${name}`;
  const uri = path.startsWith('file://') ? path : path.startsWith('/') ? `file://${path}` : null;
  if (!uri) throw new Error('The local database path is invalid.');
  // openDatabaseAsync can create a database. Never call it for an absent profile file.
  if (!await io.exists(uri)) return [];
  const database = await io.open(name, { useNewConnection: true }, io.directory);
  try {
    await database.execAsync('PRAGMA query_only = ON');
    const table = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", 'settings',
    );
    if (!table) return [];
    const row = await database.getFirstAsync<{ value: string | null }>(
      'SELECT value FROM settings WHERE key = ?', assessmentStorageKey(profileId, mode),
    );
    if (!row || row.value === null) return [];
    if (typeof row.value !== 'string') throw new Error('Saved assessment data could not be read.');
    const data = decodeAssessmentData(row.value, profileId);
    if (data.history.some((result) => result.session.admissionMode !== mode)
      || (data.activeSession && data.activeSession.admissionMode !== mode)) {
      throw new Error('Saved assessment admission mode does not match this report.');
    }
    return data.history;
  } finally {
    await database.closeAsync();
  }
}
