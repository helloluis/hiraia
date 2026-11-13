'use client';
/** Artifact detail: provenance, lineage credit, licence, "check before use", Copy, Report, Remove (own posts). */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BUILTIN_TEMPLATES, type ArtifactDetail } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { useWorkspace } from '@/data/records';
import { usePacks } from '@/data/curriculum';
import { packId as makePackId } from '@hiraia/tala-core/curriculum';
import { copyArtifact } from '@/data/community';
import { errorKey } from '@/data/errors';
import { SectionEditor } from '@/features/editor/SectionEditors';
import { Badge, Banner, Button, Choice, PageHeader, Placeholder, Select, Sheet, TextArea, Toast } from '@/components/ui';

type Reason = 'personal_data' | 'unsuitable' | 'copied_without_credit' | 'inaccurate' | 'spam' | 'other';
const REASONS: Reason[] = ['personal_data', 'unsuitable', 'copied_without_credit', 'inaccurate', 'spam', 'other'];

export function ArtifactScreen({ artifactId }: { artifactId: string }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { engine, network } = useSession();
  const ws = useWorkspace();
  const [a, setA] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'copy' | 'report' | 'remove'>('none');
  const [classId, setClassId] = useState('');
  const [reason, setReason] = useState<Reason>('personal_data');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const online = network.online && network.rung !== 'offline';

  useEffect(() => {
    if (!online) return;
    let alive = true;
    getClient()
      .call('community.get', { params: { artifactId }, query: {} })
      .then(r => alive && setA(r))
      .catch(err => alive && setError(err?.code === 'not_found' ? t('com.notFound') : t(errorKey(err))));
    return () => {
      alive = false;
    };
  }, [artifactId, online, t]);
  useEffect(() => {
    if (!classId && ws.classes[0]) setClassId(ws.classes.find(c => !c.isSample)?.id ?? ws.classes[0].id);
  }, [ws.classes, classId]);
  // Competency text comes from the stored curriculum packs, never from the artifact (CUR-9).
  const packIds = a?.tags.curriculumVersion && a.tags.learningAreaId ? a.tags.grades.map(g => makePackId(a.tags.curriculumVersion!, g, a.tags.learningAreaId!)) : [];
  const { competencies } = usePacks(packIds);
  const compText = (id: string) => {
    const c = competencies.find(x => x.id === id);
    return c ? `${c.code ? c.code + ' · ' : ''}${c.text}` : id;
  };

  if (!online) return <Banner kind="info">{t('com.offline')}</Banner>;
  if (error) {
    return (
      <>
        <PageHeader title={t('com.title')} back={{ href: '/community', label: t('com.title') }} />
        <Banner kind="warn">{error}</Banner>
      </>
    );
  }
  if (!a) return <Placeholder rows={6} />;

  const template = a.version.template ?? BUILTIN_TEMPLATES.find(x => x.id === a.version.templateId) ?? BUILTIN_TEMPLATES[0]!;
  const groups = a.version.gradeGroups.map(g => ({ id: g.id, grade: g.grade }));

  const copy = async () => {
    const cls = ws.classes.find(c => c.id === classId);
    if (!engine || !cls) return;
    setBusy(true);
    try {
      const id = await copyArtifact(engine, getClient(), a.id, cls);
      router.push(`/lessons/${id}`);
    } catch (err) {
      setToast(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  const report = async () => {
    setBusy(true);
    try {
      await getClient().call('community.report', { params: { artifactId: a.id }, body: { reason, note } });
      setToast(t('com.reported'));
      setSheet('none');
    } catch (err) {
      setToast(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await getClient().call('community.remove', { params: { artifactId: a.id } });
      router.replace('/community');
    } catch (err) {
      setToast(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 max-w-[52rem]">
      <PageHeader
        title={a.title}
        subtitle={`${t('com.by', { name: a.authorDisplayName })}${a.authorSchool ? ` · ${a.authorSchool}` : ''}${a.tags.region ? ` · ${a.tags.region}` : ''}`}
        back={{ href: '/community', label: t('com.title') }}
        action={
          <Button variant="primary" onClick={() => setSheet('copy')} disabled={!ws.classes.length}>
            {t('com.copy')}
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge>{a.provenance.aiDrafted ? t('com.aiDrafted') : a.provenance.adapted ? t('com.adapted') : t('com.original')}</Badge>
        <Badge>{a.tags.subjectName}</Badge>
        {a.tags.grades.map(g => (
          <Badge key={g}>{t('common.grade', { g })}</Badge>
        ))}
        {a.tags.termIndex && <Badge>Q{a.tags.termIndex}</Badge>}
        <Badge>{t('com.duration', { n: a.tags.durationMinutes })}</Badge>
        <Badge>{t(`lang.${a.tags.language}`)}</Badge>
        <Badge>{t('com.copies', { n: a.copyCount })}</Badge>
        <Badge>{t('com.version', { n: a.versionNumber })}</Badge>
        {a.mine && <Badge tone="teal">{t(`com.status.${a.status}`)}</Badge>}
      </div>
      {a.lineage && (
        <p className="text-small">
          {t('com.adaptedFrom', { title: a.lineage.title, author: a.lineage.authorDisplayName })}
          {a.lineage.available ? '' : ` (${t('com.sourceUnavailable')})`}
        </p>
      )}
      {a.summary && <p>{a.summary}</p>}
      <Banner kind="info">{t('com.checkNotice')}</Banner>
      {a.mine && a.moderation?.decision === 'return' && (
        <Banner kind="warn">
          {t('com.returned')}
          <ul className="list-disc pl-5">
            {a.moderation.reasons.map((r, i) => (
              <li key={i}>
                {r.message}
                {r.sectionKey ? ` (${t('com.in')} ${template.sections.find(s => s.key === r.sectionKey)?.label[lang] ?? r.sectionKey})` : ''}
                {r.excerpt ? `: “${r.excerpt}”` : ''}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <h2 className="text-title">{t('com.preview')}</h2>
      {Object.keys(a.version.competencies).length > 0 && (
        <ul className="list-disc pl-5 text-small">
          {Object.entries(a.version.competencies).flatMap(([gid, ids]) =>
            ids.map(id => (
              <li key={gid + id}>
                {groups.length > 1 ? `${t('common.grade', { g: groups.find(g => g.id === gid)?.grade ?? '' })}: ` : ''}
                {compText(id)}
              </li>
            )),
          )}
        </ul>
      )}
      {a.version.customObjectives.length > 0 && (
        <ul className="list-disc pl-5 text-small">
          {a.version.customObjectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {template.sections.map(ts => {
        const s = a.version.sections.find(x => x.key === ts.key);
        if (!s) return null;
        return (
          <section key={ts.key} className="rounded border border-hairline bg-white p-3">
            <h3 className="font-medium mb-2">{ts.label[lang]}</h3>
            <SectionEditor content={s.content} readOnly groups={groups} label={ts.label[lang]} onChange={() => {}} />
          </section>
        );
      })}
      <p className="text-small text-forestMuted">{t('com.license')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" onClick={() => setSheet('report')}>
          ⚑ {t('com.report')}
        </Button>
        {a.mine && (
          <Button variant="danger" onClick={() => setSheet('remove')}>
            {t('com.remove')}
          </Button>
        )}
      </div>

      <Sheet
        open={sheet === 'copy'}
        onClose={() => setSheet('none')}
        title={t('com.copy')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setSheet('none')}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void copy()} busy={busy} disabled={!classId}>
              {t('com.copy')}
            </Button>
          </>
        }
      >
        <Select label={t('com.copyInto')} value={classId} onChange={e => setClassId(e.target.value)}>
          {ws.classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <p className="text-small text-forestMuted">{t('com.license')}</p>
      </Sheet>
      <Sheet
        open={sheet === 'report'}
        onClose={() => setSheet('none')}
        title={t('com.reportTitle')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setSheet('none')}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void report()} busy={busy}>
              {t('com.report')}
            </Button>
          </>
        }
      >
        <p>{t('com.reportBody')}</p>
        <Choice label={t('com.reportTitle')} value={reason} onChange={setReason} options={REASONS.map(r => ({ value: r, label: t(`com.reportReason.${r}`) }))} />
        <TextArea label={t('com.reportNote')} optional value={note} maxLength={600} onChange={e => setNote(e.target.value)} />
      </Sheet>
      <Sheet
        open={sheet === 'remove'}
        onClose={() => setSheet('none')}
        title={t('com.remove')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setSheet('none')}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void remove()} busy={busy}>
              {t('com.remove')}
            </Button>
          </>
        }
      >
        <p>{t('com.removeBody')}</p>
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
