'use client';
/**
 * Public homepage at `/` in the hiraia.org pattern: eyebrow, big serif headline, two-line sub, CTAs, hero art;
 * then honest sections for what Tala does today, the promises, and how to get started. Strings only; no literal colours.
 */
import Link from 'next/link';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { LinkButton } from '@/components/ui';
import { Eyebrow, Feature, PublicShell } from './PublicShell';

const FEATURES = ['account', 'roster', 'pacing', 'ai', 'edit', 'offline', 'community'] as const;
const PROMISES = ['free', 'offline', 'simple', 'check'] as const;

export function LandingPage() {
  const { t } = useT();
  const { status } = useSession();
  const signedIn = status === 'signedIn';
  return (
    <PublicShell>
      {/* HERO */}
      <section className="px-4 pt-6 pb-12 wide:px-8 wide:pt-12 wide:pb-16">
        <div className="mx-auto max-w-6xl grid gap-8 items-center wide:grid-cols-[1.1fr_1fr] wide:gap-12">
          <div className="flex flex-col gap-5 min-w-0">
            <Eyebrow>{t('landing.eyebrow')}</Eyebrow>
            <h1 className="font-display text-[2.25rem] leading-[1.1] wide:text-[3.25rem] break-words [overflow-wrap:anywhere] text-balance">
              {t('landing.h1')}
            </h1>
            <p className="text-[1.125rem] leading-relaxed text-forestMuted max-w-[36rem]">
              {t('landing.sub')}
            </p>
            <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap">
              {signedIn ? (
                <LinkButton href="/week" variant="primary">
                  {t('landing.openWeek')}
                </LinkButton>
              ) : (
                <>
                  <LinkButton href="/register" variant="primary">
                    {t('landing.register')}
                  </LinkButton>
                  <LinkButton href="/sign-in">{t('landing.login')}</LinkButton>
                </>
              )}
              <Link
                href="/download"
                className="inline-flex items-center min-h-touch px-2 text-talaTealText underline underline-offset-4"
              >
                {t('landing.download')} →
              </Link>
            </div>
          </div>
          <figure className="rounded-[1.25rem] overflow-hidden border border-hairline bg-white shadow-[0_10px_30px_rgba(28,59,46,0.10)]">
            <picture>
              <source
                media="(max-width: 639px)"
                type="image/webp"
                srcSet="/brand/tala-hero-teacher-mobile.webp"
              />
              <source
                media="(max-width: 639px)"
                type="image/jpeg"
                srcSet="/brand/tala-hero-teacher-mobile.jpg"
              />
              <source type="image/webp" srcSet="/brand/tala-hero-teacher.webp" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/tala-hero-teacher.jpg"
                alt={t('landing.heroAlt')}
                width={1344}
                height={768}
                className="block w-full h-auto"
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </figure>
        </div>
      </section>

      {/* EARLY VERSION, HONESTLY */}
      <section className="px-4 py-12 wide:px-8 wide:py-16 bg-white border-y border-hairline">
        <div className="mx-auto max-w-5xl flex flex-col gap-4">
          <Eyebrow>{t('landing.earlyEyebrow')}</Eyebrow>
          <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem] break-words [overflow-wrap:anywhere]">
            {t('landing.earlyTitle')}
          </h2>
          <p className="text-[1.0625rem] leading-relaxed max-w-[44rem]">{t('landing.earlyBody')}</p>
        </div>
      </section>

      {/* WHAT TALA DOES TODAY */}
      <section className="px-4 py-12 wide:px-8 wide:py-16">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Eyebrow>{t('landing.todayEyebrow')}</Eyebrow>
            <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem] max-w-[36rem] break-words [overflow-wrap:anywhere]">
              {t('landing.todayTitle')}
            </h2>
          </div>
          <div className="grid gap-4 wide:grid-cols-3">
            {FEATURES.map((f) => (
              <Feature
                key={f}
                kicker={t(`landing.f.${f}.k`)}
                body={t(`landing.f.${f}.b`)}
                badge={f === 'community' ? t('landing.beta') : undefined}
              />
            ))}
          </div>
        </div>
      </section>

      {/* PROMISES — forest band with yellow eyebrows, as hiraia.org's board sections */}
      <section className="px-4 py-12 wide:px-8 wide:py-16 bg-forest text-cream">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <Eyebrow onDark>{t('landing.promiseEyebrow')}</Eyebrow>
          <div className="grid gap-6 wide:grid-cols-4">
            {PROMISES.map((p) => (
              <Feature key={p} onDark kicker={t(`landing.p.${p}.k`)} body={t(`landing.p.${p}.b`)} />
            ))}
          </div>
        </div>
      </section>

      {/* GET STARTED */}
      <section className="px-4 py-12 wide:px-8 wide:py-16">
        <div className="mx-auto max-w-5xl rounded-[1.25rem] bg-white border border-hairline p-6 wide:p-10 flex flex-col gap-4">
          <Eyebrow>{t('landing.getEyebrow')}</Eyebrow>
          <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem] break-words [overflow-wrap:anywhere]">
            {t('landing.getTitle')}
          </h2>
          <p className="text-[1.0625rem] leading-relaxed max-w-[40rem]">{t('landing.getBody')}</p>
          <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap pt-2">
            <LinkButton href={signedIn ? '/week' : '/register'} variant="primary">
              {signedIn ? t('landing.openWeek') : t('landing.register')}
            </LinkButton>
            <LinkButton href="/download">{t('landing.download')}</LinkButton>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
