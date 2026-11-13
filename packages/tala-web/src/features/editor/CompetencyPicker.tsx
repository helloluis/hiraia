'use client';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { Button, Checkbox, Sheet, TextInput } from '@/components/ui';
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
  const { t } = useT();
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
            <Checkbox
              key={c.id}
              label={`${c.code ? c.code + ' · ' : ''}${c.text}`}
              checked={(chosen[g.id] ?? []).includes(c.id)}
              onChange={(on) => toggle(g.id, c.id, on)}
            />
          ))}
        </div>
      ))}
    </Sheet>
  );
}
