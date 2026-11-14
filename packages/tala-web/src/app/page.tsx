import { LandingPage } from '@/features/landing/LandingPage';

export const metadata = {
  title: 'Tala — lesson planning for teachers, by Hiraia',
  description:
    'Free lesson planning for Filipino teachers: curriculum-aware pacing, AI drafts you check and lock, PDFs, and an Android app that works offline.',
};

/** Public homepage (server-rendered shell; the signed-in CTA swaps in on the client). */
export default function Home() {
  return <LandingPage />;
}
