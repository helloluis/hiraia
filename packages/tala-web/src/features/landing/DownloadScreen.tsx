'use client';
/** `/download`: facts from the deploy's manifest (never a hard-coded version) and the plain-words install note. */
import { formatDate, useT } from '@/i18n';
import { Banner, LinkButton } from '@/components/ui';
import { PublicShell } from './PublicShell';

export interface ApkManifest {
  file: string;
  version: string;
  versionCode: number;
  buildDate: string;
  sha256: string;
  bytes: number;
  minAndroid: string;
  applicationId: string;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DownloadScreen({ manifest }: { manifest: ApkManifest | null }) {
  const { t, lang } = useT();
  return (
    <PublicShell>
      <section className="px-4 py-10 wide:px-8 wide:py-16">
        <div className="mx-auto max-w-3xl flex flex-col gap-6">
          <h1 className="font-display text-[2rem] leading-tight wide:text-[2.75rem] break-words [overflow-wrap:anywhere]">
            {t('download.title')}
          </h1>
          <p className="text-[1.0625rem] leading-relaxed">{t('download.intro')}</p>
          {manifest ? (
            <>
              <a
                href={manifest.file}
                download
                className="inline-flex items-center justify-center min-h-touch px-5 py-3 rounded bg-talaTeal text-white font-medium text-[1.0625rem] self-start"
              >
                {t('download.button', { size: mb(manifest.bytes) })}
              </a>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded border border-hairline bg-white p-4 text-body">
                <dt className="text-forestMuted">{t('download.version')}</dt>
                <dd>
                  {manifest.version} ({manifest.versionCode})
                </dd>
                <dt className="text-forestMuted">{t('download.buildDate')}</dt>
                <dd>
                  {formatDate(manifest.buildDate.slice(0, 10), lang, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </dd>
                <dt className="text-forestMuted">{t('download.size')}</dt>
                <dd>{mb(manifest.bytes)}</dd>
                <dt className="text-forestMuted">{t('download.minAndroid')}</dt>
                <dd>{manifest.minAndroid}</dd>
                <dt className="text-forestMuted">{t('download.sha')}</dt>
                <dd className="font-mono text-small break-all">{manifest.sha256}</dd>
              </dl>
              <section className="rounded border-l-4 border-talaTeal border bg-white p-4 flex flex-col gap-2">
                <h2 className="font-medium">{t('download.installTitle')}</h2>
                <p>{t('download.installBody')}</p>
                <p className="text-small text-forestMuted">{t('download.verify')}</p>
              </section>
            </>
          ) : (
            <Banner
              kind="info"
              action={<LinkButton href="/register">{t('download.useWeb')}</LinkButton>}
            >
              {t('download.notYet')}
            </Banner>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
