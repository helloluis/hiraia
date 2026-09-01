export {
  generateSystemPrompt,
  generateVisualPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from './system.js';
// The dynamic-card prompt: shared by the phone (LocalEngine.answerQuery) and the web demo's
// /api/demo/card route so both print the same card. See ./cards.ts.
export {
  buildCardPrompt,
  sanitizeCardAnswer,
  CARD_TEMP,
  CARD_MAX_CHARS,
  CARD_STOP,
  CARD_REASONING_BUDGET,
} from './cards.js';
export type { CardPromptInput, CardPromptLanguage } from './cards.js';
