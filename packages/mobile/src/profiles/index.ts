import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { newId } from '../telemetry/core';
export interface StudentProfile {
  id: string;
  name: string;
  createdAt: number;
}
interface SavedProfiles {
  version: 1;
  profiles: StudentProfile[];
  activeId: string;
  onboarding: boolean;
}
const KEY = 'hiraia.student-profiles.v1';
const listeners = new Set<() => void>();
let saved: SavedProfiles = { version: 1, profiles: [], activeId: 'guest', onboarding: false };
let state = {
  ready: false,
  choosing: false,
  error: false,
  hasChoice: false,
  profiles: saved.profiles,
  activeId: 'guest',
};
let initializing: Promise<void> | null = null;
function update(next: Partial<typeof state>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}
export function profileSnapshot() {
  return state;
}
export function subscribeProfiles(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useProfiles() {
  return useSyncExternalStore(subscribeProfiles, profileSnapshot, profileSnapshot);
}
export function activeProfile() {
  return saved.profiles.find((p) => p.id === state.activeId) ?? null;
}
export function profileTelemetry(): Record<string, string> {
  return state.activeId === 'guest'
    ? { profile_kind: 'guest' }
    : { profile_kind: 'student', profile_id: state.activeId };
}
export function initializeProfiles(): Promise<void> {
  return (initializing ??= (async () => {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const value = JSON.parse(raw) as SavedProfiles;
      if (
        value.version !== 1 ||
        !Array.isArray(value.profiles) ||
        value.profiles.some(
          (p) =>
            !p ||
            !/^[a-zA-Z0-9_-]{16,80}$/.test(p.id) ||
            typeof p.name !== 'string' ||
            !p.name.trim() ||
            p.name.length > 40
        ) ||
        new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length ||
        (value.activeId !== 'guest' && !value.profiles.some((p) => p.id === value.activeId))
      )
        throw new Error('Invalid profile storage');
      saved = value;
    }
    update({
      ready: true,
      error: false,
      choosing: !raw,
      hasChoice: !!raw,
      profiles: saved.profiles,
      activeId: saved.activeId,
    });
  })().catch((e) => {
    initializing = null;
    update({ error: true });
    throw e;
  }));
}
export function needsProfileOnboarding() {
  return saved.onboarding;
}
export function requestProfileChoice() {
  update({ choosing: true });
}
export function cancelProfileChoice() {
  if (state.hasChoice) update({ choosing: false });
}
export function cleanFirstName(name: string) {
  return name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}
async function saveSelection(id: string | null, name?: string) {
  await initializeProfiles();
  let next = { ...saved, profiles: [...saved.profiles], onboarding: true };
  if (name !== undefined) {
    const clean = cleanFirstName(name);
    if (!clean) throw new Error('Enter a name');
    const p = { id: newId(), name: clean, createdAt: Date.now() };
    next.profiles.push(p);
    next.activeId = p.id;
  } else {
    if (id !== null && !next.profiles.some((p) => p.id === id)) throw new Error('Unknown profile');
    next.activeId = id ?? 'guest';
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
/** Existing-profile switches retain their old identity until a new JS runtime starts. */
export async function selectProfile(id: string | null, name?: string) {
  await saveSelection(id, name);
}
/** The first choice happens before any profile-scoped services/navigator are mounted.
 * Keep the picker visible until the root has bootstrapped the chosen profile.
 */
export async function selectFirstProfile(name?: string) {
  await initializeProfiles();
  if (state.hasChoice) throw new Error('A first profile has already been selected');
  const next = await saveSelection(null, name);
  saved = next;
  update({ hasChoice: true, activeId: next.activeId, profiles: next.profiles });
}
export async function finishProfileOnboarding() {
  const next = { ...saved, onboarding: false };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  saved = next;
}
