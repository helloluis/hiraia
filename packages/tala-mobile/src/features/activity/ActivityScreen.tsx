/**
 * "Collect activity" / Class QR — the teacher's one screen for classroom collection (PRD §4.3:
 * one primary action, 48 dp targets, labelled controls, Filipino first). Ported behaviour: Tala
 * 0.4.4 MainActivity's dashboard + QR dialog (branch tala-0.4.x). Tokens only; no hard-coded colour.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Image, Pressable, Text, View } from 'react-native';
import { colors, fonts, sizes } from '@hiraia/tala-core/tokens';
import { Body, Button, Title, styles } from '../../ui/components';
import { ANIMALS, AVATAR_COLORS, rosterCards, type RosterCard } from './learning';
import { formatManualCode } from './protocol';
import { preflight, type ActiveCollection, type ActivityRuntime, type ClassInput } from './runtime';
import type { CollectorStatus } from './session';
import type { StudentRow } from './store';
import { activityStrings, type ActivityT } from './strings';

export type LearnerState =
  | 'connected'
  | 'transferring'
  | 'received'
  | 'transferFailed'
  | 'connectionFailed'
  | 'disconnected';

export type ActivityScreenProps = {
  rt: ActivityRuntime;
  cls: ClassInput;
  language: 'fil' | 'en';
  onBack(): void;
  /** The compact "hi" mark doubles as the settings entry (card-layout guidance). */
  onSettings?(): void;
  onOpenLearner(student: StudentRow, roster: RosterCard<StudentRow>[]): void;
};

/** Header: a compact "hi" + Hiraia mark that also opens Settings; forest on cream, serif identity. */
export function HiHeader({ t, onSettings }: { t: ActivityT; onSettings?(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('settings')}
      onPress={onSettings}
      disabled={!onSettings}
      style={{
        minHeight: sizes.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: sizes.space.sm,
      }}
    >
      <Image
        source={require('../../../assets/hiraia-glyph.png')}
        accessibilityIgnoresInvertColors
        style={{ width: 28, height: 28 }}
      />
      <Text style={{ fontFamily: fonts.display, fontSize: sizes.textTitle, color: colors.forest }}>
        {t('hi')}
      </Text>
    </Pressable>
  );
}

export function ActivityScreen(props: ActivityScreenProps) {
  const { rt, cls, language, onBack, onSettings, onOpenLearner } = props;
  const t = useMemo(() => activityStrings(language), [language]);
  const [collection, setCollection] = useState<ActiveCollection | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [status, setStatus] = useState<{
    status: CollectorStatus;
    connections: number;
    detail?: string;
  }>({
    status: 'idle',
    connections: 0,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<{ pngUri: string } | null>(null);
  const [code, setCode] = useState<{ display: string; expiresAt: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterCard<StudentRow>[]>([]);
  const [states, setStates] = useState<Map<string, LearnerState>>(new Map());
  const [lastBatch, setLastBatch] = useState<{ accepted: number; rejected: number } | null>(null);
  const collectionRef = useRef<ActiveCollection | null>(null);
  const collectingRef = useRef(false);

  const refreshRoster = useCallback(async () => {
    const students = await rt.store.students(cls.classId);
    if (!rt.crypto) {
      setRoster(
        students.map((s) => ({ student: s, displayName: s.name, animalIndex: 0, colorIndex: 0 }))
      );
      return;
    }
    const sha = (b: Uint8Array) => rt.crypto!.sha256(b);
    const proposed = await rosterCards(students, sha);
    const saved = await rt.store.avatars(
      cls.classId,
      proposed.map((c) => ({
        installationId: c.student.installationId,
        profileId: c.student.profileId,
        animalIndex: c.animalIndex,
        colorIndex: c.colorIndex,
      }))
    );
    setRoster(
      proposed.map((c) => {
        const fixed = saved.get(`${c.student.installationId}:${c.student.profileId}`);
        return fixed ? { ...c, ...fixed } : c;
      })
    );
  }, [rt, cls.classId]);

  const setLearnerState = (installationId: string, state: LearnerState) =>
    setStates((prev) => new Map(prev).set(installationId, state));

  // One collection object per visit to the screen; the collector itself starts only after preflight.
  useEffect(() => {
    let cancelled = false;
    void refreshRoster();
    if (!rt.crypto) return;
    void rt
      .collect(cls, {
        onStatus: (s, connections, detail) => setStatus({ status: s, connections, detail }),
        onConnected: (id) => {
          setLearnerState(id, 'connected');
          void refreshRoster();
        },
        onTransfer: (id) => setLearnerState(id, 'transferring'),
        onSaved: (id, accepted, rejected) => {
          setLearnerState(id, 'received');
          if (accepted + rejected > 0) setLastBatch({ accepted, rejected });
          void refreshRoster();
        },
        onFailure: (id, duringTransfer) => {
          if (id) setLearnerState(id, duringTransfer ? 'transferFailed' : 'connectionFailed');
        },
        onDisconnected: (id) => setLearnerState(id, 'disconnected'),
      })
      .then((c) => {
        if (cancelled) c.dispose();
        else {
          collectionRef.current = c;
          setCollection(c);
        }
      });
    return () => {
      cancelled = true;
      collectionRef.current?.dispose();
      collectionRef.current = null;
    };
  }, [rt, cls.classId, cls.name, refreshRoster]);

  /** MainActivity.startCollection: explain the first thing that is missing, with one action. */
  const start = useCallback(async () => {
    const check = preflight(rt.availability());
    if (!check.ok) {
      setProblem(check.reason);
      if (check.reason === 'permission' && rt.native) {
        const granted = await rt.native.requestPermissions();
        if (granted) {
          setProblem(null);
          return start();
        }
        setProblem('permissionDenied');
      }
      return;
    }
    setProblem(null);
    collectingRef.current = true;
    setCollecting(true);
    await collectionRef.current?.collector.start();
  }, [rt]);

  const stop = useCallback(() => {
    collectingRef.current = false;
    setCollecting(false);
    collectionRef.current?.collector.stop();
  }, []);

  // Nearby runs only while the app is open (PRD §14.1 battery): pause in background, resume when back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') collectionRef.current?.collector.stop();
      else if (collectingRef.current && preflight(rt.availability()).ok)
        void collectionRef.current?.collector.start();
    });
    return () => sub.remove();
  }, [rt]);

  // QR panel: the payload is stable; the code ticks over once an hour.
  const refreshCode = useCallback(async () => {
    const ticket = await collectionRef.current?.collector.ticket();
    if (ticket) setCode({ display: formatManualCode(ticket.code), expiresAt: ticket.expiresAt });
  }, []);
  useEffect(() => {
    if (!showQr || !collection) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void collection.qr().then((q) => setQr({ pngUri: q.pngUri }));
    const tick = async () => {
      await refreshCode();
      const ticket = await collection.collector.ticket();
      timer = setTimeout(() => void tick(), Math.max(1000, ticket.expiresAt - Date.now()));
    };
    void tick();
    // Opening Class QR starts collection so enrolment does not race advertising (0.4.1).
    if (!collectingRef.current) void start();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showQr, collection, refreshCode, start]);

  const availability = rt.availability();
  const unavailable = !rt.native
    ? t('unavailableNoModule')
    : availability && !availability.supported
      ? t('unavailableAndroid')
      : null;

  const statusText = (() => {
    switch (status.status) {
      case 'starting':
        return t('statusStarting');
      case 'ready':
        return t('statusReady');
      case 'connecting':
        return t('statusConnecting');
      case 'collecting':
        return t('statusCollecting');
      case 'connectionFailed':
        return t('statusConnectionFailed');
      case 'advertisingFailed':
        return t('statusAdvertisingFailed', {
          code: (status.detail ?? '').replace(/^nearby-/, '') || '?',
        });
      case 'paused':
        return collecting ? t('statusPaused') : t('statusIdle');
      default:
        return t('statusIdle');
    }
  })();

  const problemView = problem && (
    <View style={[styles.card, { borderColor: colors.brick, borderWidth: 1 }]}>
      <Body>
        {problem === 'android'
          ? t('unavailableAndroid')
          : problem === 'noModule'
            ? t('unavailableNoModule')
            : problem === 'playServices'
              ? t('needPlayServices')
              : problem === 'permission'
                ? t('needPermission')
                : problem === 'permissionDenied'
                  ? t('permissionDenied')
                  : problem === 'noBluetooth'
                    ? t('noBluetooth')
                    : problem === 'bluetooth'
                      ? t('needBluetooth')
                      : problem === 'noWifi'
                        ? t('noWifi')
                        : t('needWifi')}
      </Body>
      {problem === 'bluetooth' && rt.native && (
        <Button
          label={t('turnOnBluetooth')}
          onPress={() => void rt.native!.requestBluetoothEnable()}
        />
      )}
      {problem === 'wifi' && rt.native && (
        <Button label={t('openWifiSettings')} onPress={() => void rt.native!.openWifiSettings()} />
      )}
      {(problem === 'permission' || problem === 'permissionDenied') && rt.native && (
        <Button label={t('allowNearby')} onPress={() => void start()} />
      )}
    </View>
  );

  const stateLabel = (s: LearnerState | undefined) =>
    s === 'connected'
      ? t('connected')
      : s === 'transferring'
        ? t('transferring')
        : s === 'received'
          ? t('received')
          : s === 'transferFailed'
            ? t('transferFailed')
            : s === 'connectionFailed'
              ? t('connectionFailed')
              : t('disconnected');

  const header = (
    <View style={{ gap: sizes.touchGap }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <HiHeader t={t} onSettings={onSettings} />
        <Button label={t('back')} onPress={onBack} />
      </View>
      <Title>{t('activityTitle')}</Title>
      <Body>{cls.name}</Body>
      {unavailable ? (
        <View style={styles.card}>
          <Body>{unavailable}</Body>
        </View>
      ) : (
        <>
          <Text style={[styles.body, { color: colors.talaTealText, fontWeight: '600' }]}>
            {statusText}
          </Text>
          {problemView}
          <Button
            primary
            label={collecting ? t('stopCollecting') : t('collect')}
            onPress={() => (collecting ? stop() : void start())}
          />
          <Button label={showQr ? t('hideQr') : t('showQr')} onPress={() => setShowQr((v) => !v)} />
          <Text style={[styles.body, { fontSize: sizes.textSmall, color: colors.forestMuted }]}>
            {t('sameRoomCollect')}
          </Text>
          {showQr && collection && (
            <View style={[styles.card, { alignItems: 'center' }]}>
              <Title>
                {cls.teacherName?.trim()
                  ? t('joinClass', { teacher: cls.teacherName.trim() })
                  : t('joinClassNoTeacher')}
              </Title>
              <Text
                style={[
                  styles.body,
                  { fontSize: sizes.textSmall, color: colors.forestMuted, textAlign: 'center' },
                ]}
              >
                {[
                  cls.name,
                  cls.gradeLevel && `Grade ${cls.gradeLevel}`,
                  cls.schoolYear,
                  cls.schoolName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {qr && (
                <Image
                  source={{ uri: qr.pngUri }}
                  accessibilityLabel={t('showQr')}
                  style={{ width: 280, height: 280, backgroundColor: colors.white }}
                  resizeMode="contain"
                />
              )}
              <Body>{t('cameraBroken')}</Body>
              <Text
                accessibilityLabel={code?.display}
                style={{
                  fontFamily: 'monospace',
                  fontSize: sizes.textTitle,
                  color: colors.forest,
                  letterSpacing: 1,
                  paddingVertical: sizes.space.sm,
                  paddingHorizontal: sizes.space.lg,
                  backgroundColor: colors.placeholder,
                  borderRadius: sizes.radiusSmall,
                }}
              >
                {code?.display ?? '—'}
              </Text>
              <Text style={[styles.body, { fontSize: sizes.textSmall, color: colors.forestMuted }]}>
                {t('codeValid')}
              </Text>
              <Text style={[styles.body, { fontWeight: '600', textAlign: 'center' }]}>
                {t('sameRoom')}
              </Text>
              <Button
                label={t('refreshCode')}
                onPress={() => {
                  collectionRef.current?.collector.clearTicket();
                  void refreshCode();
                  setToast(t('codeRefreshed'));
                  setTimeout(() => setToast(null), 4000);
                }}
              />
              {toast && <Body>{toast}</Body>}
            </View>
          )}
          <Title>{t('connectedLearners')}</Title>
          {status.connections > 0 && (
            <Body>{t('learnersConnected', { n: status.connections })}</Body>
          )}
          {lastBatch && <Body>{t('lastBatch', lastBatch)}</Body>}
          {roster.length === 0 && <Body>{t('noLearnersYet')}</Body>}
        </>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={unavailable ? [] : roster}
        keyExtractor={(c) => `${c.student.installationId}:${c.student.profileId}`}
        contentContainerStyle={styles.pad}
        ListHeaderComponent={header}
        ListFooterComponent={
          <Text
            style={[
              styles.body,
              { fontSize: sizes.textSmall, color: colors.forestMuted, marginTop: sizes.space.lg },
            ]}
          >
            {t('privacyNote')}
          </Text>
        }
        renderItem={({ item }) => {
          const state = states.get(item.student.installationId);
          const dim = !state || state === 'disconnected';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.displayName}, ${stateLabel(state)}`}
              onPress={() => onOpenLearner(item.student, roster)}
              style={[
                styles.card,
                { flexDirection: 'row', alignItems: 'center', opacity: dim ? 0.6 : 1 },
              ]}
            >
              <View
                style={{
                  width: sizes.touchTarget,
                  height: sizes.touchTarget,
                  borderRadius: sizes.radius,
                  backgroundColor: AVATAR_COLORS[item.colorIndex],
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: state === 'transferFailed' || state === 'connectionFailed' ? 2 : 0,
                  borderColor: colors.brick,
                }}
              >
                <Text style={{ fontSize: 24 }}>{ANIMALS[item.animalIndex]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Body>{item.displayName}</Body>
                <Text
                  style={[
                    styles.body,
                    {
                      fontSize: sizes.textSmall,
                      color: dim ? colors.forestMuted : colors.talaTealText,
                    },
                  ]}
                >
                  {stateLabel(state)} · {item.student.cards} {t('cardsViewed').toLowerCase()}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
