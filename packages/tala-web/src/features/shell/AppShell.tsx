'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { HiraiaGlyph, TalaWordmark } from '@/components/Brand';
import { cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { NetworkBanner } from './NetworkBanner';
import { SyncIndicator } from './SyncIndicator';
import { GenerationRunner } from '@/features/generate/GenerationRunner';

/** Phone bottom bar: at most four destinations (SIMPLE-9). Community is reached from the Library page. */
const NAV = [
  { href: '/week', key: 'nav.week', icon: 'calendar' },
  { href: '/library', key: 'nav.library', icon: 'book' },
  { href: '/lessons', key: 'nav.lessons', icon: 'lessons' },
  { href: '/class', key: 'nav.class', icon: 'school' },
] as const satisfies ReadonlyArray<{ href: string; key: string; icon: IconName }>;
/** Wide screens have room for Community in the side rail as well. */
const RAIL = [...NAV.slice(0, 3), { href: '/community', key: 'nav.community', icon: 'users' }, NAV[3]] as const;

/** `wide`: reading pages (library, packs, my slides) get a wider column for a magazine layout with a side rail. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { t } = useT();
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  // No cached account on this device → sign in. A lapsed session with saved data stays readable (rung 4).
  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);

  // The sticky Session Flow bar sits below the phone header: measure it, never hard-code it.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    const apply = () =>
      document.documentElement.style.setProperty(
        '--header-h',
        `${el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect().height : 0}px`
      );
    apply();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  });
  const isPrint = pathname?.endsWith('/print');
  if (isPrint) return <>{children}</>;

  return (
    <div className="min-h-dvh flex flex-col wide:flex-row">
      <GenerationRunner />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded"
      >
        {t('app.skipToContent')}
      </a>
      {/* Wide screens: left rail. Phones: top bar + bottom nav. */}
      <aside className="no-print hidden wide:flex wide:flex-col wide:w-60 wide:shrink-0 wide:border-r wide:border-hairline wide:bg-white wide:min-h-dvh wide:sticky wide:top-0 wide:self-start">
        <div className="flex items-center gap-2 px-4 py-4">
          <HiraiaGlyph size={26} />
          <TalaWordmark height={22} />
        </div>
        <nav aria-label={t('nav.main')} className="flex flex-col px-2">
          {RAIL.map((n) => (
            <NavLink
              key={n.href}
              href={n.href}
              label={t(n.key)}
              icon={n.icon}
              active={pathname?.startsWith(n.href) ?? false}
            />
          ))}
        </nav>
        <div className="mt-auto px-2 pb-4 flex flex-col gap-2">
          <NavLink
            href="/settings"
            label={t('nav.settings')}
            icon="settings"
            active={pathname?.startsWith('/settings') ?? false}
          />
          <SyncIndicator />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          ref={headerRef}
          className="no-print wide:hidden flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-hairline sticky top-0 z-30"
        >
          <Link href="/week" className="flex items-center gap-2 min-h-touch">
            <HiraiaGlyph size={24} />
            <TalaWordmark height={20} />
          </Link>
          <div className="flex items-center gap-1">
            <SyncIndicator compact />
            <Link
              href="/settings"
              className={cx(
                'flex flex-col items-center justify-center min-h-touch min-w-touch px-2 rounded text-small',
                pathname?.startsWith('/settings') ? 'text-talaTeal font-medium' : 'text-forest'
              )}
              aria-current={pathname?.startsWith('/settings') ? 'page' : undefined}
            >
              <Icon name="settings" size={22} />
              <span>{t('nav.settings')}</span>
            </Link>
          </div>
        </header>
        <NetworkBanner />
        <main
          id="main"
          className={cx('flex-1 w-full mx-auto px-4 py-5 wide:px-8 pb-24 wide:pb-10', wide ? 'max-w-[76rem]' : 'max-w-[64rem]')}
        >
          {children}
        </main>
        <nav
          aria-label={t('nav.main')}
          className="no-print wide:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 bg-white border-t border-hairline"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV.map((n) => {
            const active = pathname?.startsWith(n.href) ?? false;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex flex-col items-center justify-center gap-0.5 min-h-[3.5rem] py-1.5 text-small leading-tight',
                  active
                    ? 'text-talaTeal font-medium border-t-2 border-talaTeal'
                    : 'text-forest border-t-2 border-transparent'
                )}
              >
                <Icon name={n.icon} size={24} strokeWidth={active ? 2.1 : 1.75} />
                <span className="text-center px-1">{t(n.key)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-center gap-3 min-h-touch px-3 rounded',
        active ? 'bg-talaTeal text-white font-medium' : 'text-forest hover:bg-cream'
      )}
    >
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </Link>
  );
}
