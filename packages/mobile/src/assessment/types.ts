export type AssessmentLanguage = 'en' | 'tl' | 'bis';
export type LanguageInput = AssessmentLanguage | 'english' | 'tagalog' | 'bisaya' | 'cebuano';
export type AdmissionMode = 'local_evaluation' | 'production';
export type Trilingual = Record<AssessmentLanguage, string>;
export type AssessmentRole = 'benchmark' | 'recent' | 'readiness';
/** Offline scene data is frozen with the question, like its text and answer order. */
export interface AssessmentDiagram {
  kind: 'ball_box';
  relation: 'above' | 'below' | 'left' | 'right' | 'inside' | 'on';
}

export interface AssessmentContext {
  profileId: string;
  grade: number;
  language: LanguageInput;
  confirmedPriorCurricula?: { grade: number; curriculumVersion: string }[];
  teacherCoveredTargets?: string[];
}
export interface TeachingLink {
  cardId: string;
  familyId: string;
  hashes: Trilingual;
}
export interface BankItem {
  id: string;
  revision: number;
  batchId: string;
  status: string;
  productionReady: boolean;
  grade: number;
  domain: string;
  targetId: string;
  claim: string;
  claimLimit: string;
  curriculumVersion: string;
  familyId: string;
  sourceFactIds: string[];
  teachingLinks: TeachingLink[];
  content: {
    stem: Trilingual;
    options: { id: string; text: Trilingual }[];
    correct_option_id: string;
    explanation: Trilingual;
    diagram?: AssessmentDiagram;
  };
  scope: Record<string, unknown>;
  review: Record<string, unknown>;
  relationships: Record<string, unknown>;
  eligibility: Record<string, unknown>;
  demand: Record<string, unknown>;
}
export interface Blueprint {
  id: string;
  revision: string;
  student_grade: number;
  material_grade: number;
  foundation_scope_id?: string;
  foundation_item_ids?: string[];
  curriculum_cohort_verified: boolean;
  status: string;
  baseline_domain_counts: Record<string, number>;
  baseline_example_item_ids: string[];
  baseline_benchmark_item_ids: Record<string, string>;
  baseline_readiness_probe_ids: string[];
  benchmark_slots: { id: string; construct: string; candidate_item_ids: string[] }[];
  notes: string[];
}
export interface AssessmentRegistry {
  schemaVersion: 1;
  inputHash: string;
  authoredAt: string;
  sourceHashes: Record<string, string>;
  productionEnabled: boolean;
  authoringItemCount: number;
  excluded: { id: string; status: string; holds: unknown[] }[];
  items: BankItem[];
  blueprints: Blueprint[];
  reviewNotice: string;
}
export interface AssessmentExposure {
  cardId: string;
  language: AssessmentLanguage;
  familyId: string;
  presentedTextSha256: string;
  at: string;
  knowledgePresented: true;
}
export interface ExposureInput {
  cardId: string;
  language: LanguageInput;
  exactRenderedBody: string;
  timestamp?: string | number;
}
export interface AssessmentQuestion {
  id: string;
  itemId: string;
  revision: number;
  stem: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
  diagram?: AssessmentDiagram;
  diagramRequired?: true;
  role: AssessmentRole;
  benchmarkSlotId: string | null;
  domain: string;
  targetId: string;
  claim: string;
  claimLimit: string;
  familyId: string;
  sourceFactIds: string[];
  productionReady: boolean;
  review: Record<string, unknown>;
}
export interface AssessmentAnswer {
  itemId: string;
  optionId: string;
  answeredAt: string;
  supportUsed?: 'none' | 'read_aloud';
}
export interface AssessmentSession {
  id: string;
  profileId: string;
  grade: number;
  language: AssessmentLanguage;
  startedAt: string;
  seed: string;
  admissionMode: AdmissionMode;
  curriculumMatch: 'unverified' | 'confirmed';
  comparisonLabel: 'Hiraia-only';
  clockTrust: 'device_time_unverified';
  blueprintId: string;
  blueprintRevision: string;
  registryInputHash: string;
  comparisonKey: string;
  kind: 'baseline' | 'followup';
  exactRepeats: number;
  items: AssessmentQuestion[];
  answers: AssessmentAnswer[];
}
export interface Score {
  correct: number;
  total: number;
}
export interface AssessmentResult {
  session: AssessmentSession;
  completedAt: string;
  score: Score;
  benchmark: Score;
  recent: Score;
  readiness: Score;
  targetInsights: {
    targetId: string;
    correct: number;
    total: number;
    recommendation: 'recheck' | 'reinforce' | 'remembered';
  }[];
  comparison: null | { previousCompletedAt: string; benchmarkDifference: number };
  /** Consent at completion. Missing on older/local-only attempts: never retrospectively upload. */
  reporting?: { consentEpoch: string };
}
export interface AssessmentData {
  version: 1;
  profileId: string;
  activeSession: AssessmentSession | null;
  history: AssessmentResult[];
  exposures: AssessmentExposure[];
  pendingStart: boolean;
  pendingResultsId: string | null;
  lastObservedAt: string | null;
}
export interface AnswerInput {
  sessionId: string;
  itemId: string;
  optionId: string;
  supportUsed?: 'none' | 'read_aloud';
}
export interface AssessmentSnapshot {
  loaded: boolean;
  busy: boolean;
  error: string;
  activeSession: AssessmentSession | null;
  results: AssessmentResult | null;
  history: AssessmentResult[];
  completed: number;
  due: boolean;
  needsBaseline: boolean;
  eligible: boolean;
  unavailableReason: string;
}
