import { create } from 'zustand';
import { getSetting, setSetting } from '../db/repo';
import { initializeProfiles, profileScope } from '../profiles';
import { createAssessmentController, initialAssessmentSnapshot } from './controller';
import { assessmentRegistry, ASSESSMENT_EVALUATION_ENABLED } from './registry';
import { assessmentStorageKey } from './storage';
import type { AnswerInput, AssessmentContext, AssessmentSnapshot, ExposureInput } from './types';
import { assessmentReportingPolicy, reportAssessmentHistory } from '../telemetry';

async function verifyProfile(profileId: string) {
  await initializeProfiles();
  if (profileScope() !== profileId)
    throw new Error('The active student profile changed. Reopen the app to continue.');
}
const controller = createAssessmentController({
  registry: assessmentRegistry,
  mode: ASSESSMENT_EVALUATION_ENABLED ? 'local_evaluation' : 'production',
  reportingPolicy: assessmentReportingPolicy,
  storage: {
    async load(profileId, mode) {
      await verifyProfile(profileId);
      return getSetting(assessmentStorageKey(profileId, mode));
    },
    async save(profileId, serialized, mode) {
      await verifyProfile(profileId);
      await setSetting(assessmentStorageKey(profileId, mode), serialized);
    },
  },
});
type AssessmentStore = AssessmentSnapshot & {
  hydrate(context: AssessmentContext): Promise<void>;
  begin(context: AssessmentContext): Promise<void>;
  requestStart(context: AssessmentContext): Promise<void>;
  answer(input: AnswerInput): Promise<void>;
  dismissResults(): Promise<void>;
  recordExposure(input: ExposureInput): Promise<void>;
  retry(): Promise<void>;
  dismissError(): Promise<void>;
  cancelStart(): Promise<void>;
};
export const useAssessmentStore = create<AssessmentStore>(() => ({
  ...initialAssessmentSnapshot,
  hydrate: controller.hydrate,
  begin: controller.begin,
  requestStart: controller.requestStart,
  answer: controller.answer,
  dismissResults: controller.dismissResults,
  recordExposure: controller.recordExposure,
  retry: controller.retry,
  dismissError: controller.dismissError,
  cancelStart: controller.cancelStart,
}));
controller.subscribe(() => {
  const snapshot = controller.getSnapshot();
  useAssessmentStore.setState(snapshot);
  reportAssessmentHistory(snapshot.history);
});
export { ASSESSMENT_EVALUATION_ENABLED } from './registry';
export type {
  AssessmentSession,
  AssessmentQuestion,
  AssessmentResult,
  AssessmentContext,
} from './types';
