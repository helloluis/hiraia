/** What an AI request's trouble is called on screen (every one says the slides are unchanged). */
import type { SlidesAiTrouble } from '@/data/decks';
import type { StringKey } from '@/i18n';

export const TROUBLE_KEY: Record<SlidesAiTrouble, StringKey> = {
  disabled: 'pp.err.disabled',
  providers_unavailable: 'pp.err.providers',
  invalid_output: 'pp.err.invalid',
  quota_exceeded: 'pp.err.quota',
  budget_exceeded: 'pp.err.budget',
  interrupted: 'pp.err.interrupted',
  gone: 'pp.err.gone',
  offline: 'pp.err.offline',
  signedOut: 'pp.err.signedOut',
  unsynced: 'pp.err.unsynced',
  empty_lesson: 'pp.err.emptyLesson',
  choose_day: 'pp.err.chooseDay',
  conflict: 'pp.err.conflict',
  server: 'pp.err.server',
};

/** Troubles worth a "Try again" button (the others need something else first). */
export const RETRYABLE: ReadonlySet<SlidesAiTrouble> = new Set(['providers_unavailable', 'invalid_output', 'interrupted', 'offline', 'unsynced', 'server']);
