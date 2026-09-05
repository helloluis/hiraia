import { newId, track, trackMany } from './index';
// One logical quiz attempt per displayed page, shared by visibility and grading hooks.
let quiz: { key: number; id: string; shown: boolean; graded: boolean } | undefined;
function attempt(key: number) {
  if (!quiz || quiz.key !== key) quiz = { key, id: newId(), shown: false, graded: false };
  return quiz;
}
export function showQuiz(key: number, questionId: string, language: string) {
  const q = attempt(key);
  if (q.shown) return;
  q.shown = true;
  track('quiz_shown', { attempt_id: q.id, question_id: questionId, language });
}
export function gradeQuiz(key: number, questionId: string, language: string, correct: boolean) {
  const q = attempt(key);
  if (q.graded) return;
  showQuiz(key, questionId, language);
  q.graded = true;
  const props = { attempt_id: q.id, question_id: questionId, language };
  trackMany([
    { name: 'quiz_answer_submitted', props, id: `${q.id}_submitted` },
    { name: 'quiz_graded', props: { ...props, correct }, id: `${q.id}_graded` },
  ]);
}
let lastPage: number | undefined;
export function viewCard(
  key: number,
  source: 'curated' | 'generated',
  language: string,
  cardId?: string
) {
  if (key === lastPage) return;
  lastPage = key;
  track('card_viewed', {
    view_id: newId(),
    source,
    language,
    ...(cardId ? { card_id: cardId } : {}),
  });
}
