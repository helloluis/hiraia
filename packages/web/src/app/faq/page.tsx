import type { Metadata } from 'next';
import { Faq } from '@/components/Faq';
import { FAQ_ITEMS } from '@/data/faq';

export const metadata: Metadata = {
  title: 'Questions — Hiraia',
  description:
    'How to use Hiraia, which Android phones it runs on, what MATATAG science is in the tutor, and how to fix a stuck download.',
};

export default function FaqPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a.join(' ') },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Faq />
    </>
  );
}
