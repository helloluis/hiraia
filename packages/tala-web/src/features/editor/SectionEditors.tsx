'use client';
/**
 * Structured section editors (PLAN-2: template tables are structured fields the app lays out):
 * list, procedure (steps with minutes), weekgrid (DLL days), pergroup (per grade group), multigrade time blocks
 * (one card per block on phones; group columns side by side on wide screens — SCR-3).
 */
import type { MultigradeBlock, RichText, SectionContent } from '@hiraia/tala-core/contracts';
import { formatDate, formatWeekday, useT } from '@/i18n';
import { newId } from '@/data/ids';
import { Button, Select, TextInput, cx } from '@/components/ui';
import { RichTextEditor, RichTextView } from './RichTextEditor';

export interface GroupInfo {
  id: string;
  grade: string;
}

interface Props<C extends SectionContent> {
  content: C;
  onChange: (c: C) => void;
  readOnly: boolean;
  groups: GroupInfo[];
  label: string;
}

type Of<T extends SectionContent['type']> = Extract<SectionContent, { type: T }>;

export function SectionEditor(p: Props<SectionContent>) {
  switch (p.content.type) {
    case 'text':
      return (
        <RichTextEditor
          value={p.content.blocks}
          onChange={(blocks) => p.onChange({ type: 'text', blocks })}
          label={p.label}
          readOnly={p.readOnly}
        />
      );
    case 'list':
      return <ListEditor {...(p as Props<Of<'list'>>)} />;
    case 'procedure':
      return <ProcedureEditor {...(p as Props<Of<'procedure'>>)} />;
    case 'weekgrid':
      return <WeekGridEditor {...(p as Props<Of<'weekgrid'>>)} />;
    case 'pergroup':
      return <PerGroupEditor {...(p as Props<Of<'pergroup'>>)} />;
    case 'multigrade':
      return <MultigradeEditor {...(p as Props<Of<'multigrade'>>)} />;
  }
}

function ListEditor({ content, onChange, readOnly, label }: Props<Of<'list'>>) {
  const { t } = useT();
  const items = content.items;
  if (readOnly) {
    return items.length ? (
      <ul className="list-disc pl-6">
        {items.map((i, k) => (
          <li key={k}>{i}</li>
        ))}
      </ul>
    ) : (
      <p className="text-forestMuted">{t('editor.sectionEmpty')}</p>
    );
  }
  const set = (next: string[]) => onChange({ type: 'list', items: next });
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, k) => (
        <div key={k} className="flex gap-2 items-center">
          <span aria-hidden="true">•</span>
          <input
            aria-label={`${label} ${k + 1}`}
            className="flex-1 min-h-touch rounded border border-hairline bg-white px-3"
            value={item}
            maxLength={1000}
            onChange={(e) => set(items.map((x, j) => (j === k ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                set([...items.slice(0, k + 1), '', ...items.slice(k + 1)]);
              }
            }}
          />
          <Button
            variant="quiet"
            onClick={() => set(items.filter((_, j) => j !== k))}
            aria-label={`${t('editor.removeItem')} ${k + 1}`}
          >
            ✕
          </Button>
        </div>
      ))}
      {items.length < 100 && (
        <Button onClick={() => set([...items, ''])} className="self-start">
          + {t('editor.addItem')}
        </Button>
      )}
    </div>
  );
}

function ProcedureEditor({ content, onChange, readOnly, label }: Props<Of<'procedure'>>) {
  const { t } = useT();
  const steps = content.steps;
  const set = (next: typeof steps) => onChange({ type: 'procedure', steps: next });
  const total = steps.reduce((n, s) => n + (s.minutes || 0), 0);
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, k) => (
        <div
          key={s.id}
          className="rounded border border-hairline bg-cream/50 p-3 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <strong>{t('editor.step', { n: k + 1 })}</strong>
            {!readOnly && (
              <span className="flex gap-1">
                <Button
                  variant="quiet"
                  disabled={k === 0}
                  onClick={() => set(move(steps, k, k - 1))}
                  aria-label={`↑ ${t('editor.step', { n: k + 1 })}`}
                >
                  ↑
                </Button>
                <Button
                  variant="quiet"
                  disabled={k === steps.length - 1}
                  onClick={() => set(move(steps, k, k + 1))}
                  aria-label={`↓ ${t('editor.step', { n: k + 1 })}`}
                >
                  ↓
                </Button>
                <Button variant="quiet" onClick={() => set(steps.filter((x) => x.id !== s.id))}>
                  {t('common.remove')}
                </Button>
              </span>
            )}
          </div>
          {readOnly ? (
            <p className="font-medium">
              {s.title} · {t('common.minutes', { n: s.minutes })}
            </p>
          ) : (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <TextInput
                label={t('editor.stepTitle')}
                value={s.title}
                maxLength={200}
                onChange={(e) =>
                  set(steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))
                }
              />
              <TextInput
                label={t('editor.minutes')}
                inputMode="numeric"
                value={String(s.minutes)}
                onChange={(e) =>
                  set(
                    steps.map((x) =>
                      x.id === s.id ? { ...x, minutes: clampInt(e.target.value, 0, 480) } : x
                    )
                  )
                }
              />
            </div>
          )}
          {readOnly ? (
            <RichTextView value={s.body} />
          ) : (
            <RichTextEditor
              value={s.body}
              onChange={(body) => set(steps.map((x) => (x.id === s.id ? { ...x, body } : x)))}
              label={`${label} ${k + 1}`}
              minRows={2}
            />
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        {!readOnly && steps.length < 40 && (
          <Button onClick={() => set([...steps, { id: newId(), title: '', minutes: 5, body: [] }])}>
            + {t('editor.addStep')}
          </Button>
        )}
        {steps.length > 0 && (
          <span className="text-small text-forestMuted ml-auto">
            {t('common.minutes', { n: total })}
          </span>
        )}
      </div>
    </div>
  );
}

function WeekGridEditor({ content, onChange, readOnly, label }: Props<Of<'weekgrid'>>) {
  const { t, lang } = useT();
  const set = (k: number, body: RichText) =>
    onChange({
      type: 'weekgrid',
      days: content.days.map((d, j) => (j === k ? { ...d, body } : d)),
    });
  return (
    <div className="flex flex-col gap-3">
      {content.days.map((d, k) => {
        const heading = d.date
          ? `${formatWeekday(d.date, lang)} · ${formatDate(d.date, lang)}`
          : `${t('editor.day')} ${d.weekday}`;
        return (
          <div
            key={k}
            className="rounded border border-hairline bg-cream/50 p-3 flex flex-col gap-2"
          >
            <strong>{heading}</strong>
            {readOnly ? (
              <RichTextView value={d.body} />
            ) : (
              <RichTextEditor
                value={d.body}
                onChange={(b) => set(k, b)}
                label={`${label} · ${heading}`}
                minRows={2}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PerGroupEditor({ content, onChange, readOnly, groups, label }: Props<Of<'pergroup'>>) {
  const { t } = useT();
  const ids = groups.length ? groups.map((g) => g.id) : Object.keys(content.groups);
  const set = (gid: string, body: RichText) =>
    onChange({ type: 'pergroup', groups: { ...content.groups, [gid]: body } });
  return (
    <div className={cx('grid gap-3', ids.length > 1 && 'wide:grid-cols-2')}>
      {ids.map((gid) => {
        const g = groups.find((x) => x.id === gid);
        const heading = g ? t('common.grade', { g: g.grade }) : gid;
        const body = content.groups[gid] ?? [];
        return (
          <div
            key={gid}
            className="rounded border border-hairline bg-cream/50 p-3 flex flex-col gap-2"
          >
            <strong>{heading}</strong>
            {readOnly ? (
              <RichTextView value={body} />
            ) : (
              <RichTextEditor
                value={body}
                onChange={(b) => set(gid, b)}
                label={`${label} · ${heading}`}
                minRows={2}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const MODES = ['direct', 'independent', 'peer', 'shared'] as const;

function MultigradeEditor({ content, onChange, readOnly, groups, label }: Props<Of<'multigrade'>>) {
  const { t } = useT();
  const ids = groups.length
    ? groups.map((g) => g.id)
    : [...new Set(content.blocks.flatMap((b) => Object.keys(b.groups)))];
  const name = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    return g ? t('common.grade', { g: g.grade }) : gid;
  };
  const blocks = content.blocks;
  const set = (next: MultigradeBlock[]) => onChange({ type: 'multigrade', blocks: next });
  const update = (id: string, patch: Partial<MultigradeBlock>) =>
    set(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const total = blocks.reduce((n, b) => n + b.minutes, 0);
  const cols = Math.max(1, ids.length);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, k) => (
        <div
          key={b.id}
          className="rounded border border-hairline bg-cream/50 p-3 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <strong>{t('editor.block', { n: k + 1 })}</strong>
            {!readOnly && (
              <span className="flex gap-1">
                <Button
                  variant="quiet"
                  disabled={k === 0}
                  onClick={() => set(move(blocks, k, k - 1))}
                  aria-label={`↑ ${t('editor.block', { n: k + 1 })}`}
                >
                  ↑
                </Button>
                <Button
                  variant="quiet"
                  disabled={k === blocks.length - 1}
                  onClick={() => set(move(blocks, k, k + 1))}
                  aria-label={`↓ ${t('editor.block', { n: k + 1 })}`}
                >
                  ↓
                </Button>
                <Button variant="quiet" onClick={() => set(blocks.filter((x) => x.id !== b.id))}>
                  {t('common.remove')}
                </Button>
              </span>
            )}
          </div>
          {readOnly ? (
            <p>
              <span className="font-medium">{b.label}</span> ·{' '}
              {t('common.minutes', { n: b.minutes })}
              {b.transitionMinutes
                ? ` · ${t('editor.transition')}: ${b.transitionMinutes}`
                : ''} · {t('editor.teacherWith')}:{' '}
              {b.teacherWith === 'all'
                ? t('editor.teacherAll')
                : b.teacherWith === 'none'
                  ? t('editor.teacherNone')
                  : name(b.teacherWith)}
            </p>
          ) : (
            <div className="grid gap-2 wide:grid-cols-[2fr_1fr_1fr_2fr]">
              <TextInput
                label={t('editor.blockLabel')}
                hint={t('editor.blockLabelHint')}
                value={b.label}
                maxLength={120}
                onChange={(e) => update(b.id, { label: e.target.value })}
              />
              <TextInput
                label={t('editor.minutes')}
                inputMode="numeric"
                value={String(b.minutes)}
                onChange={(e) => update(b.id, { minutes: clampInt(e.target.value, 1, 240) })}
              />
              <TextInput
                label={t('editor.transition')}
                inputMode="numeric"
                value={String(b.transitionMinutes)}
                onChange={(e) =>
                  update(b.id, { transitionMinutes: clampInt(e.target.value, 0, 30) })
                }
              />
              <Select
                label={t('editor.teacherWith')}
                value={b.teacherWith}
                onChange={(e) =>
                  update(b.id, {
                    teacherWith: e.target.value,
                    pairedGroupIds: e.target.value === 'all' ? ids : [],
                  })
                }
              >
                <option value="all">{t('editor.teacherAll')}</option>
                {ids.map((gid) => (
                  <option key={gid} value={gid}>
                    {name(gid)}
                  </option>
                ))}
                <option value="none">{t('editor.teacherNone')}</option>
              </Select>
            </div>
          )}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(var(--mg-cols, 1), minmax(0, 1fr))` }}
          >
            <style>{`@media (min-width: 840px){[data-mg="${b.id}"]{--mg-cols:${cols}}}`}</style>
            <div className="contents" data-mg={b.id}>
              {ids.map((gid) => {
                const ga = b.groups[gid] ?? {
                  mode: 'independent' as const,
                  activity: [] as RichText,
                };
                return (
                  <div
                    key={gid}
                    className="rounded border border-hairline bg-white p-2 flex flex-col gap-2"
                    data-mg={b.id}
                  >
                    <strong>{name(gid)}</strong>
                    {readOnly ? (
                      <>
                        <span className="text-small text-forestMuted">
                          {t(`editor.mode.${ga.mode}`)}
                        </span>
                        <RichTextView value={ga.activity} />
                      </>
                    ) : (
                      <>
                        <Select
                          label={t('editor.mode')}
                          value={ga.mode}
                          onChange={(e) =>
                            update(b.id, {
                              groups: {
                                ...b.groups,
                                [gid]: { ...ga, mode: e.target.value as (typeof MODES)[number] },
                              },
                            })
                          }
                        >
                          {MODES.map((m) => (
                            <option key={m} value={m}>
                              {t(`editor.mode.${m}`)}
                            </option>
                          ))}
                        </Select>
                        <RichTextEditor
                          value={ga.activity}
                          onChange={(activity) =>
                            update(b.id, { groups: { ...b.groups, [gid]: { ...ga, activity } } })
                          }
                          label={`${label} · ${b.label || t('editor.block', { n: k + 1 })} · ${name(gid)}`}
                          minRows={2}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        {!readOnly && blocks.length < 24 && (
          <Button
            onClick={() =>
              set([
                ...blocks,
                {
                  id: newId(),
                  label: '',
                  minutes: 10,
                  transitionMinutes: 0,
                  teacherWith: 'all',
                  pairedGroupIds: ids,
                  groups: Object.fromEntries(
                    ids.map((gid) => [gid, { mode: 'shared' as const, activity: [] as RichText }])
                  ),
                },
              ])
            }
          >
            + {t('editor.addBlock')}
          </Button>
        )}
        {blocks.length > 0 && (
          <span className="text-small text-forestMuted ml-auto">
            {t('common.minutes', { n: total })}
          </span>
        )}
      </div>
    </div>
  );
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function clampInt(v: string, min: number, max: number): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
