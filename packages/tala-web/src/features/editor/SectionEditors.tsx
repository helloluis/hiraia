'use client';
/**
 * Structured section editors (PLAN-2: template tables are structured fields the app lays out):
 * list, procedure (steps with minutes), weekgrid (DLL days), pergroup (per grade group), multigrade time blocks
 * (one card per block on phones; group columns side by side on wide screens — SCR-3).
 */
import type { MultigradeBlock, RichText, SectionContent } from '@hiraia/tala-core/contracts';
import { formatDate, formatWeekday, useT } from '@/i18n';
import { newId } from '@/data/ids';
import { useRef, useState } from 'react';
import { ArrowButton, Button, Select, Sheet, TextArea, TextInput, cx } from '@/components/ui';
import {
  defaultTransitionMinutes,
  gradesWithContent,
  groupTint,
  removalNeedsConfirm,
} from './blocks';
import { FlowTimeline } from './FlowTimeline';
import { weekdayReference } from '@/features/setup/days';
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
  /** Class time for the Session Flow / procedure timeline bar. */
  durationMinutes?: number;
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

function ProcedureEditor({
  content,
  onChange,
  readOnly,
  label,
  durationMinutes,
}: Props<Of<'procedure'>>) {
  const { t } = useT();
  const steps = content.steps;
  const set = (next: typeof steps) => onChange({ type: 'procedure', steps: next });
  const total = steps.reduce((n, s) => n + (s.minutes || 0), 0);
  return (
    <div className="flex flex-col gap-3">
      {durationMinutes ? (
        <FlowTimeline
          blocks={steps.map((st) => ({
            id: st.id,
            label: st.title,
            minutes: st.minutes,
            tintIndex: null,
          }))}
          duration={durationMinutes}
        />
      ) : null}
      {steps.map((s, k) => (
        <div
          key={s.id}
          className="rounded border border-hairline bg-cream/50 p-4 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <strong>{t('editor.step', { n: k + 1 })}</strong>
            {!readOnly && (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <ArrowButton
                  direction="up"
                  label={t('editor.moveStepUp', { n: k + 1 })}
                  disabled={k === 0}
                  onClick={() => set(move(steps, k, k - 1))}
                />
                <ArrowButton
                  direction="down"
                  label={t('editor.moveStepDown', { n: k + 1 })}
                  disabled={k === steps.length - 1}
                  onClick={() => set(move(steps, k, k + 1))}
                />
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
              <MinutesInput
                label={t('editor.minutes')}
                value={s.minutes}
                min={0}
                max={480}
                onChange={(minutes) =>
                  set(steps.map((x) => (x.id === s.id ? { ...x, minutes } : x)))
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
        // An undated day is named by its weekday (a weekend plan's sixth day reads "Saturday", not "Day 6").
        const heading = d.date
          ? `${formatWeekday(d.date, lang)} · ${formatDate(d.date, lang)}`
          : formatWeekday(weekdayReference(d.weekday), lang);
        return (
          <div
            key={k}
            className="rounded border border-hairline bg-cream/50 p-4 flex flex-col gap-3"
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

function GradeHeading({ grade, index }: { grade: string; index: number }) {
  const { t } = useT();
  const tint = groupTint(index);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 font-display text-[1.0625rem]',
        tint.border,
        tint.bg
      )}
    >
      {t('common.grade', { g: grade })}
    </span>
  );
}

/** One ROW per grade, each on its own consistent tint, at every width (no columns). */
function PerGroupEditor({ content, onChange, readOnly, groups, label }: Props<Of<'pergroup'>>) {
  const ids = groups.length ? groups.map((g) => g.id) : Object.keys(content.groups);
  const set = (gid: string, body: RichText) =>
    onChange({ type: 'pergroup', groups: { ...content.groups, [gid]: body } });
  return (
    <div className="flex flex-col gap-3">
      {ids.map((gid, i) => {
        const g = groups.find((x) => x.id === gid);
        const tint = groupTint(i);
        const body = content.groups[gid] ?? [];
        return (
          <div
            key={gid}
            className={cx(
              'rounded border p-4 flex flex-col gap-3 text-forest',
              tint.border,
              tint.bg
            )}
          >
            <GradeHeading grade={g?.grade ?? gid} index={i} />
            {readOnly ? (
              <RichTextView value={body} />
            ) : (
              <RichTextEditor
                value={body}
                onChange={(b) => set(gid, b)}
                label={`${label} · ${g ? g.grade : gid}`}
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

function MultigradeEditor({
  content,
  onChange,
  readOnly,
  groups,
  label,
  durationMinutes,
}: Props<Of<'multigrade'>>) {
  const { t } = useT();
  const ids = groups.length
    ? groups.map((g) => g.id)
    : [...new Set(content.blocks.flatMap((b) => Object.keys(b.groups)))];
  const info = ids.map((id) => ({ id, grade: groups.find((x) => x.id === id)?.grade ?? id }));
  const name = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    return g ? t('common.grade', { g: g.grade }) : gid;
  };
  const blocks = content.blocks;
  const set = (next: MultigradeBlock[]) =>
    onChange({ ...content, type: 'multigrade', blocks: next });
  const update = (id: string, patch: Partial<MultigradeBlock>) =>
    set(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const total = blocks.reduce((n, b) => n + b.minutes, 0);
  const [removing, setRemoving] = useState<{ block: MultigradeBlock; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRemove = (b: MultigradeBlock, k: number) => {
    if (removalNeedsConfirm(b, info)) setRemoving({ block: b, index: k });
    else set(blocks.filter((x) => x.id !== b.id));
  };
  const confirmRemove = () => {
    if (!removing) return;
    set(blocks.filter((x) => x.id !== removing.block.id));
    setRemoving(null);
    // Focus returns to the block list (not to a removed element).
    setTimeout(() => listRef.current?.focus(), 0);
  };
  const removingGrades = removing ? gradesWithContent(removing.block, info) : [];
  const flowBlocks = blocks.map((b) => ({
    id: b.id,
    label: b.label,
    minutes: b.minutes,
    tintIndex:
      b.teacherWith === 'all' || b.teacherWith === 'none'
        ? null
        : Math.max(0, ids.indexOf(b.teacherWith)),
  }));
  return (
    <div className="flex flex-col gap-3">
      {durationMinutes ? <FlowTimeline blocks={flowBlocks} duration={durationMinutes} /> : null}
      {/* Pre-class note about the session as a whole (optional). */}
      {readOnly ? (
        content.note ? (
          <p className="rounded border border-hairline bg-white px-4 py-3 text-forestMuted italic">
            {content.note}
          </p>
        ) : null
      ) : (
        <TextArea
          label={t('editor.sessionNote')}
          optional
          hint={t('editor.sessionNoteHint')}
          value={content.note ?? ''}
          maxLength={600}
          rows={2}
          onChange={(e) =>
            onChange({ ...content, type: 'multigrade', note: e.target.value || undefined })
          }
        />
      )}
      <div
        ref={listRef}
        tabIndex={-1}
        className="flex flex-col gap-3 outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-talaTeal rounded"
      >
        {blocks.map((b, k) => (
          <div
            key={b.id}
            className="rounded border border-hairline bg-white p-4 flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong className="text-[1.0625rem]">{t('editor.block', { n: k + 1 })}</strong>
              {!readOnly && (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <ArrowButton
                    direction="up"
                    label={t('editor.moveBlockUp', { n: k + 1 })}
                    disabled={k === 0}
                    onClick={() => set(move(blocks, k, k - 1))}
                  />
                  <ArrowButton
                    direction="down"
                    label={t('editor.moveBlockDown', { n: k + 1 })}
                    disabled={k === blocks.length - 1}
                    onClick={() => set(move(blocks, k, k + 1))}
                  />
                  <Button
                    variant="quiet"
                    onClick={() => requestRemove(b, k)}
                    aria-label={t('editor.removeBlock', { n: k + 1 })}
                  >
                    {t('common.remove')}
                  </Button>
                </span>
              )}
            </div>
            {readOnly ? (
              <p>
                <span className="font-medium">{b.label}</span> ·{' '}
                {t('common.minutes', { n: b.minutes })} · {t('editor.teacherWith')}:{' '}
                {b.teacherWith === 'all'
                  ? t('editor.teacherAll')
                  : b.teacherWith === 'none'
                    ? t('editor.teacherNone')
                    : name(b.teacherWith)}
              </p>
            ) : (
              /* Labels above inputs; fields share one baseline on wide screens and wrap cleanly on phones. */
              <div className="grid gap-3 items-end grid-cols-1 min-[480px]:grid-cols-[minmax(0,2fr)_minmax(6rem,1fr)] wide:grid-cols-[minmax(0,2fr)_minmax(6rem,0.6fr)_minmax(0,1.4fr)]">
                <TextInput
                  label={t('editor.blockLabel')}
                  placeholder={t('editor.blockLabelHint')}
                  value={b.label}
                  maxLength={120}
                  onChange={(e) => update(b.id, { label: e.target.value })}
                />
                <TextInput
                  label={t('editor.timeAllotment')}
                  inputMode="numeric"
                  value={String(b.minutes)}
                  onChange={(e) => update(b.id, { minutes: clampInt(e.target.value, 1, 240) })}
                />
                <div className="min-[480px]:col-span-2 wide:col-span-1">
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
              </div>
            )}
            {/* One row per grade, same tint as that grade's other sections. */}
            <div className="flex flex-col gap-3">
              {ids.map((gid, i) => {
                const ga = b.groups[gid] ?? {
                  mode: 'independent' as const,
                  activity: [] as RichText,
                };
                const tint = groupTint(i);
                return (
                  <div
                    key={gid}
                    className={cx(
                      'rounded border p-4 flex flex-col gap-3 text-forest',
                      tint.border,
                      tint.bg
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <GradeHeading grade={info[i]?.grade ?? gid} index={i} />
                      {readOnly && (
                        <span className="text-small text-forestMuted">
                          {t(`editor.mode.${ga.mode}`)}
                        </span>
                      )}
                    </div>
                    {readOnly ? (
                      <RichTextView value={ga.activity} />
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
        ))}
      </div>
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
                  // Not a teacher-facing field (not in the DLL format): new blocks take the engine's default.
                  transitionMinutes: defaultTransitionMinutes('all'),
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
      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('editor.removeBlockTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              {t('common.remove')}
            </Button>
          </>
        }
      >
        <p>
          {removingGrades.length
            ? t('editor.removeBlockBody', {
                grades: removingGrades.map((g) => t('common.grade', { g })).join(', '),
              })
            : t('editor.removeBlockEmpty')}
        </p>
      </Sheet>
    </div>
  );
}

/** Minutes field that updates the bar as the teacher types; empty or invalid text is ignored until it parses. */
function MinutesInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  const last = useRef(value);
  if (last.current !== value) {
    last.current = value;
    if (parseInt(raw, 10) !== value) setRaw(String(value));
  }
  return (
    <TextInput
      label={label}
      inputMode="numeric"
      value={raw}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
      onBlur={() => setRaw(String(value))}
    />
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
