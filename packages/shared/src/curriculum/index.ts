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
 * Based on DepEd K-12 Science curriculum.
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
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  9: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
  10: {
    1: 'matter',
    2: 'living_things',
    3: 'force_motion_energy',
    4: 'earth_space',
  },
};

/**
 * Domain display names in different languages.
 */
export const DOMAIN_NAMES: Record<ScienceDomain, Record<'english' | 'tagalog' | 'cebuano', string>> = {
  matter: {
    english: 'Matter',
    tagalog: 'Materia',
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
