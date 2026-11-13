'use client';
/** Plain printable page (PDF-4a fallback): the shared print HTML in a full-height same-origin frame. */
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { renderPlanHtml } from '@/data/print';
import { Button, LinkButton, Placeholder } from '@/components/ui';
import { usePlanEditor } from './usePlanEditor';

export function PrintPage({ planId }: { planId: string }) {
  const { t, lang } = useT();
  const params = useSearchParams();
  const paper = params.get('paper') === 'long' ? 'long' : 'a4';
  const ed = usePlanEditor(planId);
  const html = useMemo(() => {
    if (!ed.plan || !ed.template) return null;
    const year =
      ed.ws.years.find((y) => y.id === ed.cls?.schoolYearId) ?? ed.ws.activeYear ?? undefined;
    return renderPlanHtml({
      plan: ed.plan,
      sections: ed.sections.map((s) => s.data),
      template: ed.template,
      class: ed.cls ?? undefined,
      schoolYear: year,
      teacherName: ed.ws.profile?.displayName ?? '',
      paper,
      lang,
      competencies: ed.competencies,
    });
  }, [ed.plan, ed.template, ed.sections, ed.cls, ed.ws, paper, lang, ed.competencies]);
  if (!html) return <Placeholder rows={6} />;
  return (
    <div className="min-h-dvh flex flex-col bg-white">
      <div className="no-print flex items-center justify-between gap-2 px-3 py-2 border-b border-hairline bg-cream">
        <LinkButton href={`/lessons/${planId}`} variant="quiet">
          ← {t('common.back')}
        </LinkButton>
        <Button
          variant="primary"
          onClick={() => {
            const f = document.getElementById('print-frame') as HTMLIFrameElement | null;
            f?.contentWindow?.focus();
            f?.contentWindow?.print();
          }}
        >
          {t('pdf.openPrint')}
        </Button>
      </div>
      <iframe
        id="print-frame"
        title={ed.plan?.title || t('lessons.untitled')}
        srcDoc={html}
        className="flex-1 w-full border-0"
        style={{ minHeight: 'calc(100dvh - 4rem)' }}
      />
    </div>
  );
}
