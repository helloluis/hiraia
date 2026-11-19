'use client';
/**
 * Public homepage at `/`. Hero in hiraia.org's proportions: a near-full-viewport photograph with the headline card
 * laid over it (card on the right because the teacher stands left of centre), then a screenshot carousel, short
 * feature headlines, Our Promise, and one get-started card. Strings only; no literal colours.
 */
import Link from 'next/link';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { LinkButton } from '@/components/ui';
import { Carousel, type Screen } from './Carousel';
import { Feature, PublicShell } from './PublicShell';

// The library is an early preview (a few sample weeks), so it follows the features teachers can rely on today.
const FEATURES = ['pacing', 'ai', 'roster', 'edit', 'offline', 'community', 'library'] as const;
const PROMISES = ['free', 'offline', 'simple', 'check'] as const;
export const SCREENS: Screen[] = [
  { name: 'week-phone', w: 786, h: 1704, captionKey: 'landing.c.week', kind: 'phone' },
  { name: 'editor-phone', w: 786, h: 1704, captionKey: 'landing.c.editor', kind: 'phone' },
  { name: 'draft-phone', w: 786, h: 1704, captionKey: 'landing.c.draft', kind: 'phone' },
  { name: 'roster-phone', w: 786, h: 1704, captionKey: 'landing.c.roster', kind: 'phone' },
  { name: 'print-phone', w: 786, h: 1704, captionKey: 'landing.c.print', kind: 'phone' },
  { name: 'community-phone', w: 786, h: 1704, captionKey: 'landing.c.community', kind: 'phone' },
  { name: 'week-desktop', w: 1200, h: 750, captionKey: 'landing.c.desktop', kind: 'desktop' },
];

export function LandingPage() {
  const { t } = useT();
  const { status } = useSession();
  const signedIn = status === 'signedIn';
  return (
    <PublicShell overlayHeader>
      {/* HERO — the photograph is the hero, as on hiraia.org: full width, near full viewport, card laid over it. */}
      <section
        className="relative h-[80svh] min-h-[520px] flex items-end wide:items-center overflow-hidden bg-forest"
        aria-label="Tala"
      >
        <picture className="absolute inset-0" aria-hidden="true">
          <source
            media="(max-width: 839px)"
            type="image/webp"
            srcSet="/brand/tala-hero-teacher-mobile.webp"
          />
          <source
            media="(max-width: 839px)"
            type="image/jpeg"
            srcSet="/brand/tala-hero-teacher-mobile.jpg"
          />
          <source
            type="image/webp"
            srcSet="/brand/tala-hero-teacher.webp 1600w, /brand/tala-hero-teacher-wide.webp 2400w"
            sizes="100vw"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/tala-hero-teacher.jpg"
            srcSet="/brand/tala-hero-teacher.jpg 1600w, /brand/tala-hero-teacher-wide.jpg 2400w"
            sizes="100vw"
            alt={t('landing.heroAlt')}
            width={1600}
            height={883}
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover object-[45%_25%] wide:object-[42%_35%]"
          />
        </picture>
        {/* soft fade so the card and the page below read cleanly on phones */}
        <div
          className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-forest/70 to-transparent wide:hidden"
          aria-hidden="true"
        />
        <div className="relative z-10 w-full px-4 pb-12 wide:pb-0 wide:px-8 wide:flex wide:justify-end">
          <div className="mx-auto wide:mx-0 w-full max-w-[26rem] rounded-[1.125rem] border-[3px] border-forest bg-cream p-5 shadow-[0_8px_0_rgba(28,59,46,0.55)] flex flex-col gap-4">
            <h1 className="font-display text-[2rem] leading-[1.1] wide:text-[2.5rem] break-words [overflow-wrap:anywhere] text-balance">
              {t('landing.h1')}
            </h1>
            <p className="text-body leading-relaxed">{t('landing.sub')}</p>
            <div className="flex flex-col gap-3">
              {signedIn ? (
                <LinkButton href="/week" variant="primary" full>
                  {t('landing.openWeek')}
                </LinkButton>
              ) : (
                <>
                  <LinkButton href="/register" variant="primary" full>
                    {t('landing.register')}
                  </LinkButton>
                  <LinkButton href="/sign-in" full>
                    {t('landing.login')}
                  </LinkButton>
                </>
              )}
              <LinkButton href="/library" full>
                {t('landing.openLibrary')}
              </LinkButton>
              <Link
                href="/download"
                className="inline-flex items-center justify-center min-h-touch px-2 text-talaTealText underline underline-offset-4"
              >
                {t('landing.download')} →
              </Link>
            </div>
          </div>
        </div>
        <a
          href="#screens"
          aria-label={t('landing.scrollCue')}
          className="absolute bottom-0.5 right-3 wide:bottom-2 wide:right-auto wide:left-1/2 wide:-translate-x-1/2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-cream text-forest shadow-[0_2px_8px_rgba(28,59,46,0.25)]"
        >
          <span aria-hidden="true" className="text-[1.25rem] leading-none">
            ⌄
          </span>
        </a>
      </section>

      {/* SCREENS */}
      <section id="screens" className="px-4 py-12 wide:px-8 wide:py-16 scroll-mt-4">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem] break-words [overflow-wrap:anywhere]">
            {t('landing.todayTitle')}
          </h2>
          <Carousel screens={SCREENS} />
        </div>
      </section>

      {/* FEATURES — strong headlines, one or two sentences */}
      <section className="px-4 pb-12 wide:px-8 wide:pb-16">
        <div className="mx-auto max-w-6xl grid gap-4 wide:grid-cols-3">
          {FEATURES.map((f) => (
            <Feature
              key={f}
              kicker={t(`landing.f.${f}.k`)}
              body={t(`landing.f.${f}.b`)}
              badge={f === 'community' ? t('landing.beta') : undefined}
            />
          ))}
        </div>
      </section>

      {/* OUR PROMISE */}
      <section className="px-4 py-12 wide:px-8 wide:py-16 bg-forest text-cream">
        <div className="mx-auto max-w-6xl flex flex-col gap-6">
          <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem]">
            {t('landing.promiseTitle')}
          </h2>
          <div className="grid gap-6 wide:grid-cols-4">
            {PROMISES.map((p) => (
              <Feature key={p} onDark kicker={t(`landing.p.${p}.k`)} body={t(`landing.p.${p}.b`)} />
            ))}
          </div>
          <p className="text-cream/80">{t('landing.early')}</p>
        </div>
      </section>

      {/* GET STARTED */}
      <section className="px-4 py-12 wide:px-8 wide:py-16">
        <div className="mx-auto max-w-5xl rounded-[1.25rem] bg-white border border-hairline p-6 wide:p-10 flex flex-col gap-4">
          <h2 className="font-display text-[1.75rem] leading-tight wide:text-[2.25rem] break-words [overflow-wrap:anywhere]">
            {t('landing.getTitle')}
          </h2>
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
