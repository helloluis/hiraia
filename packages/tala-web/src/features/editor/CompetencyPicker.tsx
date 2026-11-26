'use client';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { Button, Checkbox, Sheet, TextInput } from '@/components/ui';
import { topicLabel } from '@/data/topics';
import type { Competency } from '@hiraia/tala-core/contracts';
import type { PlanEditor } from './usePlanEditor';

/** Choose competencies per grade group for the plan's learning area (CUR-2: tagging is the default, not a chore). */
export function CompetencyPicker({
  open,
  onClose,
  ed,
}: {
  open: boolean;
  onClose: () => void;
  ed: PlanEditor;
}) {
  const { t, lang } = useT();
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState('');
  const [allTerms, setAllTerms] = useState(false);
  useEffect(() => {
    if (open && ed.plan) setChosen(ed.plan.competencies);
  }, [open, ed.plan]);
  const date = ed.plan?.placements[0]?.dates[0] ?? null;
  const year = ed.ws.years.find((y) => y.id === ed.cls?.schoolYearId) ?? ed.ws.activeYear;
  const term =
    date && year ? year.terms.find((x) => x.startDate <= date && x.endDate >= date) : null;
  const byGroup = useMemo(
    () =>
      ed.groups.map((g) => ({
        g,
        list: ed.competencies
          .filter(
            (c) =>
              c.grade === g.grade &&
              (!ed.plan?.learningAreaId || c.learningAreaId === ed.plan.learningAreaId)
          )
          .filter((c) => allTerms || !term || c.termIndex === term.index)
          .filter(
            (c) =>
              !query.trim() ||
              `${c.code ?? ''} ${c.text}`.toLowerCase().includes(query.toLowerCase())
          )
          .sort((a, b) => a.termIndex - b.termIndex || a.sequence - b.sequence),
      })),
    [ed.groups, ed.competencies, ed.plan, allTerms, term, query]
  );
  const toggle = (gid: string, id: string, on: boolean) =>
    setChosen((c) => ({
      ...c,
      [gid]: on ? [...(c[gid] ?? []), id] : (c[gid] ?? []).filter((x) => x !== id),
    }));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('editor.pickCompetency')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              ed.savePlan({ competencies: chosen }, true);
              onClose();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextInput
        label={t('common.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {term && (
        <Checkbox
          label={`${t('lessons.all')} (${year?.terms.map((x) => x.name).join(', ')})`}
          checked={allTerms}
          onChange={setAllTerms}
        />
      )}
      {byGroup.map(({ g, list }) => (
        <div key={g.id} className="flex flex-col gap-1">
          {ed.groups.length > 1 && (
            <h3 className="font-medium mt-2">{t('common.grade', { g: g.grade })}</h3>
          )}
          {list.length === 0 && <p className="text-small text-forestMuted">{t('setup.noPack')}</p>}
          {list.map((c) => (
            <div key={c.id} className="flex flex-col" data-competency={c.id}>
              <Checkbox
                label={
                  <span className="flex flex-col">
                    <span className="font-medium">{topicLabel(c, lang).heading}</span>
                    <span className="text-small text-forestMuted">
                      {c.code ? `${c.code} · ` : ''}
                      {c.text}
                    </span>
                  </span>
                }
                checked={(chosen[g.id] ?? []).includes(c.id)}
                onChange={(on) => toggle(g.id, c.id, on)}
              />
              <Standards c={c} />
            </div>
          ))}
        </div>
      ))}
    </Sheet>
  );
}

/**
 * The competency's content and performance standards and where it is printed, exactly as the curriculum pack
 * carries them (read-only; nothing here is model-written). Closed by default so the list stays short.
 */
function Standards({ c }: { c: Competency }) {
  const { t } = useT();
  const s = c.source;
  if (!c.contentStandard && !c.performanceStandard && !s.document) return null;
  const where = [s.edition, s.page ? t('editor.sourcePage', { n: String(s.page) }) : null].filter(Boolean).join(' · ');
  return (
    <details className="ml-9 mb-2 text-small text-forestMuted" data-competency-standards>
      <summary className="cursor-pointer min-h-touch flex items-center">{t('editor.standards')}</summary>
      <div className="flex flex-col gap-1 pb-1">
        {c.contentStandard && (
          <p data-content-standard>
            <span className="font-medium text-forest">{t('editor.contentStandard')}:</span> {c.contentStandard}
          </p>
        )}
        {c.performanceStandard && (
          <p data-performance-standard>
            <span className="font-medium text-forest">{t('editor.performanceStandard')}:</span> {c.performanceStandard}
          </p>
        )}
        {s.document && (
          <p data-competency-source>
            <span className="font-medium text-forest">{t('editor.source')}:</span>{' '}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                {s.document}
              </a>
            ) : (
              s.document
            )}
            {where ? ` · ${where}` : ''}
          </p>
        )}
      </div>
    </details>
  );
}
