import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { themeCss, THEME_COLOR } from '@/theme/css';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Tala', template: '%s · Tala' },
  description: 'Tala — lesson planning for teachers, by Hiraia.',
  icons: { icon: '/brand/favicon.svg' },
  applicationName: 'Tala',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: THEME_COLOR };

/** Server-rendered root: the theme variables are inlined from the token file so the first paint is on brand. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fil">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body className="bg-cream text-forest font-body">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
