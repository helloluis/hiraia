import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hiraia - AI Science Tutor',
  description: 'Offline-capable AI tutor for Filipino students learning science',
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
