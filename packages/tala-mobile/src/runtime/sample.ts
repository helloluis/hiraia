import { CurriculumPack } from '@hiraia/tala-core/contracts';
import type { GradeLevel } from '@hiraia/tala-core/contracts';
/** Fictional objectives solely for demonstrating pacing; never claimed as official curriculum. */
export function samplePack(grade: GradeLevel, language: 'fil' | 'en') {
  const text = language === 'fil' ? 'Halimbawang layunin' : 'Sample objective';
  return CurriculumPack.parse({
    packId: `sample:${grade}:science`,
    curriculumVersion: 'sample',
    grade,
    learningAreaId: 'science',
    schoolYears: [],
    competencyCount: 12,
    dataRevision: 1,
    bytes: 0,
    competencies: Array.from({ length: 12 }, (_, i) => ({
      id: `sample.science.g${grade}.t1.${i}`,
      code: null,
      learningAreaId: 'science',
      grade,
      termIndex: 1,
      sequence: i,
      text: `${text} ${i + 1}`,
      textLang: language,
      contentStandard: null,
      performanceStandard: null,
      domain: null,
      weight: null,
      weightSource: 'estimated',
      source: { document: 'Fictional sample data', edition: null, page: null, url: null },
    })),
  });
}
