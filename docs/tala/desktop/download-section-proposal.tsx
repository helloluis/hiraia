// Integration proposal only. Release owner places this under tala-web/features/landing
// and adds the reviewed download.desktop.* keys to both dictionaries.
'use client';
import { useT } from '@/i18n';

export interface DesktopManifest {
  schemaVersion: 1;
  status: 'released';
  version: string;
  release: string;
  sourceCommit: string;
  artifacts: {
    platform: 'win32' | 'darwin';
    arch: 'x64' | 'arm64';
    url: string;
    bytes: number;
    sha256: string;
  }[];
}

export function DesktopDownloads({ manifest }: { manifest: DesktopManifest | null }) {
  const { t } = useT();
  if (!manifest) return null; // Existing Android/web download flow remains intact.
  return (
    <section aria-labelledby="desktop-title" className="flex flex-col gap-4 border-t border-hairline pt-6">
      <h2 id="desktop-title" className="font-display text-[1.75rem]">{t('download.desktop.title')}</h2>
      <p>{t('download.desktop.online')}</p>
      <div className="grid gap-4">
        {manifest.artifacts.map(a => (
          <div key={`${a.platform}-${a.arch}`} className="rounded border border-hairline bg-white p-4">
            <a href={a.url} download className="inline-flex min-h-touch items-center text-talaTeal underline font-medium">
              {t(a.platform === 'win32' ? 'download.desktop.windows' : a.arch === 'arm64' ? 'download.desktop.macArm' : 'download.desktop.macIntel')}
              {' · '}{(a.bytes / 1048576).toFixed(1)} MB
            </a>
            <details className="text-small mt-2">
              <summary>{t('download.desktop.verify')}</summary>
              <p>{t('download.version')}: {manifest.version}</p>
              <p className="font-mono break-all">SHA256: {a.sha256}</p>
              <p className="font-mono break-all">{manifest.sourceCommit}</p>
            </details>
          </div>
        ))}
      </div>
      <p className="text-small">{t('download.desktop.unsigned')}</p>
      <p className="text-small">{t('download.desktop.windowsHelp')}</p>
      <p className="text-small">{t('download.desktop.macHelp')}</p>
      <p className="text-small">{t('download.desktop.updates')}</p>
    </section>
  );
}
