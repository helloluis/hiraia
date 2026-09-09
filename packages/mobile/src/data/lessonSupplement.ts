import grade9 from './grade9LessonSupplement.json';
import grade10 from './grade10LessonSupplement.json';
import grade8 from './grade8LessonSupplement.json';
import grade7 from './grade7LessonSupplement.json';
import grade6 from './grade6LessonSupplement.json';
import grade4 from './grade4LessonSupplement.json';
import grade3 from './grade3LessonSupplement.json';
import grade5 from './grade5LessonSupplement.json';
export const supplement = {
  cards: [
    ...grade3.cards,
    ...grade4.cards,
    ...grade5.cards,
    ...grade6.cards,
    ...grade7.cards,
    ...grade8.cards,
    ...grade9.cards,
    ...grade10.cards,
  ],
  questions: {
    ...grade3.questions,
    ...grade4.questions,
    ...grade5.questions,
    ...grade6.questions,
    ...grade7.questions,
    ...grade8.questions,
    ...grade9.questions,
    ...grade10.questions,
  },
  competencies: {
    ...grade3.competencies,
    ...grade4.competencies,
    ...grade5.competencies,
    ...grade6.competencies,
    ...grade7.competencies,
    ...grade8.competencies,
    ...grade9.competencies,
    ...grade10.competencies,
  },
};
