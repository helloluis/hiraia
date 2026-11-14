/**
 * One learner's activity: overview, the three school periods, and days by topic — Tala 0.4.4's
 * StudentCarousel (branch tala-0.4.x) as a plain screen. Previous/Next move between the class's
 * learners (48 dp controls); Remove from class sits last behind a confirmation (SIMPLE-11); linking
 * to a roster row is an explicit choice (ACT-6). No card content is shown here — Tala only ever
 * receives card ids, so the card-layout guidance (illustration proportion, ~20 px body) applies to
 * the student app's cards, not to these counts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { colors, sizes } from '@hiraia/tala-core/tokens';
import { Body, Button, Title, styles } from '../../ui/components';
import { HiHeader } from './ActivityScreen';
import {
  ANIMALS,
  AVATAR_COLORS,
  NO_SUBCATEGORY,
  dayActivity,
  dayBounds,
  isoDay,
  schoolPeriods,
  totalsOf,
  type ActivityTotals,
  type DayActivity,
  type RosterCard,
} from './learning';
import type { ActivityRuntime } from './runtime';
import type { StudentRow } from './store';
import { activityStrings, type ActivityT } from './strings';

export type RosterRow = { id: string; name: string };

export type LearnerScreenProps = {
  rt: ActivityRuntime;
  roster: RosterCard<StudentRow>[];
  index: number;
  language: 'fil' | 'en';
  /** Roster rows of the planning class (from the LocalStore), for explicit linking. */
  rosterRows?: RosterRow[];
  onBack(): void;
  onSettings?(): void;
  onChanged?(): void;
};

const DAYS_PER_PAGE = 5;

export function describeTotals(t: ActivityT, totals: ActivityTotals): string {
  const parts: string[] = [];
  if (totals.viewed > 0)
    parts.push(
      (totals.viewed === 1 ? t('cardSummary') : t('cardsSummary', { n: totals.viewed })) +
        (totals.unique > 0 ? t('uniqueSummary', { n: totals.unique }) : '')
    );
  if (totals.quizzes > 0)
    parts.push(
      totals.quizzes === 1
        ? t('quizSummary', { c: totals.correct })
        : t('quizzesSummary', { n: totals.quizzes, c: totals.correct })
    );
  return parts.join(' · ');
}

function Row({
  label,
  value,
  shaded,
  heading,
}: {
  label: string;
  value: string;
  shaded?: boolean;
  heading?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: sizes.space.sm,
        paddingHorizontal: sizes.space.md,
        backgroundColor: heading ? colors.placeholder : shaded ? colors.cream : colors.white,
      }}
    >
      <Text
        style={[
          styles.body,
          {
            flex: 1,
            color: heading ? colors.talaTealText : colors.forestMuted,
            fontSize: heading ? sizes.textSmall : sizes.textBody,
          },
        ]}
      >
        {label}
      </Text>
      <Text style={[styles.body, { textAlign: 'right', fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

export function LearnerScreen(props: LearnerScreenProps) {
  const { rt, roster, language, rosterRows, onBack, onSettings, onChanged } = props;
  const t = useMemo(() => activityStrings(language), [language]);
  const [index, setIndex] = useState(props.index);
  const card = roster[index]!;
  const student = card.student;
  const [periodTotals, setPeriodTotals] = useState<ActivityTotals[]>([]);
  const [days, setDays] = useState<DayActivity[]>([]);
  const [before, setBefore] = useState<number>(Number.MAX_SAFE_INTEGER);
  const [more, setMore] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(student.rosterStudentId);
  const [uniqueCards, setUniqueCards] = useState(0);
  const calendar = useMemo(() => ({ isoDay, dayBounds }), []);
  const formatted = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString() : t('never'));
  const todayIso = isoDay(Date.now());
  const yesterdayIso = isoDay(Date.now() - 86_400_000);

  const loadDays = useCallback(
    async (from: number, reset: boolean) => {
      const page = await rt.store.learningDays(student, from, DAYS_PER_PAGE, calendar);
      const built: DayActivity[] = [];
      for (const d of page) built.push(await dayActivity(d.date, d.events, rt.catalog));
      setDays((prev) => (reset ? built : [...prev, ...built]));
      const oldest = page.at(-1);
      const next = oldest ? dayBounds(oldest.date).start : from;
      setBefore(next);
      setMore(oldest ? (await rt.store.latestLearningBefore(student, next)) !== null : false);
    },
    [rt, student, calendar]
  );

  useEffect(() => {
    setLinkedId(student.rosterStudentId);
    setLinking(false);
    void (async () => {
      const periods = schoolPeriods(Date.now());
      const events = await rt.store.learningEvents(
        student,
        Math.min(...periods.map((p) => p.start)),
        Math.max(...periods.map((p) => p.end))
      );
      setPeriodTotals(
        periods.map((p) =>
          totalsOf(events.filter((e) => e.occurredAt >= p.start && e.occurredAt < p.end))
        )
      );
      setUniqueCards(totalsOf(await rt.store.learningEvents(student)).unique);
      await loadDays(Number.MAX_SAFE_INTEGER, true);
    })();
  }, [rt, student, loadDays]);

  const confirmRemove = () => {
    Alert.alert(
      t('removeTitle', { name: card.displayName }),
      student.profileId === 'guest' ? t('removeGuestBody') : t('removeBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: () => {
            void rt.store.removeStudent(student).then(() => {
              onChanged?.();
              onBack();
            });
          },
        },
      ]
    );
  };

  const link = async (rosterStudentId: string | null) => {
    await rt.store.linkRosterStudent(student, rosterStudentId);
    setLinkedId(rosterStudentId);
    setLinking(false);
    onChanged?.();
  };

  const periodLabels = [t('today'), t('lastSchoolDay'), t('lastSchoolWeek')];
  const periodRow = (label: string, pick: (x: ActivityTotals) => number, shaded: boolean) => (
    <View
      key={label}
      style={{
        flexDirection: 'row',
        paddingVertical: sizes.space.sm,
        paddingHorizontal: sizes.space.md,
        backgroundColor: shaded ? colors.cream : colors.white,
      }}
    >
      <Text
        style={[styles.body, { flex: 1.6, color: colors.forestMuted, fontSize: sizes.textSmall }]}
      >
        {label}
      </Text>
      {periodTotals.map((x, i) => (
        <Text key={i} style={[styles.body, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>
          {pick(x)}
        </Text>
      ))}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.pad}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <HiHeader t={t} onSettings={onSettings} />
          <Button label={t('back')} onPress={onBack} />
        </View>
        <Text
          style={[
            styles.body,
            { color: colors.talaTealText, fontSize: sizes.textSmall, fontWeight: '600' },
          ]}
        >
          {t('learnerActivity').toUpperCase()} · {index + 1} / {roster.length}
        </Text>
        <View style={{ alignItems: 'center', gap: sizes.space.sm, marginVertical: sizes.space.md }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 25,
              backgroundColor: AVATAR_COLORS[card.colorIndex],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 40 }}>{ANIMALS[card.animalIndex]}</Text>
          </View>
          <Title>{card.displayName}</Title>
          {student.leftAt > 0 && <Body>{t('leftClass', { date: isoDay(student.leftAt) })}</Body>}
          {linkedId && (
            <Body>
              {t('linkedTo', {
                name: rosterRows?.find((r) => r.id === linkedId)?.name ?? linkedId,
              })}
            </Body>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: sizes.touchGap }}>
          <View style={{ flex: 1 }}>
            <Button
              label={`← ${t('previous')}`}
              disabled={index === 0}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={`${t('next')} →`}
              disabled={index >= roster.length - 1}
              onPress={() => setIndex((i) => Math.min(roster.length - 1, i + 1))}
            />
          </View>
        </View>

        <Title>{t('overview')}</Title>
        <View style={{ borderRadius: sizes.radiusSmall, overflow: 'hidden' }}>
          <Row label={t('lastConnection')} value={formatted(student.lastSeen)} />
          <Row label={t('lastTransfer')} value={formatted(student.lastSync)} shaded />
          <Row label={t('storedEvents')} value={String(student.events)} />
          <Row label={t('cardsViewed')} value={String(student.cards)} shaded />
          <Row label={t('uniqueCards')} value={String(uniqueCards)} />
          <Row label={t('quizAnswers')} value={String(student.quizzes)} shaded />
          <Row label={t('correctAnswers')} value={String(student.correct)} />
          <Row label={t('deviceFailures')} value={String(student.failures)} shaded />
          <Row
            label={t('lastBatch', {
              accepted: student.lastAccepted,
              rejected: student.lastRejected,
            })}
            value=""
          />
        </View>

        <Title>{t('learningActivity')}</Title>
        <View style={{ borderRadius: sizes.radiusSmall, overflow: 'hidden' }}>
          <View
            style={{
              flexDirection: 'row',
              paddingVertical: sizes.space.sm,
              paddingHorizontal: sizes.space.md,
              backgroundColor: colors.placeholder,
            }}
          >
            <View style={{ flex: 1.6 }} />
            {periodLabels.map((label) => (
              <Text
                key={label}
                style={[
                  styles.body,
                  {
                    flex: 1,
                    textAlign: 'right',
                    fontSize: sizes.textSmall,
                    color: colors.talaTealText,
                    fontWeight: '600',
                  },
                ]}
              >
                {label}
              </Text>
            ))}
          </View>
          {periodRow(t('totalViewed'), (x) => x.viewed, false)}
          {periodRow(t('uniqueViewed'), (x) => x.unique, true)}
          {periodRow(t('quizzesTaken'), (x) => x.quizzes, false)}
          {periodRow(t('quizzesCorrect'), (x) => x.correct, true)}
        </View>
        <Text style={[styles.body, { fontSize: sizes.textSmall, color: colors.forestMuted }]}>
          {t('countedByLearner')}
        </Text>

        <Title>{t('byDay')}</Title>
        {days.length === 0 && <Body>{t('noLearningYet')}</Body>}
        {days.map((day) => (
          <View
            key={day.date}
            style={{
              marginTop: sizes.space.md,
              borderRadius: sizes.radiusSmall,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                paddingVertical: sizes.space.sm,
                paddingHorizontal: sizes.space.md,
                backgroundColor: colors.placeholder,
              }}
            >
              <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>{day.date}</Text>
              {(day.date === todayIso || day.date === yesterdayIso) && (
                <Text
                  style={[styles.body, { color: colors.talaTealText, fontSize: sizes.textSmall }]}
                >
                  {day.date === todayIso ? t('today') : t('yesterday')}
                </Text>
              )}
            </View>
            {day.subcategories.length > 1 && (
              <Text
                style={[
                  styles.body,
                  {
                    paddingVertical: sizes.space.sm,
                    paddingHorizontal: sizes.space.md,
                    backgroundColor: colors.white,
                  },
                ]}
              >
                {describeTotals(t, day.totals)}
              </Text>
            )}
            {day.subcategories.map((sub, i) => (
              <View
                key={sub.label}
                style={{
                  paddingVertical: sizes.space.sm,
                  paddingLeft: sizes.space.xl,
                  paddingRight: sizes.space.md,
                  backgroundColor: i % 2 === 0 ? colors.cream : colors.white,
                }}
              >
                <Text style={[styles.body, { fontWeight: '600' }]}>
                  {sub.label === NO_SUBCATEGORY ? t('noSubcategory') : sub.label}
                </Text>
                <Text
                  style={[styles.body, { fontSize: sizes.textSmall, color: colors.forestMuted }]}
                >
                  {describeTotals(t, sub.totals)}
                </Text>
              </View>
            ))}
          </View>
        ))}
        {more && (
          <Button label={t('showEarlierDays')} onPress={() => void loadDays(before, false)} />
        )}
        <Text style={[styles.body, { fontSize: sizes.textSmall, color: colors.forestMuted }]}>
          {t('twoSubcategories')}
        </Text>

        <View style={{ marginTop: sizes.space.xl, gap: sizes.touchGap }}>
          {linkedId ? (
            <Button label={t('unlink')} onPress={() => void link(null)} />
          ) : (
            <Button label={t('linkRoster')} onPress={() => setLinking((v) => !v)} />
          )}
          {linking && (
            <View style={styles.card}>
              <Body>{t('linkNote')}</Body>
              {!rosterRows?.length && <Body>{t('noRoster')}</Body>}
              {rosterRows?.map((row) => (
                <Button key={row.id} label={row.name} onPress={() => void link(row.id)} />
              ))}
            </View>
          )}
          <View style={{ marginTop: sizes.space.lg }}>
            <Button label={t('removeFromClass')} onPress={confirmRemove} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
