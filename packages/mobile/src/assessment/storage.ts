import { validTime } from './selection';
import { isAssessmentDiagram } from './diagram';
import type { AdmissionMode, AssessmentData, AssessmentSession } from './types';

export interface AssessmentStorage {
  load(profileId: string, mode: AdmissionMode): Promise<string | null>;
  save(profileId: string, serialized: string, mode: AdmissionMode): Promise<void>;
}
export const assessmentStorageKey = (profileId: string, mode: AdmissionMode) =>
  `assessment.progress.v1.${mode}.${profileId}`;
export function emptyAssessmentData(profileId: string): AssessmentData {
  return {
    version: 1,
    profileId,
    activeSession: null,
    history: [],
    exposures: [],
    pendingStart: false,
    pendingResultsId: null,
    lastObservedAt: null,
  };
}
function validSession(value: AssessmentSession, profileId: string, completed: boolean): boolean {
  if (
    !value ||
    value.profileId !== profileId ||
    typeof value.id !== 'string' ||
    !value.id ||
    validTime(value.startedAt) === null ||
    !['en', 'tl', 'bis'].includes(value.language) ||
    !Number.isInteger(value.grade) ||
    value.grade < 3 ||
    value.grade > 10 ||
    !['local_evaluation', 'production'].includes(value.admissionMode) ||
    typeof value.comparisonKey !== 'string' ||
    !Array.isArray(value.items) ||
    value.items.length !== 12 ||
    !Array.isArray(value.answers) ||
    (completed ? value.answers.length !== 12 : value.answers.length >= 12)
  )
    return false;
  const ids = new Set<string>(),
    families = new Set<string>(),
    facts = new Set<string>();
  for (const item of value.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      item.id !== item.itemId ||
      typeof item.stem !== 'string' ||
      !item.stem ||
      typeof item.explanation !== 'string' ||
      (item.diagramRequired !== undefined && item.diagramRequired !== true) ||
      (item.diagramRequired === true && !isAssessmentDiagram(item.diagram)) ||
      (item.diagram !== undefined && (item.diagramRequired !== true || !isAssessmentDiagram(item.diagram))) ||
      !['benchmark', 'recent', 'readiness'].includes(item.role) ||
      typeof item.familyId !== 'string' ||
      typeof item.targetId !== 'string' ||
      !Array.isArray(item.sourceFactIds) ||
      !Array.isArray(item.options) ||
      item.options.length !== 3 ||
      new Set(item.options.map((o) => o.id)).size !== 3 ||
      !item.options.every(
        (o) => o && typeof o.id === 'string' && typeof o.text === 'string' && o.text.length > 0
      ) ||
      !item.options.some((o) => o.id === item.correctOptionId) ||
      ids.has(item.id) ||
      families.has(item.familyId) ||
      item.sourceFactIds.some((id) => facts.has(id))
    )
      return false;
    ids.add(item.id);
    families.add(item.familyId);
    item.sourceFactIds.forEach((id) => facts.add(id));
  }
  if (value.items.filter((i) => i.role === 'benchmark').length !== 6) return false;
  let lastTime = validTime(value.startedAt)!;
  const answered = new Set<string>();
  for (const answer of value.answers) {
    const item = value.items.find((item) => item.id === answer?.itemId);
    if (
      !answer || !item || answered.has(answer.itemId) ||
      !item.options.some((o) => o.id === answer.optionId) ||
      (answer.supportUsed !== undefined && !['none', 'read_aloud'].includes(answer.supportUsed))
    )
      return false;
    const time = validTime(answer.answeredAt);
    if (time === null || time < lastTime) return false;
    lastTime = time;
    answered.add(answer.itemId);
  }
  return true;
}
/** Corruption is a visible recovery error. It must never silently erase an unfinished quiz. */
export function decodeAssessmentData(raw: string | null, profileId: string): AssessmentData {
  if (raw === null) return emptyAssessmentData(profileId);
  let data: AssessmentData;
  try {
    data = JSON.parse(raw) as AssessmentData;
  } catch {
    throw new Error('Saved assessment data could not be read. It has been kept for recovery.');
  }
  const bad = () =>
    new Error(
      'Saved assessment data is incomplete or belongs to another profile. It has been kept for recovery.'
    );
  if (
    !data ||
    data.version !== 1 ||
    data.profileId !== profileId ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.exposures) ||
    typeof data.pendingStart !== 'boolean' ||
    !(data.lastObservedAt === null || validTime(data.lastObservedAt) !== null) ||
    !(data.pendingResultsId === null || typeof data.pendingResultsId === 'string') ||
    !(data.activeSession === null || validSession(data.activeSession, profileId, false))
  )
    throw bad();
  const sessionIds = new Set<string>();
  for (const result of data.history) {
    if (
      !result ||
      !validSession(result.session, profileId, true) ||
      validTime(result.completedAt) === null ||
      validTime(result.completedAt)! < validTime(result.session.answers[11]!.answeredAt)! ||
      sessionIds.has(result.session.id) ||
      (result.reporting !== undefined &&
        (!result.reporting ||
          typeof result.reporting.consentEpoch !== 'string' ||
          !/^[A-Za-z0-9_-]{16,80}$/.test(result.reporting.consentEpoch))) ||
      !Array.isArray(result.targetInsights)
    )
      throw bad();
    sessionIds.add(result.session.id);
    for (const [role, score] of [
      ['all', result.score],
      ['benchmark', result.benchmark],
      ['recent', result.recent],
      ['readiness', result.readiness],
    ] as const) {
      const rows = result.session.items
        .map((item) => ({ item, answer: result.session.answers.find((answer) => answer.itemId === item.id)! }))
        .filter((row) => role === 'all' || row.item.role === role);
      if (
        !score ||
        score.total !== rows.length ||
        score.correct !==
          rows.filter((row) => row.answer.optionId === row.item.correctOptionId).length
      )
        throw bad();
    }
  }
  if (data.activeSession && sessionIds.has(data.activeSession.id)) throw bad();
  if (data.pendingResultsId !== null && !sessionIds.has(data.pendingResultsId)) throw bad();
  for (const exposure of data.exposures) {
    if (
      !exposure ||
      typeof exposure.cardId !== 'string' ||
      typeof exposure.familyId !== 'string' ||
      !['en', 'tl', 'bis'].includes(exposure.language) ||
      !/^[a-f0-9]{64}$/.test(exposure.presentedTextSha256) ||
      exposure.knowledgePresented !== true ||
      validTime(exposure.at) === null
    )
      throw bad();
  }
  return data;
}
