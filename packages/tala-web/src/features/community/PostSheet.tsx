'use client';
/** Post a locked plan (COM-1, DOC-7): the pre-post screen shows exactly what will be public, with early warnings. */
import { useEffect, useMemo, useState } from 'react';
import type { ModerationDecision } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { useRecords } from '@/data/records';
import { prePostReview } from '@/data/community';
import { errorKey } from '@/data/errors';
import { SectionEditor } from '@/features/editor/SectionEditors';
import type { PlanEditor } from '@/features/editor/usePlanEditor';
import {
  Banner,
  Button,
  Checkbox,
  Sheet,
  Switch,
  TextArea,
  TextInput,
  Waiting,
} from '@/components/ui';

export function PostSheet({
  open,
  onClose,
  ed,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  ed: PlanEditor;
  onPosted: (message: string) => void;
}) {
  const { t, lang } = useT();
  const { user, network } = useSession();
  const students = useRecords('student');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showSchool, setShowSchool] = useState(false);
  const [affirmed, setAffirmed] = useState(false);
  const [license, setLicense] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState<ModerationDecision | null>(null);
  useEffect(() => {
    if (!open || !ed.plan) return;
    setTitle(ed.plan.title);
    setDisplayName(ed.ws.profile?.displayName ?? user?.displayName ?? '');
    setReturned(null);
    setError(null);
  }, [open, ed.plan, ed.ws.profile, user]);

  const review = useMemo(() => {
    if (!ed.plan || !ed.template) return null;
    return prePostReview({
      plan: ed.plan,
      sections: ed.sections.map((s) => s.data),
      template: ed.template,
      cls: ed.cls,
      schoolName: ed.ws.activeYear?.schoolName || ed.ws.profile?.schoolName || '',
      teacherName: ed.ws.profile?.displayName ?? '',
      includeSchoolName: showSchool,
      students: students.items.map((s) => s.data),
      title,
      summary,
    });
  }, [
    ed.plan,
    ed.template,
    ed.sections,
    ed.cls,
    ed.ws,
    showSchool,
    students.items,
    title,
    summary,
  ]);

  if (!ed.plan || !ed.template) return null;
  const locked = ed.plan.state === 'locked';
  const sample = !!ed.cls?.isSample;
  const online = network.online && network.rung !== 'offline';
  const canPost =
    locked &&
    !sample &&
    user?.emailVerified &&
    affirmed &&
    license &&
    title.trim().length >= 3 &&
    review &&
    !review.blocking;
  const groups = review?.snapshot.gradeGroups.map((g) => ({ id: g.id, grade: g.grade })) ?? [];

  const post = async () => {
    if (!ed.plan) return;
    setBusy(true);
    setError(null);
    try {
      const termIndex =
        ed.ws.activeYear?.terms.find(
          (x) =>
            x.startDate <= (ed.plan!.placements[0]?.dates[0] ?? '') &&
            x.endDate >= (ed.plan!.placements[0]?.dates[0] ?? '')
        )?.index ?? null;
      const r = await getClient().call('community.post', {
        body: {
          planId: ed.plan.id,
          title: title.trim(),
          summary: summary.trim(),
          displayName: displayName.trim(),
          showSchool,
          region: ed.ws.profile?.region || null,
          termIndex,
          licenseAccepted: true,
          affirmed: true,
        },
      });
      if (r.moderation.decision === 'return') {
        setReturned(r.moderation);
        return;
      }
      onPosted(r.moderation.decision === 'pending' ? t('com.postedPending') : t('com.posted'));
      onClose();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('com.post')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void post()}
            disabled={!canPost || !online}
            busy={busy}
          >
            {t('com.post')}
          </Button>
        </>
      }
    >
      {!locked && <Banner kind="warn">{t('com.postNeedsLock')}</Banner>}
      {sample && <Banner kind="warn">{t('com.postSample')}</Banner>}
      {!user?.emailVerified && <Banner kind="warn">{t('com.postNeedsVerified')}</Banner>}
      {!online && <Banner kind="info">{t('network.offline')}</Banner>}
      <TextInput
        label={t('editor.title')}
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <TextArea
        label={t('com.postSummary')}
        optional
        value={summary}
        maxLength={600}
        onChange={(e) => setSummary(e.target.value)}
      />
      <TextInput
        label={t('com.postName')}
        value={displayName}
        maxLength={120}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <Switch label={t('com.showSchool')} checked={showSchool} onChange={setShowSchool} />
      {returned && (
        <Banner kind="warn">
          {t('com.returned')}
          <ul className="list-disc pl-5">
            {returned.reasons.map((r, i) => (
              <li key={i}>
                {r.message}
                {r.sectionKey
                  ? ` (${t('com.in')} ${ed.template!.sections.find((s) => s.key === r.sectionKey)?.label[lang] ?? r.sectionKey})`
                  : ''}
                {r.excerpt ? `: “${r.excerpt}”` : ''}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {review && review.findings.length > 0 && (
        <Banner kind={review.blocking ? 'error' : 'warn'}>
          <strong>{t('com.warnings')}</strong>
          <ul className="list-disc pl-5">
            {review.findings.map((f, i) => (
              <li key={i}>
                {f.message} ({t('com.in')}{' '}
                {ed.template!.sections.find((s) => s.key === f.sectionKey)?.label[lang] ??
                  f.sectionKey}
                ): “{f.excerpt}”
              </li>
            ))}
          </ul>
          {review.blocking && <p>{t('com.blocking')}</p>}
        </Banner>
      )}
      <h3 className="text-title">{t('com.postTitle')}</h3>
      <p className="text-small text-forestMuted">{t('com.postIntro')}</p>
      {review && (
        <div className="max-h-[40vh] overflow-y-auto rounded border border-hairline bg-cream/50 p-2 flex flex-col gap-2">
          <p className="font-medium">{title}</p>
          {review.snapshot.sections.map((s) => (
            <section key={s.key} className="rounded border border-hairline bg-white p-2">
              <h4 className="font-medium text-small mb-1">
                {ed.template!.sections.find((x) => x.key === s.key)?.label[lang] ?? s.key}
              </h4>
              <SectionEditor
                content={s.content}
                readOnly
                groups={groups}
                label={s.key}
                onChange={() => {}}
              />
            </section>
          ))}
        </div>
      )}
      {busy && <Waiting label={t('common.waiting')} />}
      {error && <Banner kind="error">{error}</Banner>}
      <Checkbox label={t('com.affirm')} checked={affirmed} onChange={setAffirmed} />
      <Checkbox label={t('com.acceptLicense')} checked={license} onChange={setLicense} />
      <p className="text-small text-forestMuted">{t('com.removeBody')}</p>
    </Sheet>
  );
}
