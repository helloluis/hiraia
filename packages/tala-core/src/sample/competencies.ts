import { Competency } from '../contracts/curriculum';
import type { GradeLevel } from '../contracts/common';

export const SAMPLE_CURRICULUM_VERSION = 'fixture-demo-v1';
/** Synthetic, openly labelled reference data, bundled so the sample works offline. */
export function buildSampleCompetencies(
  grade: GradeLevel,
  termIndices: readonly number[] = [1, 2, 3]
): Competency[] {
  return [...new Set(termIndices)]
    .sort((a, b) => a - b)
    .flatMap((termIndex) =>
      ['Objects', 'Living things', 'Movement', 'Our surroundings'].map((domain, i) =>
        Competency.parse({
          id: `${SAMPLE_CURRICULUM_VERSION}.mathematics.g${grade}.t${termIndex}.${i + 1}`,
          code: null,
          learningAreaId: 'mathematics',
          grade,
          termIndex,
          sequence: i + 1,
          text: `SAMPLE DATA ONLY — Grade ${grade}: describe and compare a small collection of ${domain.toLowerCase()}.`,
          textLang: 'en',
          contentStandard: null,
          performanceStandard: null,
          domain,
          shortTitle: `Sample ${domain.toLowerCase()}`,
          shortTitleSource: 'derived',
          weight: null,
          weightSource: 'estimated',
          source: {
            document: 'Synthetic Tala demo fixture; NOT a DepEd competency',
            edition: 'fixture-v1',
            page: null,
            url: null,
          },
        })
      )
    );
}
