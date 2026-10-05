import type { Metadata } from 'next';

import { Competencies } from '@/components/Competencies';

import catalogue from '../../../public/competencies/ph-revised-k12.json';

export const metadata: Metadata = {
  title: 'Science competencies — Hiraia',
  description:
    'Explore the Philippine Revised K-12 Curriculum science competencies linked to Hiraia lessons, from Grade 3 through Grade 10. Browse by grade, term and topic.',
  alternates: { canonical: 'https://hiraia.org/competencies' },
  openGraph: {
    title: 'Science competencies — Hiraia',
    description:
      'The learning goals behind Hiraia’s Philippine science lessons, organized by grade and term.',
    url: 'https://hiraia.org/competencies',
    type: 'website',
  },
};

export default function CompetenciesPage() {
  return <Competencies catalogue={catalogue} />;
}
