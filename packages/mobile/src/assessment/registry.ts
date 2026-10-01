import generated from './bank.generated.json';
import type { AssessmentRegistry } from './types';

export const assessmentRegistry = generated as unknown as AssessmentRegistry;
// Public, optional practice preview requested 30 September 2026. This is a JS feature,
// so existing signed runtimes can receive it by OTA. It does not promote draft bank
// items, remove their holds, or claim teacher/language/curriculum approval.
export const ASSESSMENT_PUBLIC_PREVIEW_ENABLED = true;
export const ASSESSMENT_EVALUATION_ENABLED = ASSESSMENT_PUBLIC_PREVIEW_ENABLED
  || process.env.EXPO_PUBLIC_ASSESSMENT_EVALUATION === '1';
