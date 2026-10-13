import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Home from '../../page';

export const metadata: Metadata = {
  title: 'Hiraia · Homepage preview',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default function HomepagePreview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <Home />;
}
