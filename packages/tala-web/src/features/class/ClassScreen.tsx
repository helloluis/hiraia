'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  ClassProfile,
  ClassRecord,
  PacingParams,
  PacingTrack,
  TeachingAssignment,
} from '@hiraia/tala-core/contracts';
import { DEFAULT_PACING_PARAMS } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useWorkspace } from '@/data/records';
import { useRecords } from '@/data/records';
import { removeSampleClasses } from '@/data/sample';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  LinkButton,
  List,
  ListRow,
  PageHeader,
  Placeholder,
  SectionTitle,
  Select,
  Sheet,
  Switch,
  TextArea,
  TextInput,
  Toast,
} from '@/components/ui';
import { DayPicker } from '@/features/setup/DayPicker';
import { meetingDays, slotsForDays, tracksToRepace } from './timetable';

/** Class screen (PRD §8): grade groups, timetable, profile; pacing adjustments behind "Advanced" (SIMPLE-4). */
export function ClassScreen() {
  const { t } = useT();
  const router = useRouter();
  const { engine, config } = useSession();
  const ws = useWorkspace();
  const students = useRecords('student');
  const [classId, setClassId] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [editingSlots, setEditingSlots] = useState<TeachingAssignment | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (!ws.classes.some((c) => c.id === classId) && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws.classes, classId]);
  const cls = ws.classes.find((c) => c.id === classId) ?? null;
  const assignments = useMemo(
    () => ws.assignments.filter((a) => a.classId === classId),
    [ws.assignments, classId]
  );
  const learnerCount = students.items.filter((s) => s.data.classId === classId).length;

  const save = async (patch: Partial<ClassRecord>) => {
    if (!engine || !cls) return;
    await engine.put('class', { ...cls, ...patch });
  };
  const saveProfile = (patch: Partial<ClassProfile>) =>
    save({ profile: { ...cls!.profile, ...patch } });

  if (ws.loading) {
    return (
      <>
        <PageHeader title={t('class.title')} />
        <Placeholder rows={5} />
      </>
    );
  }
  if (!cls) {
    return (
      <>
        <PageHeader title={t('class.title')} />
        <Banner
          kind="info"
          action={
            <LinkButton href="/setup" variant="primary">
              {t('class.addClass')}
            </LinkButton>
          }
        >
          {t('class.none')}
        </Banner>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-[44rem]">
      <PageHeader
        title={cls.name}
        action={<LinkButton href="/setup?new=class">+ {t('class.addClass')}</LinkButton>}
      />
      {ws.classes.length > 1 && (
        <Select
          label={t('class.switch')}
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
        >
          {ws.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {cls.isSample && (
        <Banner
          kind="warn"
          action={
            <Button
              variant="danger"
              onClick={async () => {
                if (!engine) return;
                await removeSampleClasses(engine);
                setToast(t('class.sampleRemoved'));
              }}
            >
              {t('class.removeSample')}
            </Button>
          }
        >
          {t('class.sampleBanner')}
        </Banner>
      )}

      <TextInput
        label={t('class.name')}
        defaultValue={cls.name}
        onBlur={(e) =>
          e.target.value.trim() &&
          e.target.value !== cls.name &&
          void save({ name: e.target.value.trim() })
        }
      />

      <SectionTitle>{t('class.gradeGroups')}</SectionTitle>
      <List>
        {cls.gradeGroups.map((g) => (
          <div
            key={g.id}
            className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-hairline last:border-b-0"
          >
            <span className="flex-1 font-medium">
              {g.grade === 'K' ? t('common.kinder') : t('common.grade', { g: g.grade })}
            </span>
            <label className="flex items-center gap-2 text-small">
              {t('setup.learners')}
              <input
                className="w-20 min-h-touch rounded border border-hairline px-2"
                inputMode="numeric"
                defaultValue={g.learnerCount ?? ''}
                onBlur={(e) =>
                  void save({
                    gradeGroups: cls.gradeGroups.map((x) =>
                      x.id === g.id
                        ? {
                            ...x,
                            learnerCount: e.target.value.trim()
                              ? Math.max(0, Math.min(200, Number(e.target.value) || 0))
                              : null,
                          }
                        : x
                    ),
                  })
                }
              />
            </label>
          </div>
        ))}
      </List>

      <SectionTitle>{t('class.timetable')}</SectionTitle>
      <List>
        {assignments.map((a) => (
          <ListRow
            key={a.id}
            title={a.subjectName}
            subtitle={`${t('class.sessionsPerWeek', { n: a.slots.length })} · ${t('common.minutes', { n: a.slots[0]?.minutes ?? 0 })}${a.slots[0]?.startTime ? ` · ${a.slots[0].startTime}` : ''}`}
            trailing={<Badge>{t('common.edit')}</Badge>}
            onClick={() => setEditingSlots(a)}
          />
        ))}
      </List>

      <SectionTitle>{t('class.roster')}</SectionTitle>
      <List>
        <ListRow
          title={t('class.learnersCount', { n: learnerCount })}
          subtitle={t('class.rosterImport')}
          href="/class/roster"
          trailing={<Badge>{t('common.edit')}</Badge>}
        />
      </List>

      <SectionTitle>{t('class.profile')}</SectionTitle>
      <p className="text-small text-forestMuted -mt-2">{t('class.profileHint')}</p>
      <TextInput
        label={t('class.materials')}
        hint={t('class.materialsHint')}
        defaultValue={cls.profile.materials.join(', ')}
        onBlur={(e) =>
          void saveProfile({
            materials: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 60),
          })
        }
      />
      <div className="grid grid-cols-2 gap-2">
        {(['electricity', 'projector', 'printing', 'outdoorSpace'] as const).map((k) => (
          <Select
            key={k}
            label={t(k === 'outdoorSpace' ? 'class.outdoor' : (`class.${k}` as never))}
            value={cls.profile[k] === null ? '' : cls.profile[k] ? 'yes' : 'no'}
            onChange={(e) =>
              void saveProfile({ [k]: e.target.value === '' ? null : e.target.value === 'yes' })
            }
          >
            <option value="">{t('common.notSure')}</option>
            <option value="yes">{t('common.yes')}</option>
            <option value="no">{t('common.no')}</option>
          </Select>
        ))}
      </div>
      <TextArea
        label={t('class.notes')}
        optional
        defaultValue={cls.profile.notes}
        maxLength={2000}
        onBlur={(e) => void saveProfile({ notes: e.target.value })}
      />

      <details className="rounded border border-hairline bg-white">
        <summary className="min-h-touch px-3 py-2 cursor-pointer font-medium flex items-center">
          {t('class.advanced')}
        </summary>
        <div className="px-3 pb-3 flex flex-col gap-3">
          <p className="text-small text-forestMuted">{t('class.advancedHint')}</p>
          <AdvancedPacing
            classId={cls.id}
            defaults={config?.pacingDefaults ?? DEFAULT_PACING_PARAMS}
          />
          <Button variant="danger" onClick={() => setArchiveOpen(true)}>
            {t('class.archive')}
          </Button>
        </div>
      </details>

      <TimetableSheet
        assignment={editingSlots}
        tracks={ws.tracks}
        onClose={() => setEditingSlots(null)}
        onSaved={() => setToast(t('class.saved'))}
      />
      <Sheet
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={t('class.archive')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setArchiveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await save({ archived: true });
                setArchiveOpen(false);
                router.replace('/week');
              }}
            >
              {t('class.archive')}
            </Button>
          </>
        }
      >
        <p>{t('class.archiveConfirm')}</p>
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Per-class pacing parameters, written to every track of the class; "Reset to defaults" clears them (PACE-10). */
function AdvancedPacing({ classId, defaults }: { classId: string; defaults: PacingParams }) {
  const { t } = useT();
  const { engine } = useSession();
  const ws = useWorkspace();
  const tracks = ws.tracks.filter((x) => x.classId === classId);
  const params: Partial<PacingParams> = tracks[0]?.params ?? {};
  const eff = { ...defaults, ...params };
  const apply = async (patch: Partial<PacingParams> | null) => {
    if (!engine) return;
    for (const tr of tracks)
      await engine.put('pacing_track', {
        ...tr,
        params: patch === null ? {} : { ...tr.params, ...patch },
        allocation: null,
      });
  };
  return (
    <div className="flex flex-col gap-3">
      <TextInput
        label={t('class.bufferRatio')}
        inputMode="decimal"
        defaultValue={String(Math.round(eff.bufferRatio * 10))}
        onBlur={(e) =>
          void apply({ bufferRatio: Math.max(0, Math.min(5, Number(e.target.value) || 0)) / 10 })
        }
      />
      <TextInput
        label={t('class.assessmentSessions')}
        inputMode="numeric"
        defaultValue={String(eff.assessmentSessionsPerTerm)}
        onBlur={(e) =>
          void apply({
            assessmentSessionsPerTerm: Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)),
          })
        }
      />
      <TextInput
        label={t('class.minSessions')}
        inputMode="numeric"
        defaultValue={String(eff.minSessionsPerCompetency)}
        onBlur={(e) =>
          void apply({
            minSessionsPerCompetency: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)),
          })
        }
      />
      <Switch
        label={t('class.assumeTaught')}
        checked={eff.assumeTaught}
        onChange={(v) => void apply({ assumeTaught: v })}
      />
      <Select
        label={t('class.pairingRule')}
        value={eff.pairingRule}
        onChange={(e) => void apply({ pairingRule: e.target.value as PacingParams['pairingRule'] })}
      >
        <option value="theme_then_sequence">{t('class.pairing.theme_then_sequence')}</option>
        <option value="sequence">{t('class.pairing.sequence')}</option>
      </Select>
      <Button onClick={() => void apply(null)}>{t('class.resetDefaults')}</Button>
    </div>
  );
}

function TimetableSheet({
  assignment,
  tracks,
  onClose,
  onSaved,
}: {
  assignment: TeachingAssignment | null;
  tracks: PacingTrack[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { engine } = useSession();
  const [days, setDays] = useState<number[]>([]);
  const [minutes, setMinutes] = useState('50');
  const [start, setStart] = useState('');
  useEffect(() => {
    if (!assignment) return;
    setDays(meetingDays(assignment));
    setMinutes(String(assignment.slots[0]?.minutes ?? 50));
    setStart(assignment.slots[0]?.startTime ?? '');
  }, [assignment]);
  const save = async () => {
    if (!engine || !assignment) return;
    const m = Math.max(5, Math.min(480, parseInt(minutes, 10) || 50));
    const slots = slotsForDays(assignment, days, m, start);
    // One operation: the new days and the tracks re-proposed for them land together.
    await engine.batch([
      { op: 'put', entity: 'assignment', data: { ...assignment, slots } },
      ...tracksToRepace(tracks, assignment, days).map((tr) => ({
        op: 'put' as const,
        entity: 'pacing_track' as const,
        data: tr,
      })),
    ]);
    onSaved();
    onClose();
  };
  return (
    <Sheet
      open={!!assignment}
      onClose={onClose}
      title={assignment?.subjectName ?? ''}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!days.length}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <DayPicker legend={t('setup.days')} days={days} onChange={setDays} />
      <TextInput
        label={t('setup.minutesPerSession')}
        inputMode="numeric"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <TextInput
        label={t('setup.startTime')}
        optional
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <Checkbox
        label={t('class.curriculum.deped')}
        checked={!!assignment?.learningAreaId}
        onChange={() => {}}
        disabled
      />
    </Sheet>
  );
}
