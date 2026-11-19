'use client';
/**
 * Library: choose a grade and a DepEd term, see every week the 2026 Budget of Work prints, and open the week's pack.
 * Coverage is shown honestly: Ready (a named teacher reviewed it), being reviewed, or not built yet.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PackStatus, PackVariant } from '@hiraia/tala-core/contracts';
import { useT, type StringKey } from '@/i18n';
import { usePackIndex } from '@/data/packs';
import { Badge, Banner, PageHeader, Placeholder, cx, type Tone } from '@/components/ui';

const GRADES = ['3', '4', '5', '6', '7', '8', '9', '10'] as const;

export function statusLabel(entry: Pick<PackVariant, 'status' | 'viewable'>): { key: StringKey; tone: Tone } {
  const s: PackStatus = entry.status;
  if (s === 'approved') return { key: 'lib.status.approved', tone: 'sage' };
  if ((s === 'draft' || s === 'needs_work') && entry.viewable)
    return s === 'draft' ? { key: 'lib.status.draft', tone: 'gold' } : { key: 'lib.status.needs_work', tone: 'brick' };
  if (s === 'draft' || s === 'needs_work') return { key: 'lib.status.review', tone: 'neutral' };
  return { key: 'lib.status.notBuilt', tone: 'neutral' };
}

export function LibraryScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { index, failed } = usePackIndex();
  const grade = GRADES.includes(params.get('grade') as (typeof GRADES)[number]) ? params.get('grade')! : '4';
  const term = ['1', '2', '3'].includes(params.get('term') ?? '') ? Number(params.get('term')) : 1;
  const go = (g: string, tm: number) => router.replace(`/library?grade=${g}&term=${tm}`, { scroll: false });

  const weeks = (index?.packs ?? []).filter((p) => p.grade === grade && p.term === term).sort((a, b) => a.week - b.week);
  const c = index?.counts;
  // Weeks with at least one built language version (draft, needs work or approved): the honest size of the preview.
  const built = (index?.packs ?? []).filter((p) => (['en', 'fil'] as const).some((l) => ['draft', 'needs_work', 'approved'].includes(p.variants[l].status))).length;
  const drafts = c ? c.draft + c.needsWork : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('lib.title')} subtitle={t('lib.intro')} />
      <p className="text-small text-forestMuted">{t('lib.honest')}</p>
      {c && (
        <p className="text-small font-medium" data-testid="coverage">
          {t('lib.coverage', { weeks: index!.packs.length, ready: c.approved, total: c.targets, review: c.draft + c.needsWork, notBuilt: c.notBuilt + c.failed })}
        </p>
      )}
      {c && c.approved < c.targets && <Banner kind="warn">{t('lib.preview', { built, weeks: index!.packs.length })}</Banner>}
      {index?.reviewerView && <Banner kind="info">{t('lib.reviewerView')}</Banner>}
      {index && !index.reviewerView && drafts > 0 && (
        <Banner kind="info">
          <Link href="/sign-in" className="underline">
            {t('lib.signInToPreview')}
          </Link>
        </Banner>
      )}
      {failed && !index && <Banner kind="error">{t('lib.loadFailed')}</Banner>}

      <nav aria-label={t('lib.gradePicker')} className="flex flex-wrap gap-2">
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => go(g, term)}
            aria-pressed={g === grade}
            className={cx(
              'min-h-touch min-w-touch px-3 rounded-full border text-body',
              g === grade ? 'bg-talaTeal text-white border-talaTeal font-medium' : 'bg-white text-forest border-hairline hover:bg-cream'
            )}
          >
            {t('lib.grade', { grade: g })}
          </button>
        ))}
      </nav>
      <nav aria-label={t('lib.termPicker')} className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((tm) => (
          <button
            key={tm}
            type="button"
            onClick={() => go(grade, tm)}
            aria-pressed={tm === term}
            className={cx(
              'min-h-touch rounded border text-body',
              tm === term ? 'border-talaTeal text-talaTealText font-medium bg-white border-2' : 'border-hairline bg-white text-forest hover:bg-cream'
            )}
          >
            {t('lib.term', { term: tm })}
          </button>
        ))}
      </nav>

      {!index && !failed && <Placeholder rows={6} />}
      <ol className="flex flex-col gap-2" aria-label={`${t('lib.grade', { grade })}, ${t('lib.term', { term })}`}>
        {weeks.map((w) => {
          const mine = w.variants[lang === 'fil' ? 'fil' : 'en'];
          const other = w.variants[lang === 'fil' ? 'en' : 'fil'];
          const title = (mine.viewable && mine.title) || (other.viewable && other.title) || null;
          const inner = (
            <span className="flex items-start gap-3 w-full">
              <span className="shrink-0 w-16 text-small text-forestMuted pt-0.5">{t('lib.week', { week: w.week })}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">{title ?? w.topic}</span>
                {title && <span className="block text-small text-forestMuted break-words">{w.topic}</span>}
              </span>
              <span className="flex flex-col items-end gap-1">
                {(['fil', 'en'] as const).map((l) => {
                  const st = statusLabel(w.variants[l]);
                  return (
                    <span key={l} className="flex items-center gap-1 text-small">
                      <span className="text-forestMuted">{l === 'fil' ? 'FIL' : 'EN'}</span>
                      <Badge tone={st.tone}>{t(st.key)}</Badge>
                    </span>
                  );
                })}
              </span>
            </span>
          );
          return (
            <li key={w.packId}>
              {w.viewable ? (
                <Link href={`/library/${w.packId}`} className="flex min-h-touch items-center rounded border border-hairline bg-white px-3 py-2 hover:border-talaTeal">
                  {inner}
                </Link>
              ) : (
                <div className="flex min-h-touch items-center rounded border border-hairline bg-white/60 px-3 py-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
      <Link href="/community" className="text-talaTealText underline-offset-2 hover:underline min-h-touch inline-flex items-center">
        {t('lib.community')} →
      </Link>
    </div>
  );
}
