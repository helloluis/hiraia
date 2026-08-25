import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hiraia — an AI science tutor that runs entirely offline',
  description:
    'On-device AI for Filipino students. Works on entry-level Android phones and speaks Tagalog and English.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
