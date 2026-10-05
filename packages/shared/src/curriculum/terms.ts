import data from './three-term-2026.json';
import type { CompetencySchedule } from './scheduleLessons.js';
export { scheduleLessons } from './scheduleLessons.js';
export type { Term, CompetencySchedule } from './scheduleLessons.js';

export const TERM_SCHEDULE = data.competencies as Record<string, CompetencySchedule>;
export const CURRICULUM_NAME = data.name;
export const TERM_LABELS = ['Term 1', 'Term 2', 'Term 3'] as const;

export function scheduleForCodes(codes: readonly string[]) {
  return codes.map((code) => TERM_SCHEDULE[code]).filter((row): row is CompetencySchedule => !!row);
}
