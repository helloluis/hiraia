'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { printHtml, renderPlanHtml, renderPlanText } from '@/data/print';
import { Banner, Button, Choice, Sheet, Waiting } from '@/components/ui';
import type { PlanEditor } from './usePlanEditor';

/**
 * PDF (PDF-1, PDF-4a). Device path: the browser's print window with "Save as PDF". Fallbacks, in order:
 * a plain printable page, copy as text, and a server-made PDF when online. The teacher always leaves with something.
 */
export function PdfSheet({ open, onClose, ed }: { open: boolean; onClose: () => void; ed: PlanEditor }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { network } = useSession();
  const [paper, setPaper] = useState<'a4' | 'long'>('a4');
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverBusy, setServerBusy] = useState<AbortController | null>(null);

  if (!ed.plan || !ed.template) return null;
  const year = ed.ws.years.find(y => y.id === ed.cls?.schoolYearId) ?? ed.ws.activeYear ?? undefined;
  const input = {
    plan: ed.plan,
    sections: ed.sections.map(s => s.data),
    template: ed.template,
    class: ed.cls ?? undefined,
    schoolYear: year,
    teacherName: ed.ws.profile?.displayName ?? '',
    paper,
    lang,
    competencies: ed.competencies,
  };

  const viaBrowser = async () => {
    await ed.flushAll();
    const ok = printHtml(renderPlanHtml(input));
    if (!ok) setFailed(true);
  };
  const plainPage = () => router.push(`/lessons/${ed.plan!.id}/print?paper=${paper}`);
  const copyText = async () => {
    const text = renderPlanText(input);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setCopied(true);
    }
  };
  const serverPdf = async () => {
    const ctrl = new AbortController();
    setServerBusy(ctrl);
    try {
      const buf = await getClient().call('print.planPdf', { params: { planId: ed.plan!.id }, query: { paper, images: false }, signal: ctrl.signal });
      const blob = new Blob([buf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(ed.plan!.title || 'lesson').replace(/[^\w\-]+/g, '_')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      if (!ctrl.signal.aborted) setFailed(true);
    } finally {
      setServerBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('pdf.title')}>
      <Choice
        label={t('pdf.paper')}
        value={paper}
        onChange={setPaper}
        options={[
          { value: 'a4', label: t('pdf.a4') },
          { value: 'long', label: t('pdf.long') },
        ]}
      />
      {failed && <Banner kind="warn">{t('pdf.failed')}</Banner>}
      <Button variant="primary" full onClick={() => void viaBrowser()}>
        {t('pdf.browser')}
      </Button>
      <p className="text-small text-forestMuted -mt-2">{t('pdf.browserHint')}</p>
      <Button full onClick={plainPage}>
        {t('pdf.plain')}
      </Button>
      <Button full onClick={() => void copyText()}>
        {copied ? `✓ ${t('pdf.copied')}` : t('pdf.copyText')}
      </Button>
      {serverBusy ? (
        <Waiting label={t('common.waiting')} onCancel={() => serverBusy.abort()} />
      ) : (
        <Button full onClick={() => void serverPdf()} disabled={!network.online || network.rung === 'offline'}>
          {t('pdf.server')}
          {!network.online || network.rung === 'offline' ? ` · ${t('pdf.serverOffline')}` : ''}
        </Button>
      )}
    </Sheet>
  );
}
