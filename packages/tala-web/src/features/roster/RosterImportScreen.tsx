'use client';
/**
 * Roster import (PRD §12.3 review flow, §12.4.1 flagged cloud route, PRIV-2/PRIV-7).
 * Steps: input (paste or file) → notice/flag → draft → columns → review (needs-review first, then changed) → save.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterImportDraft, RosterProposed, RosterRow } from '@hiraia/tala-core/contracts';
import { rosterNotices } from '@hiraia/tala-core/roster';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { useWorkspace } from '@/data/records';
import { newId } from '@/data/ids';
import { errorKey } from '@/data/errors';
import { buildConfirm, emptyProposed, flagsToKeys, groupRows, proposedToStudent, readRosterFile, saveStudents, unresolvedRows, type Resolution } from '@/data/roster';
import { Badge, Banner, Button, Checkbox, LinkButton, PageHeader, Placeholder, Select, Sheet, TextArea, TextInput, Waiting, cx } from '@/components/ui';

const FIELDS = ['fullName', 'familyName', 'givenName', 'middleName', 'suffix', 'sex', 'grade', 'localId', 'ignore', 'drop'] as const;
type Field = (typeof FIELDS)[number];
type Step = 'input' | 'review' | 'done';

export function RosterImportScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { engine, config, user, network } = useSession();
  const ws = useWorkspace();
  const [classId, setClassId] = useState(params.get('classId') ?? '');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [exactly, setExactly] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [draft, setDraft] = useState<RosterImportDraft | null>(null);
  const [resolutions, setResolutions] = useState<Map<number, Resolution>>(new Map());
  const [viewedChanged, setViewedChanged] = useState(false);
  const [acceptAllChanged, setAcceptAllChanged] = useState(false);
  const [defaultGroup, setDefaultGroup] = useState('');
  const [editing, setEditing] = useState<{ row: RosterRow; action: 'edit' | 'split' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ n: number; pending: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const idemKey = useRef(newId());

  useEffect(() => {
    if (!ws.classes.some(c => c.id === classId) && ws.classes[0]) setClassId(ws.classes.find(c => !c.isSample)?.id ?? ws.classes[0].id);
  }, [ws.classes, classId]);
  const cls = ws.classes.find(c => c.id === classId) ?? null;
  useEffect(() => {
    if (cls && !cls.gradeGroups.some(g => g.id === defaultGroup)) setDefaultGroup(cls.gradeGroups[0]?.id ?? '');
  }, [cls, defaultGroup]);

  const route = config?.rosterLlmRoute ?? 'rules';
  const cloud = route === 'cloud';
  const online = network.online && network.rung !== 'offline';
  const groups = useMemo(() => (draft ? groupRows(draft.rows) : null), [draft]);
  const unresolved = draft ? unresolvedRows(draft, resolutions) : [];

  const start = async (useAi: boolean) => {
    if (!cls) return;
    setError(null);
    setBusy(t('roster.reading'));
    const c = new AbortController();
    ctrl.current = c;
    try {
      let body: { text?: string; contentBase64?: string } = {};
      if (file) {
        try {
          body = await readRosterFile(file);
        } catch {
          setError(t('roster.tooBig'));
          return;
        }
      } else body = { text };
      const d = await getClient().call('roster.import', {
        body: { classId: cls.id, filename: file?.name ?? 'pasted.txt', ...body, useAi, cloudFlagAcknowledged: useAi && cloud, exactlyAsWritten: exactly },
        signal: c.signal,
      });
      setDraft(d);
      setResolutions(new Map());
      setStep('review');
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      const key = errorKey(err);
      setError(key === 'error.generic' && file ? t('roster.cannotRead') : t(key));
    } finally {
      setBusy(null);
    }
  };

  const remap = async (index: number, field: Field) => {
    if (!draft) return;
    setBusy(t('roster.reading'));
    try {
      const columns = draft.columns.map(c => ({ index: c.index, field: c.index === index ? field : c.field }));
      const d = await getClient().call('roster.remap', { params: { importId: draft.importId }, body: { columns } });
      setDraft(d);
      setResolutions(new Map());
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const resolve = (row: RosterRow, action: Resolution['action'], students?: RosterProposed[]) => {
    setResolutions(m => new Map(m).set(row.rowIndex, { rowIndex: row.rowIndex, action, students }));
    setEditing(null);
  };

  const save = async (onlyResolved: boolean) => {
    if (!draft || !engine || !cls) return;
    setBusy(t('common.waiting'));
    setError(null);
    try {
      const body = buildConfirm(draft, resolutions, { acceptAllChanged: acceptAllChanged && viewedChanged, defaultGradeGroupId: defaultGroup || null, idempotencyKey: idemKey.current, onlyResolved });
      const res = await getClient().call('roster.confirm', { params: { importId: draft.importId }, body });
      const existing = ws.loading ? 0 : 0;
      const students = res.students.map((p, i) => proposedToStudent(p, cls.id, existing + i, draft.importId, newId));
      await saveStudents(engine, students);
      setSaved({ n: students.length, pending: res.pendingRows.length });
      setStep('done');
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const abandon = async () => {
    if (draft) await getClient().call('roster.abandon', { params: { importId: draft.importId } }).catch(() => {});
    router.replace('/class/roster');
  };

  if (ws.loading) return <Placeholder rows={5} />;
  if (!cls) {
    return (
      <>
        <PageHeader title={t('roster.title')} back={{ href: '/class', label: t('class.title') }} />
        <Banner kind="info" action={<LinkButton href="/setup">{t('class.addClass')}</LinkButton>}>
          {t('class.none')}
        </Banner>
      </>
    );
  }

  /* ---------- input ---------- */
  if (step === 'input') {
    const notice = cloud ? rosterNotices.cloud[lang] : route === 'local' ? rosterNotices.local[lang] : rosterNotices.rules[lang];
    const hasInput = !!file || text.trim().length > 0;
    return (
      <div className="flex flex-col gap-4 max-w-[40rem]">
        <PageHeader title={t('roster.title')} back={{ href: '/class/roster', label: t('roster.learners') }} />
        <p>{t('roster.intro')}</p>
        {!user?.emailVerified && (
          <Banner kind="warn" action={<LinkButton href="/verify-email">{t('settings.verifyNow')}</LinkButton>}>
            {t('roster.needsVerified')}
          </Banner>
        )}
        {!online && <Banner kind="info">{t('network.offline')}</Banner>}
        {ws.classes.length > 1 && (
          <Select label={t('lessons.class')} value={classId} onChange={e => setClassId(e.target.value)}>
            {ws.classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {cls.isSample && <Banner kind="info">{t('roster.sampleBlocked')}</Banner>}
        <TextArea label={t('roster.pasteLabel')} hint={t('roster.pasteHint')} value={text} onChange={e => setText(e.target.value)} rows={8} disabled={!!file} />
        <div className="flex flex-col gap-1">
          <label htmlFor="roster-file" className="font-medium">
            {t('roster.file')}
          </label>
          <p className="text-small text-forestMuted">{t('roster.fileHint')}</p>
          <input id="roster-file" type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,.ods,.docx,text/plain,text/csv" className="min-h-touch" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file && (
            <Button variant="quiet" className="self-start" onClick={() => setFile(null)}>
              ✕ {file.name}
            </Button>
          )}
        </div>
        <Checkbox label={`${t('roster.exactly')} — ${t('roster.exactlyHint')}`} checked={exactly} onChange={setExactly} />
        <section className={cx('rounded border-l-4 border p-3 bg-white', cloud ? 'border-brick' : 'border-talaTeal')}>
          <h2 className="font-medium mb-1">{cloud ? t('roster.cloudTitle') : t('roster.privacyTitle')}</h2>
          <p className="text-small">{notice}</p>
        </section>
        {error && <Banner kind="error">{error}</Banner>}
        {busy ? (
          <Waiting label={busy} onCancel={() => ctrl.current?.abort()} />
        ) : cloud && !exactly ? (
          <div className="flex flex-col gap-2">
            <Button variant="primary" full onClick={() => void start(false)} disabled={!hasInput || !online || !user?.emailVerified}>
              {t('roster.cleanNoAi')}
            </Button>
            <Button full onClick={() => void start(true)} disabled={!hasInput || !online || !user?.emailVerified}>
              {t('roster.cleanAi')}
            </Button>
          </div>
        ) : (
          <Button variant="primary" full onClick={() => void start(route !== 'rules' && !exactly)} disabled={!hasInput || !online || !user?.emailVerified}>
            {t('common.next')}
          </Button>
        )}
      </div>
    );
  }

  /* ---------- done ---------- */
  if (step === 'done' && saved) {
    return (
      <div className="flex flex-col gap-4 max-w-[40rem]">
        <PageHeader title={t('roster.title')} />
        <Banner kind="success">{t('roster.saved', { n: saved.n })}</Banner>
        {saved.pending > 0 && <Banner kind="warn">{t('roster.pendingLeft', { n: saved.pending })}</Banner>}
        <LinkButton href="/class/roster" variant="primary" full>
          {t('roster.learners')}
        </LinkButton>
      </div>
    );
  }

  /* ---------- review ---------- */
  if (!draft || !groups) return <Placeholder rows={5} />;
  const canSaveAll = unresolved.length === 0 && (groups.changed.length === 0 || viewedChanged);
  const resolvedCount = draft.rows.filter(r => (r.status === 'clean' || (r.status === 'changed' && acceptAllChanged && viewedChanged) || resolutions.get(r.rowIndex)) && resolutions.get(r.rowIndex)?.action !== 'not_student').length;

  return (
    <div className="flex flex-col gap-4 max-w-[48rem]">
      <PageHeader title={t('roster.title')} subtitle={cls.name} />
      <p className="text-small">
        <Badge tone={draft.aiUsed && draft.route === 'cloud' ? 'brick' : 'neutral'}>{draft.aiUsed ? (draft.route === 'cloud' ? t('roster.aiMark') : rosterNotices.local[lang].slice(0, 0) || t('roster.rulesMark')) : t('roster.rulesMark')}</Badge>
      </p>
      <Banner kind="info">{t('roster.counts', { lines: draft.counts.linesRead, students: draft.counts.students, review: draft.counts.needsReview, notStudents: draft.counts.notStudents })}</Banner>
      {draft.droppedColumns.length > 0 && <Banner kind="warn">{t('roster.dropped', { cols: draft.droppedColumns.join(', ') })}</Banner>}

      {draft.columns.length > 0 && (
        <details className="rounded border border-hairline bg-white">
          <summary className="min-h-touch px-3 py-2 cursor-pointer font-medium flex items-center">{t('roster.columns')}</summary>
          <div className="px-3 pb-3 flex flex-col gap-2">
            <p className="text-small text-forestMuted">{t('roster.columnsHint')}</p>
            {draft.columns.map(c => (
              <Select key={c.index} label={c.header || `#${c.index + 1}`} value={c.field} onChange={e => void remap(c.index, e.target.value as Field)}>
                {FIELDS.map(f => (
                  <option key={f} value={f}>
                    {t(`roster.col.${f}`)}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        </details>
      )}

      {cls.gradeGroups.length > 1 && (
        <Select label={t('roster.defaultGroup')} value={defaultGroup} onChange={e => setDefaultGroup(e.target.value)}>
          {cls.gradeGroups.map(g => (
            <option key={g.id} value={g.id}>
              {t('common.grade', { g: g.grade })}
            </option>
          ))}
        </Select>
      )}

      {/* Needs review first */}
      {groups.needsReview.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title">
            {t('roster.needsReview')} <Badge tone="brick">{unresolved.length}</Badge>
          </h2>
          {groups.needsReview.map(row => {
            const res = resolutions.get(row.rowIndex);
            return (
              <div key={row.rowIndex} className={cx('rounded border bg-white p-3 flex flex-col gap-2', res ? 'border-sage' : 'border-yellow')}>
                <RowCompare row={row} />
                <p className="text-small">
                  <strong>{t('roster.reason')}:</strong> {flagsToKeys(row).map(f => t(`roster.flag.${f}` as never)).join('; ')}
                </p>
                {row.removed.length > 0 && <p className="text-small text-forestMuted">{t('roster.removed', { items: row.removed.join(', ') })}</p>}
                {res ? (
                  <p className="text-small">
                    ✓ {t(`roster.act.${res.action}`)}{' '}
                    <Button variant="quiet" onClick={() => setResolutions(m => { const n = new Map(m); n.delete(row.rowIndex); return n; })}>
                      {t('common.undo')}
                    </Button>
                  </p>
                ) : (
                  <div className="grid grid-cols-1 min-[400px]:grid-cols-2 wide:grid-cols-5 gap-2">
                    <Button onClick={() => resolve(row, 'accept')}>{t('roster.act.accept')}</Button>
                    <Button onClick={() => setEditing({ row, action: 'edit' })}>{t('roster.act.edit')}</Button>
                    <Button onClick={() => setEditing({ row, action: 'split' })}>{t('roster.act.split')}</Button>
                    <Button onClick={() => resolve(row, 'not_student')}>{t('roster.act.not_student')}</Button>
                    <Button onClick={() => resolve(row, 'keep_original')}>{t('roster.act.keep_original')}</Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Changed rows: before / after, accepted together after viewing */}
      {groups.changed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title">
            {t('roster.changed')} <Badge>{groups.changed.length}</Badge>
          </h2>
          {groups.changed.map(row => (
            <div key={row.rowIndex} className="rounded border border-hairline bg-white p-3 flex flex-col gap-1">
              <RowCompare row={row} beforeAfter />
              {resolutions.get(row.rowIndex) ? (
                <p className="text-small">✓ {t(`roster.act.${resolutions.get(row.rowIndex)!.action}`)}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={() => setEditing({ row, action: 'edit' })}>
                    {t('roster.act.edit')}
                  </Button>
                  <Button variant="quiet" onClick={() => resolve(row, 'keep_original')}>
                    {t('roster.act.keep_original')}
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Checkbox label={t('roster.viewedChanged')} checked={viewedChanged} onChange={setViewedChanged} />
          <Checkbox label={t('roster.acceptAllChanged')} checked={acceptAllChanged} onChange={setAcceptAllChanged} disabled={!viewedChanged} />
        </section>
      )}

      {groups.clean.length > 0 && (
        <details className="rounded border border-hairline bg-white">
          <summary className="min-h-touch px-3 py-2 cursor-pointer font-medium flex items-center">
            {t('roster.clean')} ({groups.clean.length})
          </summary>
          <ul className="px-3 pb-3 text-small">
            {groups.clean.map(r => (
              <li key={r.rowIndex} className="py-1 border-b border-hairline last:border-b-0">
                {r.proposed.displayName}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <Banner kind="error">{error}</Banner>}
      {busy && <Waiting label={busy} />}
      {!canSaveAll && unresolved.length > 0 && <p className="text-small text-forestMuted">{t('roster.unresolved')}</p>}
      <div className="flex flex-col gap-2">
        <Button variant="primary" full onClick={() => void save(false)} disabled={!canSaveAll || !!busy}>
          {t('roster.save', { n: resolvedCount })}
        </Button>
        {unresolved.length > 0 && (
          <Button full onClick={() => void save(true)} disabled={!!busy}>
            {t('roster.savePartial', { n: unresolved.length })}
          </Button>
        )}
        <Button variant="quiet" onClick={() => void abandon()}>
          {t('roster.abandon')}
        </Button>
      </div>

      <EditRowSheet editing={editing} onClose={() => setEditing(null)} onSave={(row, action, students) => resolve(row, action, students)} />
    </div>
  );
}

function RowCompare({ row, beforeAfter }: { row: RosterRow; beforeAfter?: boolean }) {
  const { t } = useT();
  const p = row.proposed;
  const proposed = [p.familyName && `${p.familyName},`, p.givenName, p.middleName, p.suffix].filter(Boolean).join(' ') || p.displayName;
  return (
    <div className="grid gap-1 wide:grid-cols-2">
      <p className="text-small">
        <span className="text-forestMuted">{beforeAfter ? t('roster.before') : t('roster.original')}:</span> <span className="font-mono break-words">{row.original}</span>
      </p>
      <p className="text-small">
        <span className="text-forestMuted">{beforeAfter ? t('roster.after') : t('roster.proposed')}:</span> <strong>{proposed}</strong>
        {p.grade ? ` · ${t('common.grade', { g: p.grade })}` : ''}
        {p.sex ? ` · ${p.sex}` : ''}
      </p>
    </div>
  );
}

function EditRowSheet({ editing, onClose, onSave }: { editing: { row: RosterRow; action: 'edit' | 'split' } | null; onClose: () => void; onSave: (row: RosterRow, action: 'edit' | 'split', students: RosterProposed[]) => void }) {
  const { t } = useT();
  const [people, setPeople] = useState<RosterProposed[]>([]);
  useEffect(() => {
    if (!editing) return;
    setPeople(editing.action === 'edit' ? [{ ...editing.row.proposed }] : [{ ...editing.row.proposed }, emptyProposed()]);
  }, [editing]);
  if (!editing) return null;
  const set = (i: number, patch: Partial<RosterProposed>) => setPeople(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const valid = people.every(p => (p.givenName || p.familyName || p.displayName).trim().length > 0);
  return (
    <Sheet
      open={!!editing}
      onClose={onClose}
      title={editing.action === 'edit' ? t('roster.act.edit') : t('roster.act.split')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(editing.row, editing.action, people.map(p => ({ ...p, displayName: p.displayName || [p.givenName, p.middleName, p.familyName, p.suffix].filter(Boolean).join(' ') })))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="text-small text-forestMuted">
        {t('roster.original')}: <span className="font-mono">{editing.row.original}</span>
      </p>
      {people.map((p, i) => (
        <fieldset key={i} className="rounded border border-hairline p-2 flex flex-col gap-2">
          {people.length > 1 && <legend className="font-medium px-1">{t('roster.splitName', { n: i + 1 })}</legend>}
          <div className="grid grid-cols-2 gap-2">
            <TextInput label={t('roster.familyName')} value={p.familyName} onChange={e => set(i, { familyName: e.target.value, displayName: '' })} />
            <TextInput label={t('roster.givenName')} value={p.givenName} onChange={e => set(i, { givenName: e.target.value, displayName: '' })} />
            <TextInput label={t('roster.middleName')} optional value={p.middleName} onChange={e => set(i, { middleName: e.target.value, displayName: '' })} />
            <TextInput label={t('roster.suffix')} optional value={p.suffix} onChange={e => set(i, { suffix: e.target.value, displayName: '' })} />
          </div>
        </fieldset>
      ))}
      {editing.action === 'split' && people.length < 4 && <Button onClick={() => setPeople(ps => [...ps, emptyProposed()])}>+ {t('common.add')}</Button>}
    </Sheet>
  );
}
