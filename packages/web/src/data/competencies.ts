/** Public content mapping. Card counts show resources, not evidence of mastery. */
export interface Competency {
  code: string;
  text: string;
  cardCount: number;
  questionCount: number;
  focuses: string[];
}

export interface CompetencyTopic {
  key: string;
  quarter: number;
  title: { en: string; tl: string; bis: string };
  cardCount: number;
  questionCount: number;
  competencies: Competency[];
}

export interface CompetencyGrade {
  grade: number;
  topicCount: number;
  competencyCount: number;
  quarters: { quarter: number; domain: string; topics: CompetencyTopic[] }[];
}

export interface CompetencyCatalogue {
  country: string;
  source: { title: string; edition: string; url: string; identifiers: string };
  counts: {
    grades: number;
    topics: number;
    mappedCompetencies: number;
    referenceCompetencies: number;
  };
  grades: CompetencyGrade[];
}

export function topicMatches(topic: CompetencyTopic, query: string): boolean {
  const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    ...Object.values(topic.title),
    ...topic.competencies.flatMap((competency) => [
      competency.code,
      competency.text,
      ...competency.focuses,
    ]),
  ]
    .join(' ')
    .toLocaleLowerCase('en');
  return words.every((word) => text.includes(word));
}
