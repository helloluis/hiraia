/**
 * Rule-based detectors for student personal data and contact details (PRD §11.6, PRIV-9), usable on the
 * device before posting and on the server at posting time.
 * OWNER: workstream G. Pure TypeScript only (no I/O, no platform APIs).
 *
 *   const findings = detectPersonalData({ title, summary, sections }, { knownNames });
 *   if (hasBlockingFinding(findings)) show the findings; the server would return this post.
 */
export {
  detectPersonalData,
  hasBlockingFinding,
  knownNameVariants,
  NAME_LIST_THRESHOLDS,
  PERSONAL_DATA_MESSAGES,
} from './detectors';
export type { DetectOptions, PersonalDataFinding, PersonalDataKind } from './detectors';
export { moderationText, normalizeForMatch, sectionTextGroups, textUnits } from './text';
export type { ModerationTextInput, TextUnit } from './text';
