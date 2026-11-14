'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalRecord, PlanSection, SectionContent } from '@hiraia/tala-core/contracts';
import { formatDate, formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { planDates } from '@/data/plans';
import { topicLabel } from '@/data/topics';
import { blankContent } from '@hiraia/tala-core/plan';
import { Sparkle } from '@/components/ui';
import {
  Badge,
  Banner,
  Button,
  PageHeader,
  Placeholder,
  Sheet,
  TextInput,
  Waiting,
  cx,
} from '@/components/ui';
import { usePlanEditor } from './usePlanEditor';
import { SectionEditor } from './SectionEditors';
import { RichTextView } from './RichTextEditor';
import { CompetencyPicker } from './CompetencyPicker';
import { PdfSheet } from './PdfSheet';
import { MoreSheet } from './MoreSheet';
import { RegenSheet } from './RegenSheet';
import { PostSheet } from '@/features/community/PostSheet';
import { Toast } from '@/components/ui';

export function EditorScreen({ planId }: { planId: string }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { engine } = useSession();
  const ed = usePlanEditor(planId);
  const { plan, template } = ed;
  const [title, setTitle] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [conflict, setConflict] = useState<LocalRecord<'plan_section'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [regen, setRegen] = useState<LocalRecord<'plan_section'> | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const search = useSearchParams();
  const [toast, setToast] = useState<string | null>(() =>
    search.get('drafted') ? 'drafted' : search.get('queued') ? 'queued' : null
  );
  const { config } = useSession();
  const canGenerate = config?.features.generation !== false;

  useEffect(() => {
    if (plan && title === null) setTitle(plan.title);
  }, [plan, title]);

  const conflicts = useMemo(() => ed.sections.filter((s) => s.conflict), [ed.sections]);
  const { network } = useSession();
  const [fetching, setFetching] = useState(false);
  const fetched = useRef(false);
  // An older lesson outside the device window: fetch it once through sync.pull planIds (cursor untouched).
  useEffect(() => {
    if (ed.loading || plan || !engine || fetched.current || !network.online) return;
    fetched.current = true;
    setFetching(true);
    void engine.fetchPlans([planId]).finally(() => setFetching(false));
  }, [ed.loading, plan, engine, network.online, planId]);
  const dirty = ed.planRecord?.dirty || ed.sections.some((s) => s.dirty);

  if (ed.loading && !plan) {
    return (
      <>
        <PageHeader
          title={<span className="placeholder inline-block w-48 h-8" />}
          back={{ href: '/lessons', label: t('lessons.title') }}
        />
        <Placeholder rows={5} />
      </>
    );
  }
  if (!plan || !template) {
    return (
      <>
        <PageHeader
          title={t('lessons.title')}
          back={{ href: '/lessons', label: t('lessons.title') }}
        />
        {fetching ? (
          <Waiting label={t('editor.fetchingOlder')} />
        ) : (
          <Banner kind="warn">{t('editor.notFound')}</Banner>
        )}
      </>
    );
  }

  const locked = plan.state === 'locked';
  const dates = planDates(plan);
  const subtitle = [
    plan.subjectName,
    ed.cls?.name,
    dates.length ? dates.map((d) => formatDate(d, lang)).join(', ') : t('lessons.noDate'),
  ]
    .filter(Boolean)
    .join(' · ');
  const compCount = Object.values(plan.competencies).flat().length;

  const doLock = async () => {
    setBusy(true);
    const ok = await ed.lock();
    setBusy(false);
    if (ok) setLockOpen(false);
  };
  const doUnlock = async () => {
    setBusy(true);
    await ed.unlock();
    setBusy(false);
    setUnlockOpen(false);
  };

  return (
    <div className="flex flex-col gap-4 max-w-[52rem]">
      <PageHeader
        title={
          locked ? (
            <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">
              {plan.title || t('lessons.untitled')}
            </span>
          ) : (
            <label className="block">
              <span className="sr-only">{t('editor.title')}</span>
              {/* A wrapping, auto-growing one-field title (an <input> cannot wrap, so long titles were cut off). */}
              <textarea
                rows={1}
                className="w-full resize-none overflow-hidden bg-transparent border-b border-hairline focus:border-talaTeal text-display font-display leading-tight py-1 placeholder:text-forestMuted break-words [overflow-wrap:anywhere]"
                placeholder={t('editor.titlePlaceholder')}
                value={title ?? ''}
                maxLength={200}
                ref={(el) => {
                  if (el) {
                    // Grow with the text up to three lines; beyond that the field scrolls instead of pushing the page.
                    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 34;
                    const max = Math.round(lineHeight * 3 + 8);
                    el.style.height = '0px';
                    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
                    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                onChange={(e) => {
                  const v = e.target.value.replace(/[\r\n]+/g, ' ');
                  setTitle(v);
                  ed.savePlan({ title: v });
                }}
              />
            </label>
          )
        }
        subtitle={subtitle}
        back={{ href: '/lessons', label: t('lessons.title') }}
        action={
          <div className="flex gap-2 items-center">
            <Button variant="quiet" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
              {t('editor.moreActions')}
            </Button>
            {locked ? (
              <Button onClick={() => setUnlockOpen(true)}>{t('editor.unlock')}</Button>
            ) : (
              <Button variant="primary" onClick={() => setLockOpen(true)}>
                {t('editor.lock')}
              </Button>
            )}
          </div>
        }
      />

      <p className="text-small text-forestMuted" aria-live="polite">
        {ed.pendingCount > 0
          ? t('editor.saving')
          : dirty
            ? `${t('editor.saved')} · ${t('editor.waitingToSend')}`
            : t('editor.saved')}
      </p>

      {locked && plan.lock && (
        <Banner kind="info">
          🔒{' '}
          {t('editor.lockedBanner', {
            date: formatDate(plan.lock.lockedAt.slice(0, 10), lang),
            code: plan.lock.revisionCode,
          })}{' '}
          {t('editor.lockedReadOnly')}
          {plan.submitted && (
            <> · {t('editor.submitted', { date: formatDate(plan.submitted.date, lang) })}</>
          )}
        </Banner>
      )}
      {plan.conflictCopyOf && <Banner kind="warn">{t('editor.conflictCopy')}</Banner>}
      {plan.aiDraft && <Banner kind="warn">{t('editor.aiDraftBanner')}</Banner>}
      {conflicts.length > 0 && (
        <Banner
          kind="warn"
          action={
            <Button variant="primary" onClick={() => setConflict(conflicts[0]!)}>
              {t('common.edit')}
            </Button>
          }
        >
          {t('editor.conflictTitle')}
        </Banner>
      )}

      {/* Competencies / objectives */}
      <section className="rounded border border-hairline bg-white p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title">
            {ed.cls?.curriculum === 'none'
              ? t('editor.customObjectives')
              : t('editor.competencies')}
          </h2>
          {!locked && ed.cls?.curriculum !== 'none' && (
            <Button onClick={() => setPickerOpen(true)}>{t('editor.pickCompetency')}</Button>
          )}
        </div>
        {ed.cls?.curriculum === 'none' || (!plan.learningAreaId && compCount === 0) ? (
          <textarea
            aria-label={t('editor.customObjectives')}
            className="w-full min-h-[5rem] rounded border border-hairline px-3 py-2"
            placeholder={t('editor.customObjectivesHint')}
            readOnly={locked}
            defaultValue={plan.customObjectives.join('\n')}
            onChange={(e) =>
              ed.savePlan({
                customObjectives: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 30),
              })
            }
          />
        ) : compCount === 0 ? (
          <p className="text-forestMuted">{t('editor.noCompetency')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {Object.entries(plan.competencies).flatMap(([gid, ids]) =>
              ids.map((id) => {
                const c = ed.competencies.find((x) => x.id === id);
                const g = ed.groups.find((x) => x.id === gid);
                const tl = c ? topicLabel(c, lang) : null;
                return (
                  <li
                    key={gid + id}
                    className="flex flex-col gap-0.5 py-1 border-b border-hairline last:border-b-0"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {ed.groups.length > 1 && g && (
                        <Badge>{t('common.grade', { g: g.grade })}</Badge>
                      )}
                      <span className="font-medium">{tl ? tl.heading : id}</span>
                    </span>
                    {tl && (
                      <span className="text-small text-forestMuted">
                        {tl.code ? `${tl.code} · ` : ''}
                        {tl.text}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        )}
        <div className="max-w-[10rem]">
          <TextInput
            label={t('editor.duration')}
            hint={t('common.minutes', { n: plan.durationMinutes })}
            inputMode="numeric"
            readOnly={locked}
            defaultValue={String(plan.durationMinutes)}
            onChange={(e) =>
              ed.savePlan({
                durationMinutes: Math.max(5, Math.min(600, parseInt(e.target.value, 10) || 5)),
              })
            }
          />
        </div>
      </section>

      {/* Pre-class sections in template order; post-class ones under their own heading */}
      {(['pre', 'post'] as const).map((phase) => {
        const list = template.sections.filter((ts) => (phase === 'post') === !!ts.outsideLock);
        if (!list.length) return null;
        return (
          <div key={phase} className="flex flex-col gap-4">
            {phase === 'post' && (
              <div className="pt-2">
                <h2 className="text-title">{t('editor.afterClass')}</h2>
                <p className="text-small text-forestMuted">{t('editor.afterClassHint')}</p>
              </div>
            )}
            {list.map((ts) => {
              const rec = ed.sections.find((sec) => sec.data.key === ts.key);
              const readOnly = locked && !ts.outsideLock;
              const missing = ed.problems.some((p) => p.kind === 'empty' && p.key === ts.key);
              // Older plans have no record for a newer post-class section: edit a blank one and create it on first change.
              const data = rec?.data ?? {
                id: '',
                planId: plan.id,
                key: ts.key,
                content: blankContent(ts.contentType, plan.gradeGroupIds),
                origin: 'manual' as const,
                editedByTeacher: false,
                gen: null,
              };
              const onChange = async (c: SectionContent) => {
                if (rec) return ed.saveSection(rec.data, c);
                const created = await ed.ensureSection(ts.key, ts.contentType);
                if (created) ed.saveSection(created, c);
              };
              return (
                <section
                  key={ts.key}
                  aria-labelledby={`s-${ts.key}`}
                  className={cx(
                    'rounded border bg-white p-4 flex flex-col gap-3',
                    missing && !locked ? 'border-yellow' : 'border-hairline'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id={`s-${ts.key}`} className="text-title">
                      {ts.label[lang]}
                    </h2>
                    <span className="flex gap-2">
                      {ts.required && <Badge>{t('editor.required')}</Badge>}
                      {rec?.conflict && (
                        <Button variant="quiet" onClick={() => setConflict(rec)}>
                          ⚠ {t('lessons.conflictBadge')}
                        </Button>
                      )}
                    </span>
                  </div>
                  {!readOnly && !ts.outsideLock && canGenerate && ed.cls && rec && (
                    <div>
                      <Button variant="ai" onClick={() => setRegen(rec)}>
                        <Sparkle /> {t('gen.regen')}
                      </Button>
                    </div>
                  )}
                  <SectionEditor
                    content={data.content}
                    readOnly={readOnly}
                    groups={ed.groups}
                    label={ts.label[lang]}
                    durationMinutes={plan.durationMinutes}
                    onChange={(c: SectionContent) => void onChange(c)}
                  />
                </section>
              );
            })}
          </div>
        );
      })}

      {/* Lock sheet (DOC-1) */}
      <Sheet
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        title={t('editor.lockTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setLockOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void doLock()}
              disabled={ed.problems.length > 0}
              busy={busy}
            >
              {t('editor.lock')}
            </Button>
          </>
        }
      >
        <p>{t('editor.lockBody')}</p>
        {ed.problems.length > 0 && (
          <div className="rounded border border-yellow bg-cream p-3">
            <p className="font-medium">{t('editor.lockBlocked')}</p>
            <ul className="list-disc pl-6">
              {ed.problems.map((p, i) => (
                <li key={i}>
                  {p.kind === 'empty'
                    ? (template.sections.find((s) => s.key === p.key)?.label[lang] ?? p.key)
                    : p.kind === 'competency'
                      ? t('editor.lockNeedsCompetency')
                      : p.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Unlock sheet (DOC-3, DOC-6) */}
      <Sheet
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title={t('editor.unlockTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setUnlockOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={plan.submitted ? 'danger' : 'primary'}
              onClick={() => void doUnlock()}
              busy={busy}
            >
              {t('editor.unlock')}
            </Button>
          </>
        }
      >
        <p>{t('editor.unlockBody')}</p>
        {plan.submitted && <Banner kind="warn">{t('editor.unlockSubmitted')}</Banner>}
      </Sheet>

      <CompetencyPicker open={pickerOpen} onClose={() => setPickerOpen(false)} ed={ed} />
      <PdfSheet open={pdfOpen} onClose={() => setPdfOpen(false)} ed={ed} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        ed={ed}
        onPdf={() => {
          setMoreOpen(false);
          setPdfOpen(true);
        }}
        onPost={() => {
          setMoreOpen(false);
          setPostOpen(true);
        }}
        onGenerate={() => router.push(`/generate?planId=${plan.id}`)}
        onDeleted={() => router.replace('/lessons')}
      />
      <RegenSheet
        section={regen}
        onClose={() => setRegen(null)}
        ed={ed}
        onDone={(m) => setToast(m)}
      />
      <PostSheet
        open={postOpen}
        onClose={() => setPostOpen(false)}
        ed={ed}
        onPosted={(m) => setToast(m)}
      />
      <Toast
        message={toast === 'drafted' ? t('gen.done') : toast === 'queued' ? t('gen.queued') : toast}
        onDone={() => setToast(null)}
      />

      {/* Conflict: stacked versions, three plain choices (§10.5) */}
      <Sheet open={!!conflict} onClose={() => setConflict(null)} title={t('editor.conflictTitle')}>
        {conflict && (
          <>
            <p>{t('editor.conflictBody')}</p>
            <ConflictVersion
              label={t('editor.conflictThisDevice')}
              time={conflict.updatedAt}
              section={conflict.data}
              groups={ed.groups}
            />
            <ConflictVersion
              label={t('editor.conflictOtherDevice')}
              time={conflict.conflict!.server.updatedAt}
              section={conflict.conflict!.server.data}
              groups={ed.groups}
            />
            <div className="flex flex-col gap-2">
              {(['mine', 'theirs', 'both'] as const).map((choice) => (
                <Button
                  key={choice}
                  variant={choice === 'mine' ? 'primary' : 'secondary'}
                  full
                  onClick={async () => {
                    await engine?.resolveConflict('plan_section', conflict.id, choice);
                    setConflict(null);
                  }}
                >
                  {t(
                    `editor.conflict${choice === 'mine' ? 'Mine' : choice === 'theirs' ? 'Theirs' : 'Both'}`
                  )}
                </Button>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

function ConflictVersion({
  label,
  time,
  section,
  groups,
}: {
  label: string;
  time: string;
  section: PlanSection;
  groups: Array<{ id: string; grade: string }>;
}) {
  const { lang } = useT();
  return (
    <div className="rounded border border-hairline bg-cream/50 p-3">
      <p className="text-small text-forestMuted mb-1">
        <strong className="text-forest">{label}</strong> · {formatTime(time, lang)}
      </p>
      <div className="max-h-48 overflow-y-auto">
        <SectionEditor
          content={section.content}
          readOnly
          groups={groups}
          label={label}
          onChange={() => {}}
        />
      </div>
    </div>
  );
}

export { RichTextView };
