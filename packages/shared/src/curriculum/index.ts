import type { GradeLevel } from '../types/index.js';

/**
 * Science domains in the DepEd K-12 curriculum.
 */
export type ScienceDomain = 'matter' | 'living_things' | 'force_motion_energy' | 'earth_space' | 'environment';

/**
 * Represents a quarter in the school year.
 */
export type Quarter = 1 | 2 | 3 | 4;

/**
 * A specific learning competency from the DepEd curriculum.
 */
export interface LearningCompetency {
  code: string;
  description: string;
  gradeLevel: GradeLevel;
  quarter: Quarter;
  domain: ScienceDomain;
}

/**
 * A topic or concept within a domain.
 */
export interface CurriculumTopic {
  id: string;
  title: string;
  description: string;
  gradeLevel: GradeLevel;
  quarter: Quarter;
  domain: ScienceDomain;
  competencies: LearningCompetency[];
  keywords: string[];
}

/**
 * Mapping of grade levels to their primary domains per quarter.
 * MATATAG Science CG (DepEd 2023), one domain per quarter. Grades 3–7 run
 * Matter → Living Things → Force/Motion/Energy → Earth & Space; from Grade 8 the
 * order ROTATES per grade (CG p.27: G8 opens with Life Science, G9 with Force,
 * Motion & Energy, G10 with Earth & Space). Source: rag/sources/curriculum-guides/
 * FINAL-MATATAG-Science-CG-2023-Grades-3-10.pdf, JHS tables pp.46–67.
 */
export const GRADE_DOMAIN_MAP: Record<GradeLevel, Record<Quarter, ScienceDomain>> = {
  3: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  4: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  5: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  6: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  7: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  8: {
    1: 'living_things',
    2: 'matter',
    3: 'earth_space',
    4: 'force_motion_energy',
  },
  9: {
    1: 'force_motion_energy',
    2: 'earth_space',
    3: 'living_things',
    4: 'matter',
  },
  10: {
    1: 'earth_space',
    2: 'force_motion_energy',
    3: 'matter',
    4: 'living_things',
  },
};

/**
 * Domain display names in different languages.
 */
export const DOMAIN_NAMES: Record<ScienceDomain, Record<'english' | 'tagalog' | 'cebuano', string>> = {
  matter: {
    english: 'Matter',
    // "Matter" in all three: DepEd's Filipino and Cebuano science materials keep the English
    // term (the Cebuano bank: matter 373 vs materya 26). Luis, 2026-09-05.
    tagalog: 'Matter',
    cebuano: 'Matter',
  },
  living_things: {
    english: 'Living Things',
    tagalog: 'Mga Buhay na Bagay',
    cebuano: 'Mga Buhing Butang',
  },
  force_motion_energy: {
    english: 'Force, Motion, and Energy',
    tagalog: 'Puwersa, Galaw, at Enerhiya',
    cebuano: 'Kusog, Lihok, ug Enerhiya',
  },
  earth_space: {
    english: 'Earth and Space',
    tagalog: 'Lupa at Kalawakan',
    cebuano: 'Yuta ug Kalangitan',
  },
  environment: {
    english: 'Environment',
    tagalog: 'Kapaligiran',
    cebuano: 'Kalikupan',
  },
};

/**
 * Get the current domain for a grade level and quarter.
 */
export function getCurrentDomain(gradeLevel: GradeLevel, quarter: Quarter): ScienceDomain {
  return GRADE_DOMAIN_MAP[gradeLevel][quarter];
}

/**
 * Get domain name in the specified language.
 */
export function getDomainName(domain: ScienceDomain, language: 'english' | 'tagalog' | 'cebuano'): string {
  return DOMAIN_NAMES[domain][language];
}

export * from './feedWeighting.js';
