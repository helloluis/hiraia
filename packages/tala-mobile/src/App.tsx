import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Image,
  Text,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  AppState,
  Alert,
  Share,
  Switch,
  SafeAreaView,
} from 'react-native';
import { useFonts } from 'expo-font';
import * as SecureStore from 'expo-secure-store';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  PlanSection,
  Plan,
  ClassRecord,
  GradeLevel,
  SessionMark,
  CalendarDay,
  DEFAULT_PACING_PARAMS,
  BUILTIN_TEMPLATES,
} from '@hiraia/tala-core/contracts';
import type {
  LocalRecord,
  SyncStatus,
  TimelineEntry,
  Template,
  TimelineInput,
  CalendarPreset,
  CurriculumPack,
  RealignmentPreview,
  Plan as PlanData,
  PlanSection as SectionData,
} from '@hiraia/tala-core/contracts';
import { engine as pacing } from '@hiraia/tala-core/pacing';
import { sizes, colors } from '@hiraia/tala-core/tokens';
import { createRuntime, resetRuntime, type Runtime } from './runtime/runtime';
import { initialConditions, transition, type Conditions } from './runtime/ladder';
import { createScheduler } from './runtime/scheduler';
import { registerBackground } from './runtime/background';
import { lockPlan, validatePlanForLock } from '@hiraia/tala-core/plan';
import { messageForError } from './runtime/errors';
import { markSession } from './runtime/session';
import { previewNoClass, hasIncompatibleMoves } from './runtime/realignment';
import { samplePack } from './runtime/sample';
import { sectionHistory } from './runtime/history';
import { referenceCache } from './runtime/reference';
import { today, newId, timelineInput, setupClass, createPlan, samplePreset } from './runtime/model';
import { exportWithFallback, printPageSize, type PrintInput } from './runtime/print';
import { Body, Title, Button, Field, styles } from './ui/components';
import { ContentEditor } from './ui/ContentEditor';
import { en, type StringKey } from './i18n/en';
import { fil } from './i18n/fil';
import { GenerationScreen } from './features/GenerationScreen';
import { RosterScreen } from './features/RosterScreen';
import { CommunityScreen, PostScreen } from './features/CommunityScreen';
import { staged } from './features/atomic';
import { applyPreviews } from './features/realignment';
type Tab = 'week' | 'lessons' | 'community' | 'class';
type Page =
  | 'main'
  | 'setup'
  | 'settings'
  | 'lesson'
  | 'conflict'
  | 'preview'
  | 'auth'
  | 'generation'
  | 'roster'
  | 'post'
  | 'create-choice';
export default function App() {
  const [fontLoaded] = useFonts({ FrauncesSemiBold: require('../assets/Fraunces-SemiBold.ttf') });
  const [bootAttempt, setBootAttempt] = useState(0);
  const [rt, setRt] = useState<Runtime | null>(null),
    [bootError, setBootError] = useState(false),
    [language, setLanguage] = useState<'fil' | 'en'>('fil');
  const t = (k: StringKey) => (language === 'fil' ? fil : en)[k];
  const [tab, setTab] = useState<Tab>('week'),
    [page, setPage] = useState<Page>('main');
  const [conditions, setConditions] = useState<Conditions>(initialConditions);
  const conditionRef = useRef(conditions);
  conditionRef.current = conditions;
  const ladder = transition(conditions, {});
  const [status, setStatus] = useState<SyncStatus | null>(null),
    [message, setMessage] = useState<StringKey | null>(null),
    [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<LocalRecord<'plan'>[]>([]),
    [classes, setClasses] = useState<LocalRecord<'class'>[]>([]),
    [sections, setSections] = useState<LocalRecord<'plan_section'>[]>([]),
    [input, setInput] = useState<TimelineInput | null>(null),
    [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [selected, setSelected] = useState<PlanData | null>(null),
    [editing, setEditing] = useState(false),
    [presets, setPresets] = useState<CalendarPreset[]>([]),
    [packs, setPacks] = useState<CurriculumPack[]>([]),
    [presetId, setPresetId] = useState('');
  const [className, setClassName] = useState(''),
    [school, setSchool] = useState(''),
    [subject, setSubject] = useState('Science'),
    [grades, setGrades] = useState('3'),
    [starts, setStarts] = useState<Record<string, string>>({});
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [register, setRegister] = useState(false),
    [authenticated, setAuthenticated] = useState(false);
  const [customTemplate, setCustomTemplate] = useState<Template | null>(null);
  const [featurePending, setFeaturePending] = useState(0);
  const [pendingSlot, setPendingSlot] = useState<TimelineEntry | null>(null);
  const [featureClass, setFeatureClass] = useState<string | null>(null);
  const [communityQuery, setCommunityQuery] = useState<
    React.ComponentProps<typeof CommunityScreen>['initialQuery']
  >({});
  const [olderId, setOlderId] = useState('');
  const featureRuntime = useRef<Runtime | null>(null);
  const [templateChoice, setTemplateChoice] = useState('');
  const [paper, setPaper] = useState<'a4' | 'long'>('a4'),
    [previews, setPreviews] = useState<RealignmentPreview[]>([]),
    [pendingDay, setPendingDay] = useState<ReturnType<typeof CalendarDay.parse> | null>(null),
    [undo, setUndo] = useState<(() => Promise<void>) | null>(null),
    [bytes, setBytes] = useState(0);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const drafts = useRef<Record<string, SectionData>>({});
  const history = useRef<ReturnType<typeof sectionHistory> | null>(null);
  const queue = useRef(Promise.resolve()),
    cancel = useRef(false),
    scheduler = useRef<ReturnType<typeof createScheduler> | null>(null),
    inputRef = useRef(input);
  inputRef.current = input;
  async function refresh(runtime = rt) {
    if (!runtime) return;
    const [p, c, s, st] = await Promise.all([
      runtime.engine.list('plan'),
      runtime.engine.list('class'),
      runtime.engine.list('plan_section'),
      runtime.engine.status(),
    ]);
    setPlans(p.filter((p) => p.data.state !== 'archived'));
    setClasses(c.filter((c) => !c.data.archived));
    setSections(
      s.map((row) => (drafts.current[row.id] ? { ...row, data: drafts.current[row.id]! } : row))
    );
    setSelected((current) => {
      if (!current) return null;
      const remote = p.find((row) => row.id === current.id)?.data;
      return remote?.state === 'locked' && current.state !== 'locked' ? remote : current;
    });
    setStatus(st);
    const cache = referenceCache(runtime.store, runtime.client);
    const [pk, pr] = await Promise.all([cache.packs(), cache.presets()]);
    setPacks(pk);
    setPresets(pr);
    const d = new Date();
    d.setDate(d.getDate() + 31);
    const i = await timelineInput(runtime.engine, pk, today(), d.toISOString().slice(0, 10));
    setInput(i);
    setEntries(i ? pacing.buildTimeline(i) : []);
    const profile = await runtime.engine.get('profile', 'profile');
    if (profile) {
      setLanguage(profile.data.uiLanguage);
      setConditions((old) => ({ ...old, dataSaver: profile.data.dataSaver }));
    }
    setBytes(Number((await runtime.store.getMeta('network.bytes')) ?? 0));
  }
  function error(cause?: unknown) {
    setMessage(messageForError(cause));
    setConditions((old) => ({ ...old, storageFull: Paths.availableDiskSpace < 1024 * 1024 }));
  }
  // Saves are serialised, including rapid keystrokes; no out-of-order write can replace a newer edit.
  function save(action: () => Promise<unknown>) {
    if (!ladder.canWrite) return;
    setMessage('saving');
    queue.current = queue.current
      .then(async () => {
        if (!transition(conditionRef.current, {}).canWrite) return;
        await action();
        setMessage('saved');
        scheduler.current?.kick();
      })
      .catch(error);
  }
  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (cause) {
      error(cause);
    }
  }
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {},
      unsubscribeTasks = () => {};
    void createRuntime()
      .then(async (runtime) => {
        if (!alive) return;
        setRt(runtime);
        featureRuntime.current = runtime;
        await runtime.features.start();
        const refreshTasks = async () => {
          const all = await runtime.features.tasks.list();
          if (alive)
            setFeaturePending(
              all.filter((t) => ['queued', 'polling', 'sending'].includes(t.state)).length
            );
        };
        await refreshTasks();
        unsubscribeTasks = runtime.features.tasks.subscribe(() => void refreshTasks());
        history.current = sectionHistory(runtime.engine, newId, () => new Date());
        await refresh(runtime);
        const preference = await runtime.store.getMeta('language');
        if (preference) setLanguage(preference === 'en' ? 'en' : 'fil');
        setConditions((c) => ({
          ...c,
          dataSaver: c.dataSaver,
          lowStorage: Paths.availableDiskSpace < 50_000_000,
          storageFull: Paths.availableDiskSpace < 1_000_000,
        }));
        const saver = await runtime.store.getMeta('dataSaver');
        if (saver === 'true') setConditions((c) => ({ ...c, dataSaver: true }));
        setName((await runtime.store.getMeta('teacherName')) ?? '');
        const token = await SecureStore.getItemAsync('tala.session');
        setAuthenticated(!!token);
        if (!token && (await runtime.engine.list('class')).length === 0) setPage('auth');
        const expires = await SecureStore.getItemAsync('tala.offline-until');
        if (expires && new Date(expires).getTime() < Date.now())
          setConditions((c) => ({ ...c, sessionExpired: true }));
        unsubscribe = runtime.engine.subscribe((changed) => {
          if (
            editingRef.current &&
            changed.every((c) => c.entity === 'plan_section' || c.entity === 'section_revision')
          ) {
            void runtime.engine.status().then(setStatus);
            return;
          }
          void refresh(runtime).catch(error);
        });
        scheduler.current = createScheduler(runtime.engine, {
          online: () => conditionRef.current.connected && !conditionRef.current.sessionExpired,
          light: () => transition(conditionRef.current, {}).rung !== 'full',
          changed: (ok, ms, report) => {
            if (report.lockCopies.length) setMessage('lockedCopy');
            else if (report.rejected) setMessage('sendRejected');
            else if (report.error === 'unauthenticated') setMessage('signInAgain');
            setConditions((c) => ({ ...c, serverDown: !ok, slow: ok ? ms > 4000 : c.slow }));
            void runtime.features.tick(
              conditionRef.current.connected &&
                !conditionRef.current.sessionExpired &&
                transition(conditionRef.current, {}).canWrite
            );
            void refresh(runtime);
          },
        });
        scheduler.current.kick();
        await registerBackground(async () => {
          if (!(await SecureStore.getItemAsync('tala.session'))) return true;
          await runtime.features.tick(true);
          const result = await runtime.engine.sync();
          return result.ok;
        });
      })
      .catch(() => setBootError(true));
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeTasks();
      scheduler.current?.stop();
      featureRuntime.current?.features.stop();
    };
  }, [bootAttempt]);
  useEffect(() => {
    const net = Network.addNetworkStateListener((n) => {
      setConditions((c) => ({
        ...c,
        connected: !!n.isConnected && n.isInternetReachable !== false,
        metered: n.type === Network.NetworkStateType.CELLULAR,
      }));
      if (n.isConnected) setTimeout(() => scheduler.current?.kick(), 0);
    });
    void Network.getNetworkStateAsync().then((n) =>
      setConditions((c) => ({
        ...c,
        connected: !!n.isConnected && n.isInternetReachable !== false,
        metered: n.type === Network.NetworkStateType.CELLULAR,
      }))
    );
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setConditions((c) => ({
          ...c,
          lowStorage: Paths.availableDiskSpace < 50_000_000,
          storageFull: Paths.availableDiskSpace < 1_000_000,
        }));
        scheduler.current?.kick();
      } else void queue.current;
    });
    const memory = AppState.addEventListener('memoryWarning', () =>
      setConditions((c) => ({ ...c, lowMemory: true }))
    );
    return () => {
      net.remove();
      app.remove();
      memory.remove();
    };
  }, []);
  useEffect(() => {
    if (!rt || !authenticated || !conditions.connected || conditions.lowStorage) return;
    const cache = referenceCache(rt.store, rt.client);
    void cache
      .refresh(
        [
          ...classes.flatMap((c) => c.data.gradeGroups.map((g) => g.grade)),
          ...grades.split(',').map((g) => g.trim()),
        ],
        ['science']
      )
      .then(() => refresh(rt))
      .catch(() => {});
  }, [rt, authenticated, classes.length, conditions.connected, grades]);
  useEffect(() => {
    if (rt)
      void rt.features
        .tick(
          conditions.connected &&
            !conditions.serverDown &&
            !conditions.sessionExpired &&
            ladder.canWrite
        )
        .catch(error);
  }, [rt, conditions.connected, conditions.serverDown, conditions.sessionExpired, ladder.canWrite]);
  useEffect(() => {
    if (rt && selected) {
      const template = BUILTIN_TEMPLATES.find((t) => t.id === selected.templateId);
      if (template) setCustomTemplate(template);
      else
        void rt.engine
          .get('template', selected.templateId)
          .then((row) => setCustomTemplate(row?.data ?? null));
    }
  }, [rt, selected?.templateId]);
  if (!rt)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sizes.touchGap }}>
            <Image
              source={require('../assets/hiraia-glyph.png')}
              accessibilityLabel="Hiraia"
              style={{ width: sizes.touchTarget, height: sizes.touchTarget }}
            />
            <Title>Tala</Title>
          </View>
          <Body>{t(bootError ? 'encryptedBuild' : 'loading')}</Body>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.placeholder} />
          ))}
          {bootError && (
            <Button
              label={t('retry')}
              onPress={() => {
                setBootError(false);
                setBootAttempt((n) => n + 1);
              }}
            />
          )}
        </View>
      </SafeAreaView>
    );
  const currentSections = sections.filter((s) => s.data.planId === selected?.id),
    conflict = currentSections.find((s) => s.conflict);
  function goLesson(plan: PlanData) {
    history.current?.reset();
    drafts.current = {};
    setSelected(plan);
    setEditing(false);
    setPage('lesson');
  }
  async function write(date = today(), assignmentId: string | null = null, classId?: string) {
    if (!transition(conditionRef.current, {}).canWrite) return;
    const cls = (classes.find((c) => c.id === classId) ?? classes[0])?.data;
    if (!cls) {
      setPage('setup');
      return;
    }
    const entry = entries.find(
      (e) => e.date === date && e.assignmentId === assignmentId && e.classId === cls.id
    );
    const assignment = input?.assignments.find((a) => a.id === assignmentId);
    const curriculumVersion =
      input?.tracks.find((track) => track.assignmentId === assignmentId)?.curriculumVersion ?? null;
    const plan = await createPlan(
      rt!.engine,
      cls,
      date,
      assignmentId,
      templateChoice,
      entry
        ? {
            competencies: entry.byGroup,
            subjectName: entry.subjectName,
            learningAreaId: assignment?.learningAreaId ?? null,
            curriculumVersion,
          }
        : {}
    );
    goLesson(plan);
    setEditing(true);
    return plan;
  }
  async function login() {
    setBusy(true);
    cancel.current = false;
    const ctrl = new AbortController();
    abort.current = () => ctrl.abort();
    try {
      const result = register
        ? await rt!.client.call('auth.register', {
            body: {
              email,
              password,
              displayName: name,
              uiLanguage: language,
              deviceLabel: 'Tala Android',
            },
            signal: ctrl.signal,
          })
        : await rt!.client.call('auth.login', {
            body: { email, password, deviceLabel: 'Tala Android' },
            signal: ctrl.signal,
          });
      const owner = await rt!.store.getMeta('owner');
      if (owner && owner !== result.user.id) throw new Error('Different account');
      await rt!.store.commit({ meta: { owner: result.user.id } });
      await SecureStore.setItemAsync('tala.session', result.token);
      const until = new Date(
        Math.max(new Date(result.expiresAt).getTime(), Date.now() + 30 * 86400000)
      ).toISOString();
      await SecureStore.setItemAsync('tala.offline-until', until);
      const localProfile = await rt!.engine.get('profile', 'profile');
      if (localProfile)
        await rt!.engine.put('profile', {
          ...localProfile.data,
          displayName: result.user.displayName,
        });
      setAuthenticated(true);
      setName(result.user.displayName);
      await rt!.store.commit({ meta: { teacherName: result.user.displayName } });
      setPassword('');
      setConditions((c) => ({ ...c, sessionExpired: false }));
      setPage(classes.length ? 'main' : 'setup');
      setTimeout(() => scheduler.current?.start(), 0);
    } catch (cause) {
      setMessage(messageForError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function setup(sample: boolean) {
    if (!rt || !transition(conditionRef.current, {}).canWrite) return;
    const parsed = (sample ? ['3', '4'] : grades.split(',')).map((g) => GradeLevel.parse(g.trim()));
    const preset = sample ? samplePreset() : (presets.find((p) => p.id === presetId) ?? presets[0]);
    if (!preset) {
      setMessage('noPreset');
      return;
    }
    let setupPacks = packs.filter((p) => p.curriculumVersion !== 'sample');
    if (sample) {
      const added = parsed.map((g) => samplePack(g, language));
      const ids = new Set<string>(JSON.parse((await rt.store.getMeta('packs')) ?? '[]'));
      const meta: Record<string, string> = {};
      for (const p of added) {
        ids.add(p.packId);
        meta[`pack.${p.packId}`] = JSON.stringify(p);
      }
      meta.packs = JSON.stringify([...ids]);
      await rt.store.commit({ meta });
      setupPacks = added;
    }
    await staged(rt.engine, async (engine) => {
      const cls = await setupClass(engine, {
        name: sample ? t('sampleLabel') : className || t('class'),
        teacherName: name || t('sampleLabel'),
        school,
        subject,
        grades: parsed,
        preset,
        sample,
        packs: setupPacks,
        starts,
      });
      if (sample) {
        for (let offset = 0; offset < 3; offset++) {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          const plan = await createPlan(engine, cls, d.toISOString().slice(0, 10));
          await engine.put('plan', {
            ...plan,
            title: `${t('sampleLesson')} ${offset + 1}`,
            subjectName: subject,
            competencies: Object.fromEntries(
              cls.gradeGroups.map((g) => [
                g.id,
                [setupPacks.find((p) => p.grade === g.grade)!.competencies[offset]!.id],
              ])
            ),
          });
          for (const row of (await engine.list('plan_section')).filter(
            (s) => s.data.planId === plan.id
          )) {
            const rich = [{ t: 'p' as const, spans: [{ text: t('samplePrompt') }] }];
            const old = row.data.content;
            const content =
              old.type === 'list'
                ? { ...old, items: [t('sampleObjective')] }
                : old.type === 'text'
                  ? { ...old, blocks: rich }
                  : old.type === 'pergroup'
                    ? {
                        ...old,
                        groups: Object.fromEntries(Object.keys(old.groups).map((id) => [id, rich])),
                      }
                    : old.type === 'procedure'
                      ? { ...old, steps: old.steps.map((step) => ({ ...step, body: rich })) }
                      : old.type === 'multigrade'
                        ? {
                            ...old,
                            blocks: old.blocks.map((block) => ({
                              ...block,
                              groups: Object.fromEntries(
                                Object.entries(block.groups).map(([id, g]) => [
                                  id,
                                  { ...g, activity: rich },
                                ])
                              ),
                            })),
                          }
                        : old;
            await engine.put('plan_section', { ...row.data, content });
          }
        }
        await engine.put('student', {
          id: newId(),
          classId: cls.id,
          gradeGroupId: cls.gradeGroups[0]!.id,
          displayName: 'Sample Learner',
          familyName: '',
          givenName: '',
          middleName: '',
          suffix: '',
          sex: null,
          localId: null,
          order: 0,
          importId: null,
        });
      }
    });
    await refresh();
    setPage('main');
  }
  async function lock() {
    if (!selected || !transition(conditionRef.current, {}).canWrite) return;
    await queue.current;
    const template =
      BUILTIN_TEMPLATES.find((t) => t.id === selected.templateId) ??
      (await rt!.engine.get('template', selected.templateId))?.data;
    if (!template) throw Error('Template missing');
    const cls = classes.find((c) => selected.placements.some((p) => p.classId === c.id))?.data;
    const allSections = (await rt!.engine.list('plan_section'))
      .filter((s) => s.data.planId === selected.id)
      .map((s) => s.data);
    if (
      selected.state !== 'locked' &&
      !validatePlanForLock(selected, allSections, template, cls).ok
    ) {
      setMessage('completeRequired');
      return;
    }
    const next =
      selected.state === 'locked'
        ? Plan.parse({ ...selected, state: 'draft', lock: null, submitted: null })
        : lockPlan({
            plan: selected,
            sections: allSections,
            template,
            class: cls,
            teacherName: name,
            at: new Date().toISOString(),
            revision: null,
          });
    await queue.current;
    if (next.lock)
      next.lock.sectionRevs = Object.fromEntries(
        (await rt!.engine.list('plan_section'))
          .filter((s) => s.data.planId === selected.id)
          .map((s) => [s.id, s.rev])
      );
    await rt!.engine.put('plan', next);
    setSelected(next);
    setEditing(false);
  }
  async function pdf(server = false) {
    if (!selected) return;
    setBusy(true);
    setMessage('pdfWait');
    cancel.current = false;
    await queue.current;
    const printPlan = (await rt!.engine.get('plan', selected.id))?.data ?? selected;
    const customTemplate = await rt!.engine.get('template', printPlan.templateId);
    const printOptions: PrintInput = {
      plan: printPlan,
      sections: (await rt!.engine.list('plan_section'))
        .filter((s) => s.data.planId === printPlan.id)
        .map((s) => s.data),
      template:
        BUILTIN_TEMPLATES.find((t) => t.id === printPlan.templateId) ??
        customTemplate?.data ??
        BUILTIN_TEMPLATES[0]!,
      class: classes.find((c) => printPlan.placements.some((p) => p.classId === c.id))?.data,
      schoolYear: input?.schoolYear,
      teacherName: name,
      lang: language,
      paper,
      includeImages: ladder.downloadAttachments,
      competencyLookup: (id) => input?.competencies.find((c) => c.id === id),
    };
    const [width, height] = printPageSize(printOptions);
    const shareFile = async (uri: string) => {
      if (cancel.current) return;
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      else await Print.printAsync({ uri });
    };
    const serverCopy = async () => {
      const data = await rt!.client.call('print.planPdf', {
        params: { planId: selected.id },
        query: { paper, images: false },
      });
      const file = new File(Paths.cache, `tala-${selected.id}.pdf`);
      file.write(new Uint8Array(data));
      await shareFile(file.uri);
    };
    try {
      if (server) await serverCopy();
      else {
        const result = await exportWithFallback(
          printOptions,
          {
            print: async (html) => {
              const result = await Print.printToFileAsync({
                html,
                width,
                height,
              });
              await shareFile(result.uri);
            },
            text: async (text) => {
              if (!cancel.current) await Share.share({ message: text });
            },
            server: conditions.connected ? serverCopy : undefined,
          },
          () => cancel.current
        );
        if (result === 'text') setMessage('textFallback');
      }
    } catch {
      setMessage('textFallback');
    } finally {
      setBusy(false);
    }
  }
  async function noClass() {
    if (!input) return;
    const day = CalendarDay.parse({
      id: newId(),
      schoolYearId: input.schoolYear.id,
      date: today(),
      kind: 'suspension',
      label: t('noClass'),
    });
    setPendingDay(day);
    setPreviews(previewNoClass(input, day));
    setPage('preview');
  }
  const renderEntry = ({ item: e }: { item: TimelineEntry }) =>
    e.kind === 'before_tala' ? (
      <View style={styles.card}>
        <Body>
          {e.date} · {e.subjectName}
        </Body>
        <Body>{t('before_tala')}</Body>
      </View>
    ) : (
      <View style={styles.card}>
        {classes.find((c) => c.id === e.classId)?.data.isSample && <Body>{t('sampleLabel')}</Body>}
        <Body>
          {e.date} · {e.subjectName}
        </Body>
        <Body>
          {Object.values(e.byGroup)
            .flat()
            .map((id) => input?.competencies.find((c) => c.id === id)?.text ?? id)
            .join('\n')}
        </Body>
        <Body>{e.mark ? t(e.mark) : t(e.planState === 'none' ? 'noPlan' : e.planState)}</Body>
        <Button
          label={t(e.planId ? 'view' : 'write')}
          onPress={() => {
            const p = plans.find((p) => p.id === e.planId);
            if (p) goLesson(p.data);
            else {
              setPendingSlot(e);
              setPage('create-choice');
            }
          }}
        />
        {(['taught', 'partial', 'not_taught'] as const).map((mark) => (
          <Button
            key={mark}
            disabled={!ladder.canWrite}
            label={t(mark)}
            onPress={() =>
              save(async () => {
                const undoMark = await markSession(rt!.engine, e, mark, newId);
                setUndo(() => undoMark);
              })
            }
          />
        ))}
      </View>
    );
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sizes.touchGap }}>
            <Image
              source={require('../assets/hiraia-glyph.png')}
              accessibilityLabel="Hiraia"
              style={{ width: sizes.touchTarget, height: sizes.touchTarget }}
            />
            <Title>Tala</Title>
          </View>
          {ladder.banner && <Body>{t(ladder.banner as StringKey)}</Body>}
          <Body>
            {(status?.pending ?? 0) + featurePending} {t('waiting')} · {t('lastSync')}:{' '}
            {status?.lastSyncedAt ?? t('never')} · {status?.conflicts ?? 0} {t('conflicts')}
          </Body>
          {message && <Body>{t(message)}</Body>}
          {busy && (
            <Button
              label={t('cancel')}
              onPress={() => {
                cancel.current = true;
                abort.current?.();
                setBusy(false);
              }}
            />
          )}
          {page !== 'main' && (
            <Button
              label={t('back')}
              onPress={() => {
                void queue.current.then(() => setPage('main'));
              }}
            />
          )}
        </View>
        {page === 'main' && tab === 'week' && (
          <FlatList
            data={entries.filter(
              (e) => e.date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
            )}
            keyExtractor={(e) => `${e.date}.${e.assignmentId}.${e.slotId}`}
            renderItem={renderEntry}
            initialNumToRender={5}
            maxToRenderPerBatch={5}
            windowSize={3}
            contentContainerStyle={styles.pad}
            ListHeaderComponent={
              <>
                <Title>{t('week')}</Title>
                <Button
                  label={t('write')}
                  primary
                  disabled={!ladder.canWrite}
                  onPress={() => void act(() => write())}
                />
                <Button
                  label={t('noClass')}
                  disabled={!ladder.canWrite}
                  onPress={() => void act(noClass)}
                />
                <Title>{t('month')}</Title>
                <Body>
                  {entries.length} · {t('scheduled')}
                </Body>
                <Title>{t('attention')}</Title>
                {input?.tracks.map((track) => {
                  const term = input.schoolYear.terms.find((t) => t.id === track.termId),
                    assignment = input.assignments.find((a) => a.id === track.assignmentId);
                  if (!term || !assignment) return null;
                  const pace = pacing.computePacing({
                    track,
                    term,
                    assignment,
                    schoolYear: input.schoolYear,
                    calendarDays: input.calendarDays,
                    competencies: input.competencies.filter((c) => c.termIndex === term.index),
                    checks: input.checks,
                    marks: input.marks,
                    today: today(),
                    defaults: DEFAULT_PACING_PARAMS,
                  });
                  return (
                    <Body key={track.id}>
                      {assignment.subjectName}: {pace.sessionsBehind} {t('behind')} ·{' '}
                      {pace.atRisk.length} {t('attention')}
                    </Body>
                  );
                })}
              </>
            }
            ListEmptyComponent={
              <>
                <Body>{t('noTimeline')}</Body>
                <Button label={t('setup')} onPress={() => setPage('setup')} />
              </>
            }
          />
        )}
        {page === 'main' && tab === 'lessons' && (
          <FlatList
            data={plans}
            keyExtractor={(p) => p.id}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={3}
            contentContainerStyle={styles.pad}
            ListHeaderComponent={
              <>
                <Title>{t('lessons')}</Title>
                <Button
                  label={
                    BUILTIN_TEMPLATES.find((t) => t.id === templateChoice)?.name[language] ??
                    t('templateDefault')
                  }
                  onPress={() => {
                    const ids = ['', 'tpl.dlp.v1', 'tpl.dll.v1', 'tpl.multigrade.v1'];
                    setTemplateChoice(ids[(ids.indexOf(templateChoice) + 1) % ids.length]!);
                  }}
                />
                <Button
                  primary
                  disabled={!ladder.canWrite}
                  label={t('write')}
                  onPress={() => void act(() => write())}
                />
                <Field label={t('olderPlanId')} value={olderId} onChange={setOlderId} />
                <Button
                  label={t('openOlderLesson')}
                  disabled={!conditions.connected || !olderId.trim()}
                  onPress={() =>
                    void act(async () => {
                      const result = await rt.engine.fetchPlans([olderId.trim()]);
                      if (!result.ok) throw Error('Fetch failed');
                      const row = await rt.engine.get('plan', olderId.trim());
                      if (row) goLesson(row.data);
                    })
                  }
                />
              </>
            }
            ListEmptyComponent={<Body>{t('empty')}</Body>}
            renderItem={({ item: p }) => (
              <View style={styles.card}>
                <Title>{p.data.title}</Title>
                <Body>{t(p.data.state === 'locked' ? 'locked' : 'draft')}</Body>
                <Button label={t('view')} onPress={() => goLesson(p.data)} />
              </View>
            )}
          />
        )}
        {page === 'main' && tab === 'community' && (
          <CommunityScreen
            rt={rt}
            t={t}
            online={conditions.connected && !conditions.serverDown}
            canWrite={ladder.canWrite}
            language={language}
            onOpen={goLesson}
            onBack={() => setTab('week')}
            initialQuery={communityQuery}
          />
        )}
        {page === 'main' && tab === 'class' && (
          <FlatList
            data={classes}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.pad}
            ListHeaderComponent={
              <>
                <Title>{t('class')}</Title>
                <Button
                  primary
                  label={t('setup')}
                  disabled={!ladder.canWrite}
                  onPress={() => setPage('setup')}
                />
                <Button label={t('settings')} onPress={() => setPage('settings')} />
              </>
            }
            renderItem={({ item: c }) => (
              <View style={styles.card}>
                <Title>{c.data.name}</Title>
                {c.data.isSample && <Body>{t('sampleLabel')}</Body>}
                <Body>{c.data.gradeGroups.map((g) => g.grade).join(', ')}</Body>
                <Button
                  label={t('importRoster')}
                  onPress={() => {
                    setFeatureClass(c.id);
                    setPage('roster');
                  }}
                />
                <Body>{t('activity')}</Body>
                {c.data.isSample && (
                  <Button
                    disabled={!ladder.canWrite}
                    label={t('removeSample')}
                    onPress={() =>
                      save(async () => {
                        const samplePlans = (await rt.engine.list('plan')).filter(
                          (p) =>
                            p.data.placements.length &&
                            p.data.placements.every((pl) => pl.classId === c.id)
                        );
                        await rt.engine.batch([
                          { op: 'put', entity: 'class', data: { ...c.data, archived: true } },
                          ...samplePlans.map((p) => ({
                            op: 'put' as const,
                            entity: 'plan' as const,
                            data: { ...p.data, state: 'archived' },
                          })),
                        ]);

                        setUndo(() => async () => {
                          await rt.engine.batch([
                            { op: 'put', entity: 'class', data: c.data },
                            ...samplePlans.map((p) => ({
                              op: 'put' as const,
                              entity: 'plan' as const,
                              data: p.data,
                            })),
                          ]);
                        });
                      })
                    }
                  />
                )}
              </View>
            )}
          />
        )}
        {page === 'generation' && selected && (
          <GenerationScreen
            rt={rt}
            t={t}
            online={conditions.connected && !conditions.serverDown}
            canWrite={ladder.canWrite}
            language={language}
            onOpen={goLesson}
            onBack={() => setPage('main')}
            plan={selected}
          />
        )}
        {page === 'roster' && featureClass && (
          <RosterScreen
            rt={rt}
            t={t}
            online={conditions.connected && !conditions.serverDown}
            canWrite={ladder.canWrite}
            language={language}
            onOpen={goLesson}
            onBack={() => setPage('main')}
            classId={featureClass}
          />
        )}
        {page === 'post' && selected && (
          <PostScreen
            rt={rt}
            t={t}
            online={conditions.connected && !conditions.serverDown}
            canWrite={ladder.canWrite}
            language={language}
            onOpen={goLesson}
            onBack={() => setPage('lesson')}
            plan={selected}
          />
        )}
        {page === 'create-choice' && pendingSlot && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Title>{t('chooseLessonAction')}</Title>
            <Body>
              {pendingSlot.date} · {pendingSlot.subjectName}
            </Body>
            <Button
              primary
              label={t('write')}
              disabled={!ladder.canWrite}
              onPress={() =>
                void act(() =>
                  write(pendingSlot.date, pendingSlot.assignmentId, pendingSlot.classId)
                )
              }
            />
            <Button
              label={t('generateLesson')}
              disabled={!ladder.canWrite}
              onPress={() =>
                void act(async () => {
                  const plan = await write(
                    pendingSlot.date,
                    pendingSlot.assignmentId,
                    pendingSlot.classId
                  );
                  if (plan) {
                    setSelected(plan);
                    setEditing(false);
                    setPage('generation');
                  }
                })
              }
            />
            <Button
              label={t('findCommunity')}
              onPress={() => {
                const cls = classes.find((c) => c.id === pendingSlot.classId)?.data;
                const assignment = input?.assignments.find(
                  (a) => a.id === pendingSlot.assignmentId
                );
                setCommunityQuery({
                  competencyId: Object.values(pendingSlot.byGroup).flat()[0],
                  grade: cls?.gradeGroups[0]?.grade,
                  language: assignment?.language ?? language,
                  multigrade:
                    cls && cls.gradeGroups.length > 1
                      ? cls.gradeGroups
                          .map((g) => g.grade)
                          .sort((a, b) => Number(a) - Number(b))
                          .join(',')
                      : undefined,
                });
                setTab('community');
                setPage('main');
              }}
            />
          </ScrollView>
        )}
        {page === 'auth' && (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
            <Title>{t(register ? 'register' : 'signIn')}</Title>
            {register && <Field label={t('name')} value={name} onChange={setName} />}
            <Field label={t('email')} value={email} onChange={setEmail} />
            <Field label={t('password')} value={password} onChange={setPassword} secure />
            <Button
              primary
              disabled={busy}
              label={t(register ? 'register' : 'signIn')}
              onPress={() => void login()}
            />
            <Button
              label={t(register ? 'signIn' : 'register')}
              onPress={() => setRegister(!register)}
            />
            <Button label={t('sample')} onPress={() => void act(() => setup(true))} />
            {classes.length > 0 && (
              <Button label={t('offlineRead')} onPress={() => setPage('main')} />
            )}
          </ScrollView>
        )}
        {page === 'setup' && (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
            <Title>{t('setup')}</Title>
            <Body>{t('setupNote')}</Body>
            <Field label={t('schoolName')} value={school} onChange={setSchool} />
            <Field label={t('className')} value={className} onChange={setClassName} />
            <Field label={t('grade')} value={grades} onChange={setGrades} />
            <Field label={t('subject')} value={subject} onChange={setSubject} />
            <Title>{t('schoolYear')}</Title>
            {presets.map((p) => (
              <Button
                key={p.id}
                label={`${p.id === presetId ? '✓ ' : ''}${p.label}${p.provisional ? ' · ' + t('estimated') : ''}`}
                onPress={() => setPresetId(p.id)}
              />
            ))}
            <Body>{t('estimated')}</Body>
            {grades.split(',').map((g) => (
              <View key={g}>
                <Field
                  label={`${t('start')} ${g}`}
                  value={starts[g] ?? ''}
                  onChange={(v) => setStarts((s) => ({ ...s, [g]: v }))}
                />
                {packs
                  .filter((p) => p.grade === g)
                  .flatMap((p) => p.competencies)
                  .slice(0, 20)
                  .map((c) => (
                    <Button
                      key={c.id}
                      label={c.text}
                      onPress={() => setStarts((s) => ({ ...s, [g]: c.id }))}
                    />
                  ))}
              </View>
            ))}
            <Body>{t('covered')}</Body>
            <Button
              primary
              disabled={!ladder.canWrite}
              label={t('next')}
              onPress={() => void act(() => setup(false))}
            />
            <Button
              label={t('sample')}
              disabled={!ladder.canWrite}
              onPress={() => void act(() => setup(true))}
            />
          </ScrollView>
        )}
        {page === 'settings' && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Title>{t('settings')}</Title>
            <Button
              label={`${t('language')}: ${language === 'fil' ? 'Filipino' : 'English'}`}
              onPress={() => {
                setLanguage(language === 'fil' ? 'en' : 'fil');
                save(async () => {
                  const p = await rt.engine.get('profile', 'profile');
                  if (p)
                    await rt.engine.put('profile', {
                      ...p.data,
                      uiLanguage: language === 'fil' ? 'en' : 'fil',
                    });
                  else
                    await rt.store.commit({
                      meta: { language: language === 'fil' ? 'en' : 'fil' },
                    });
                });
              }}
            />
            <Button
              label={t('account')}
              onPress={() => {
                if (!authenticated || conditions.sessionExpired) setPage('auth');
                else setMessage('saved');
              }}
            />
            <Button label={t('school')} onPress={() => setPage('setup')} />
            <View style={styles.card}>
              <Body>{t('dataSaver')}</Body>
              <Switch
                accessibilityLabel={t('dataSaver')}
                value={conditions.dataSaver}
                onValueChange={(v) => {
                  setConditions((c) => ({ ...c, dataSaver: v }));
                  save(async () => {
                    const p = await rt.engine.get('profile', 'profile');
                    if (p) await rt.engine.put('profile', { ...p.data, dataSaver: v });
                    else await rt.store.commit({ meta: { dataSaver: String(v) } });
                  });
                }}
              />
              <Body>
                {t('units')}: {Math.round(bytes / 1024)} KB
              </Body>
            </View>
            <Button
              label={t('signOut')}
              onPress={() =>
                void act(async () => {
                  await queue.current;
                  if (
                    (await rt.engine.status()).pending ||
                    (await rt.features.tasks.list()).some(
                      (task) => !['done', 'cancelled'].includes(task.state)
                    ) ||
                    (await Promise.all(classes.map((c) => rt.features.roster.load(c.id)))).some(
                      Boolean
                    )
                  ) {
                    setMessage('signOutNote');
                    return;
                  }
                  await rt.features.stop();
                  try {
                    await rt.client.call('auth.logout');
                  } catch (error) {
                    await rt.features.start();
                    throw error;
                  }
                  await SecureStore.deleteItemAsync('tala.session');
                  await SecureStore.deleteItemAsync('tala.offline-until');
                  scheduler.current?.stop();
                  await rt.engine.sync();
                  await rt.store.clear();
                  resetRuntime();
                  drafts.current = {};
                  setSelected(null);
                  setBootAttempt((n) => n + 1);
                  setAuthenticated(false);
                  await refresh();
                  setPage('auth');
                })
              }
            />
          </ScrollView>
        )}
        {page === 'lesson' && selected && (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
            <Title>{selected.title}</Title>
            {selected.aiDraft && (
              <>
                <Body>{t('aiDraft')}</Body>
                <Body>{t('checkBeforeUse')}</Body>
              </>
            )}
            <Button
              label={t('generateLesson')}
              disabled={!ladder.canWrite || selected.state !== 'draft'}
              onPress={() => {
                void queue.current.then(() => {
                  setEditing(false);
                  setPage('generation');
                });
              }}
            />
            <Button
              label={t('postLesson')}
              disabled={!ladder.canWrite || selected.state !== 'locked'}
              onPress={() => setPage('post')}
            />
            {selected.placements.some(
              (p) => classes.find((c) => c.id === p.classId)?.data.isSample
            ) && <Body>{t('sampleLabel')}</Body>}
            <Body>{t(selected.state === 'locked' ? 'locked' : 'draft')}</Body>
            <Button
              primary
              disabled={!ladder.canWrite}
              label={t(editing ? 'save' : 'edit')}
              onPress={() => {
                if (editing) {
                  void queue.current.then(async () => {
                    setEditing(false);
                    await refresh();
                  });
                } else setEditing(true);
              }}
            />
            {editing && (
              <Field
                label={t('title')}
                value={selected.title}
                editable={ladder.canWrite && selected.state !== 'locked'}
                onChange={(title) => {
                  const next = { ...selected, title };
                  setSelected(next);
                  save(() => rt.engine.put('plan', next));
                }}
              />
            )}
            {currentSections.map((s) => (
              <View key={s.id}>
                <Title>
                  {customTemplate?.sections.find((spec) => spec.key === s.data.key)?.label[
                    language
                  ] ??
                    t(s.data.key as StringKey) ??
                    s.data.key}
                </Title>
                <ContentEditor
                  t={t}
                  labels={Object.fromEntries(
                    classes.flatMap((c) =>
                      c.data.gradeGroups.map((g) => [g.id, `${t('group')} ${g.grade}`])
                    )
                  )}
                  value={s.data.content}
                  editable={
                    editing &&
                    ladder.canWrite &&
                    (!(selected.lock && selected.state !== 'draft') ||
                      s.data.key === 'reflection' ||
                      !!customTemplate?.sections.find((spec) => spec.key === s.data.key)
                        ?.outsideLock)
                  }
                  onChange={(content) => {
                    const next = { ...s.data, content, editedByTeacher: true };
                    drafts.current[s.id] = next;
                    setSections((old) =>
                      old.map((x) => (x.id === s.id ? { ...x, data: next } : x))
                    );
                    save(async () => {
                      if (history.current) await history.current.edit(s.data, next);
                      else await rt.engine.put('plan_section', next);
                    });
                  }}
                />
              </View>
            ))}
            <Button
              disabled={!ladder.canWrite}
              label={t(selected.state === 'locked' ? 'unlock' : 'lock')}
              onPress={() =>
                Alert.alert(t(selected.state === 'locked' ? 'unlockAsk' : 'lockAsk'), undefined, [
                  { text: t('cancel'), style: 'cancel' },
                  { text: t('confirm'), onPress: () => void act(lock) },
                ])
              }
            />
            <Button
              label={`${t('paper')}: ${t(paper)}`}
              onPress={() => setPaper(paper === 'a4' ? 'long' : 'a4')}
            />
            <Button label={t('pdf')} onPress={() => void pdf()} />
            {conditions.connected && message === 'textFallback' && (
              <Button label={t('serverPdf')} onPress={() => void pdf(true)} />
            )}
            <Button
              disabled={!ladder.canWrite || selected.state === 'locked'}
              label={t('restore')}
              onPress={() =>
                save(async () => {
                  const revisions = (await rt.engine.list('section_revision')).filter(
                    (r) => r.data.planId === selected.id
                  );
                  const revision = revisions.sort((a, b) =>
                    b.updatedAt.localeCompare(a.updatedAt)
                  )[0];
                  if (!revision) {
                    setMessage('noHistory');
                    return;
                  }
                  const section = await rt.engine.get('plan_section', revision.data.sectionId);
                  if (section) {
                    await history.current?.edit(
                      section.data,
                      {
                        ...section.data,
                        content: revision.data.content,
                        editedByTeacher: true,
                      },
                      'restore'
                    );
                  }
                })
              }
            />
            {conflict && <Button label={t('conflicts')} onPress={() => setPage('conflict')} />}
          </ScrollView>
        )}
        {page === 'conflict' && conflict && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Title>{t('conflict')}</Title>
            <View style={styles.card}>
              <Body>
                {t('thisPhone')} · {conflict.updatedAt}
              </Body>
              <ContentEditor
                value={conflict.data.content}
                onChange={() => {}}
                editable={false}
                t={t}
              />
            </View>
            <View style={styles.card}>
              <Body>
                {t('otherPhone')} · {conflict.conflict!.server.updatedAt}
              </Body>
              <ContentEditor
                value={(conflict.conflict!.server.data as SectionData).content}
                onChange={() => {}}
                editable={false}
                t={t}
              />
            </View>
            {(['mine', 'theirs', 'both'] as const).map((choice) => (
              <Button
                key={choice}
                primary={choice === 'mine'}
                disabled={!ladder.canWrite}
                label={t(choice)}
                onPress={() =>
                  save(async () => {
                    await history.current?.beforeEdit(conflict.data, 'conflict');
                    await rt.engine.resolveConflict('plan_section', conflict.id, choice);
                    setPage('lesson');
                  })
                }
              />
            ))}
          </ScrollView>
        )}
        {page === 'preview' && pendingDay && (
          <ScrollView contentContainerStyle={styles.pad}>
            <Title>{t('preview')}</Title>
            <Body>{t('previewNote')}</Body>
            {previews
              .flatMap((preview) => Object.entries(preview.moved))
              .map(([id, m]) => (
                <View style={styles.card} key={id}>
                  <Body>{id}</Body>
                  <Body>
                    {m.from} → {m.to}
                  </Body>
                </View>
              ))}
            <Body>{previews.flatMap((p) => p.dropped).join('\n')}</Body>
            {(['absorb', 'shift', 'compress'] as const).map((option) => (
              <Button
                key={option}
                label={t(option)}
                onPress={() => {
                  if (input && pendingDay) setPreviews(previewNoClass(input, pendingDay, option));
                }}
              />
            ))}
            <Button
              label={t('apply')}
              primary
              disabled={!ladder.canWrite || hasIncompatibleMoves(previews)}
              onPress={() =>
                save(async () => {
                  if (hasIncompatibleMoves(previews)) {
                    setMessage('conflict');
                    return;
                  }
                  if (!input || !pendingDay) return;
                  const undoRealignment = await applyPreviews(
                    rt.engine,
                    input,
                    pendingDay,
                    previews
                  );
                  setUndo(() => undoRealignment);
                  setPage('main');
                })
              }
            />
          </ScrollView>
        )}
        {undo && (
          <Button
            label={t('undo')}
            onPress={() =>
              save(async () => {
                await undo();
                setUndo(null);
              })
            }
          />
        )}
        {page === 'main' && (
          <View style={styles.nav}>
            <View style={{ flexDirection: 'row', gap: sizes.touchGap, flexWrap: 'wrap' }}>
              {(['week', 'lessons', 'community', 'class'] as const).map((key) => (
                <View key={key} style={{ flexGrow: 1, flexBasis: 0, minWidth: sizes.touchTarget }}>
                  <Button label={t(key)} onPress={() => setTab(key)} />
                  {tab === key && (
                    <View style={{ height: sizes.space.xs, backgroundColor: colors.talaTeal }} />
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const abort = { current: null as null | (() => void) };
