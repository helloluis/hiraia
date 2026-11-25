'use client';
/**
 * "My own slides": the PowerPoint files a teacher has brought into Tala, and the one place to bring another.
 *
 * Uploading is one action (choose a file) with an honest wait: the file is read on the device, sent in pieces that
 * survive a dropped connection, and checked by the server, which either opens it for editing or says plainly why
 * not. Everything here is private to the signed-in account.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import { formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { refusalReason, sendUpload, uploadFailure, UploadStopped, useUploads, type SendProgress } from '@/data/uploads';
import { IconBadge } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { Banner, Button, LinkButton, PageHeader, Placeholder, cx } from '@/components/ui';
import { megabytes, refusalKey } from './upload-model';

export function UploadsScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const { status } = useSession();
  const { list, loading, failed, reload } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const maxBytes = list?.allowance.fileBytes ?? UPLOAD_LIMITS.fileBytes;
  const send = async (file: File | undefined | null) => {
    if (!file || progress) return;
    setProblem(null);
    // What can be known on the device is said before anything is sent.
    if (!/\.(pptx|potx|ppsx)$/i.test(file.name)) {
      const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
      const why = ['pptm', 'potm', 'ppsm'].includes(ext) ? 'macros' : ['ppt', 'pot', 'pps'].includes(ext) ? 'old_powerpoint' : ext === 'pdf' ? 'pdf' : ['doc', 'docx', 'xls', 'xlsx'].includes(ext) ? 'wrong_office_file' : 'wrong_extension';
      return setProblem(t(refusalKey(why)));
    }
    if (file.size > maxBytes) return setProblem(t('up.no.too_large'));
    if (file.size === 0) return setProblem(t('up.no.empty'));
    const ctrl = new AbortController();
    stop.current = ctrl;
    try {
      const deck = await sendUpload(file, setProgress, ctrl.signal);
      router.push(`/slides/mine/${deck.id}`);
    } catch (err) {
      setProgress(null);
      if (err instanceof UploadStopped) setProblem(t('up.send.stopped'));
      else if (uploadFailure(err) === 'offline') setProblem(t('up.send.offline'));
      else if (uploadFailure(err) === 'refused') setProblem(t(refusalKey(refusalReason(err))));
      else setProblem(t('up.send.failed'));
      void reload();
    } finally {
      stop.current = null;
      if (input.current) input.current.value = '';
    }
  };

  if (status === 'signedOut')
    return (
      <div className="flex max-w-[40rem] flex-col gap-4">
        <PageHeader title={t('up.title')} back={{ href: '/library', label: t('nav.library') }} subtitle={t('up.lead')} />
        <LinkButton href="/sign-in" variant="primary">
          {t('up.signIn')}
        </LinkButton>
      </div>
    );

  const pct = progress && progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  return (
    <div className="flex max-w-[52rem] flex-col gap-6">
      <PageHeader title={t('up.title')} back={{ href: '/library', label: t('nav.library') }} subtitle={t('up.lead')} />

      <section
        aria-label={t('up.choose')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files[0]);
        }}
        className={cx('flex flex-col items-start gap-3 rounded-lg border-2 border-dashed bg-white p-5', over ? 'border-talaTeal bg-talaTeal/5' : 'border-hairline')}
      >
        <input ref={input} type="file" accept=".pptx,.potx,.ppsx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" tabIndex={-1} aria-hidden="true" data-upload-input onChange={(e) => void send(e.target.files?.[0])} />
        {progress ? (
          <div className="flex w-full flex-col gap-2" role="status" aria-live="polite">
            <p className="font-medium">
              {progress.phase === 'reading'
                ? t('up.send.reading')
                : progress.phase === 'checking'
                  ? t('up.send.checking')
                  : t('up.send.sending', { sent: megabytes(progress.sent), total: megabytes(progress.total) })}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-forest/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="h-full bg-talaTeal" style={{ width: `${progress.phase === 'reading' ? 3 : pct}%` }} />
            </div>
            {progress.phase !== 'checking' && (
              <Button variant="quiet" className="self-start" onClick={() => stop.current?.abort()}>
                {t('up.send.stop')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <Button variant="primary" onClick={() => input.current?.click()}>
              <Icon name="plus" size={20} />
              {t('up.choose')}
            </Button>
            <p className="text-small text-forestMuted">
              {t('up.chooseHint', { mb: megabytes(maxBytes) })} <span className="hidden wide:inline">{t('up.drop')}.</span>
            </p>
          </>
        )}
        <p className="flex items-start gap-1.5 text-small text-forestMuted" data-upload-privacy>
          <Icon name="lock" size={14} className="mt-[0.2em] shrink-0" />
          <span>{t('up.private')}</span>
        </p>
      </section>
      {problem && (
        <Banner kind="warn" action={<Button variant="quiet" onClick={() => setProblem(null)} data-upload-problem-close>{t('common.close')}</Button>}>
          <span data-upload-problem>{problem}</span>
        </Banner>
      )}

      <section aria-labelledby="my-uploads" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="my-uploads" className="font-display text-title">
            {t('up.listTitle')}
          </h2>
          {list && <p className="text-small text-forestMuted">{t('up.room', { mb: megabytes(list.allowance.remainingBytes), n: list.allowance.remainingUploads })}</p>}
        </div>
        {loading ? (
          <Placeholder rows={3} />
        ) : failed ? (
          <Banner kind="warn" action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}>
            {t('up.ed.loadFailed')}
          </Banner>
        ) : !list?.decks.length ? (
          <p className="text-forestMuted">{t('up.none')}</p>
        ) : (
          <ul className="grid gap-3">
            {list.decks.map((d) => (
              <li key={d.id}>
                <Link href={`/slides/mine/${d.id}`} className="group flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-card transition-shadow hover:shadow-lift">
                  <IconBadge name="slides" tint="teal" size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-display text-title leading-snug">{d.title}</span>
                    <span className="block break-words text-small text-forestMuted">
                      {d.fileName} · {t('up.slides', { n: d.slideCount })} · {t('up.size', { mb: megabytes(d.bytes) })}
                    </span>
                    <span className="block break-words text-small text-forestMuted">
                      {d.changedSlides > 0 ? t('up.changed', { n: d.changedSlides }) : t('up.unchanged')} · {t('up.saved', { time: formatTime(d.updatedAt, lang) })}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-small font-medium text-talaTeal">
                    <span className="hidden min-[480px]:inline">{t('up.open')}</span>
                    <Icon name="arrowRight" size={18} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The way in from the Library: one quiet card, for signed-in teachers only. */
export function MyUploadsCard() {
  const { t } = useT();
  const { status } = useSession();
  if (status !== 'signedIn') return null;
  return (
    <section aria-labelledby="own-slides" className="flex flex-wrap items-center gap-4 rounded-lg bg-white px-4 py-4 shadow-card">
      <IconBadge name="slides" tint="teal" size={44} />
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="own-slides" className="font-display text-title leading-snug">
          {t('up.libraryTitle')}
        </h2>
        <p className="text-small text-forestMuted">{t('up.libraryBody')}</p>
      </div>
      <LinkButton href="/library/mine">{t('up.libraryAction')}</LinkButton>
    </section>
  );
}
