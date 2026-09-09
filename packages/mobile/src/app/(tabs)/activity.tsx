import { useProfiles } from '../../profiles';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GradeLevel } from '@hiraia/shared';
import { curriculumOutline, cardsForTopic, topicTitle } from '../../data/cards';
import { useEngineStore } from '../../store/engineStore';
import { card, fonts } from '../../theme';
import { detailedActivity } from '../../telemetry';
import {
  activityDateRange,
  activityWindows,
  totalActivity,
  type ActivityReport,
} from '../../telemetry/activity';

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const number = (n: number) => n.toLocaleString();
export default function ActivityScreen() {
  const router = useRouter();
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(profiles.activeId);
  const currentGrade = useEngineStore((s) => s.grade);
  const language = useEngineStore((s) => s.language) || 'english';
  const [grade, setGrade] = useState<number | null>(currentGrade);
  const [period, setPeriod] = useState('All recorded');
  const [custom, setCustom] = useState<[number, number] | null>(null);
  const [from, setFrom] = useState(localDate(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(localDate(new Date()));
  const [dateError, setDateError] = useState(false);
  const [report, setReport] = useState<ActivityReport>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [curriculum, setCurriculum] = useState('All modules');
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const refresh = () => {
        const now = Date.now();
        const start =
          period === 'This week'
            ? activityWindows(now)[1]!
            : period === 'Last 30 days'
              ? now - 30 * 86400000
              : 0;
        void detailedActivity(custom?.[0] ?? start, Math.min(custom?.[1] ?? now, now), profileId)
          .then((r) => {
            if (alive) {
              setReport(r);
              setError(false);
            }
          })
          .catch(() => {
            if (alive) setError(true);
          });
      };
      setReport(undefined);
      refresh();
      const timer = setInterval(refresh, 60000);
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') refresh();
      });
      return () => {
        alive = false;
        clearInterval(timer);
        sub.remove();
      };
    }, [period, custom, revision, profileId])
  );
  const grades = useMemo(
    () =>
      Array.from(new Set([currentGrade, ...(report?.rows.map((r) => r.grade) ?? [])])).sort(
        (a, b) => (a ?? 99) - (b ?? 99)
      ),
    [report, currentGrade]
  );
  const selected = useMemo(
    () => report?.rows.filter((r) => r.grade === grade) ?? [],
    [report, grade]
  );
  const totals = useMemo(() => totalActivity(selected), [selected]);
  const modules = useMemo(() => {
    if (grade === null) return [];
    return curriculumOutline(grade as GradeLevel)
      .map((topic) => {
        const ids = cardsForTopic(topic);
        const rows = selected.filter((r) => r.cardId && ids.has(r.cardId));
        return { topic, total: ids.size, ...totalActivity(rows) };
      })
      .filter(
        (m) =>
          curriculum === 'All modules' ||
          curriculum === `Q${m.topic.quarter}` ||
          (curriculum === 'Semester 1 · Q1–Q2' && m.topic.quarter <= 2) ||
          (curriculum === 'Semester 2 · Q3–Q4' && m.topic.quarter >= 3)
      );
  }, [grade, selected, curriculum]);
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.active]}
    >
      <Text style={[styles.text, active && styles.activeText]}>{label}</Text>
    </Pressable>
  );
  const metric = (label: string, value: string) => (
    <View key={label} style={styles.metric}>
      <Text style={styles.big}>{value}</Text>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Device Activity</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.chip}>
          <Text style={styles.text}>Back to Settings</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.note}>
          Practice records for the selected profile on this device, not a student assessment. Guest
          activity combines students who skipped naming a profile.
        </Text>
        <Text style={styles.heading}>Student profile</Text>
        <View style={styles.wrap}>
          {chip('Guest', profileId === 'guest', () => setProfileId('guest'))}
          {profiles.profiles.map((p, i) =>
            chip(`${p.name} · ${i + 1}`, profileId === p.id, () => setProfileId(p.id))
          )}
        </View>
        <Text style={styles.heading}>When the activity happened</Text>
        <View style={styles.wrap}>
          {['This week', 'Last 30 days', 'All recorded'].map((p) =>
            chip(p, period === p, () => {
              setPeriod(p);
              setCustom(null);
            })
          )}
        </View>
        <Text style={styles.note}>
          For a school quarter or semester, enter its dates (YYYY-MM-DD).
        </Text>
        <View style={styles.wrap}>
          <TextInput
            accessibilityLabel="Start date YYYY-MM-DD"
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            style={styles.input}
            autoCorrect={false}
          />
          <TextInput
            accessibilityLabel="End date YYYY-MM-DD"
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            style={styles.input}
            autoCorrect={false}
          />
          {chip('Apply dates', period === 'Custom dates', () => {
            const dates = activityDateRange(from, to);
            setDateError(!dates || dates[0] > Date.now());
            if (dates && dates[0] <= Date.now()) {
              setCustom(dates);
              setPeriod('Custom dates');
            }
          })}
        </View>
        {dateError && (
          <Text accessibilityRole="alert" style={styles.text}>
            Enter valid dates, with the start no later than today or the end date.
          </Text>
        )}
        {error ? (
          <View>
            <Text accessibilityRole="alert" style={styles.text}>
              Activity could not be loaded.
            </Text>
            {chip('Retry', false, () => setRevision((n) => n + 1))}
          </View>
        ) : !report ? (
          <Text style={styles.text}>Loading activity…</Text>
        ) : (
          <>
            <Text style={styles.note}>
              {report.start ? new Date(report.start).toLocaleDateString() : 'All retained history'}{' '}
              – {new Date(report.end).toLocaleDateString()}
            </Text>
            <Text style={styles.heading}>By grade selected at the time</Text>
            <View style={styles.table}>
              <View style={styles.row}>
                {['Grade', 'Cards', 'Quizzes', 'Correct'].map((x) => (
                  <Text key={x} style={styles.cell}>
                    {x}
                  </Text>
                ))}
              </View>
              {grades.map((g) => {
                const t = totalActivity(report.rows.filter((r) => r.grade === g));
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: grade === g }}
                    key={g ?? 'unknown'}
                    onPress={() => setGrade(g)}
                    style={[styles.row, grade === g && styles.selected]}
                  >
                    {[
                      g === null ? 'Unknown' : String(g),
                      number(t.cards),
                      number(t.quizzes),
                      t.accuracy === null ? '—' : `${t.accuracy}%`,
                    ].map((x, i) => (
                      <Text key={i} style={styles.cell}>
                        {x}
                      </Text>
                    ))}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.heading}>
              {grade === null ? 'Unknown grade' : `Grade ${grade}`} details
            </Text>
            <View style={styles.wrap}>
              {metric('Cards viewed', number(totals.cards))}
              {metric('Distinct curated cards', number(totals.distinct))}
              {metric('Dynamic cards', number(totals.dynamic))}
              {metric('Active days', number(report.days.find((d) => d.grade === grade)?.days ?? 0))}
              {metric('Quizzes answered', number(totals.quizzes))}
              {metric('Correct answers', `${number(totals.correct)} / ${number(totals.quizzes)}`)}
            </View>
            {!!totals.lastSeen && (
              <Text style={styles.note}>
                Last activity {new Date(totals.lastSeen).toLocaleString()}
              </Text>
            )}
            {!totals.cards && !totals.quizzes && (
              <Text style={styles.text}>No activity for this grade in the selected dates.</Text>
            )}
            <Text style={styles.heading}>Curriculum modules</Text>
            <Text style={styles.note}>
              Coverage is distinct curated cards viewed out of available cards. Quiz accuracy
              includes repeat attempts. A card can belong to more than one module. Neither indicates
              mastery.
            </Text>
            <View style={styles.wrap}>
              {[
                'All modules',
                'Q1',
                'Q2',
                'Q3',
                'Q4',
                'Semester 1 · Q1–Q2',
                'Semester 2 · Q3–Q4',
              ].map((c) => chip(c, curriculum === c, () => setCurriculum(c)))}
            </View>
            <Text style={styles.note}>
              Q1–Q4 and semester groups describe curriculum content, independently of the activity
              dates above.
            </Text>
            {modules.map((m) => (
              <View key={m.topic.key} style={styles.module}>
                <Text style={styles.moduleTitle}>
                  {m.topic.key} · {topicTitle(m.topic, language)}
                </Text>
                <Text style={styles.text}>
                  {number(m.distinct)} / {number(m.total)} cards explored
                  {m.total ? ` · ${Math.round((m.distinct / m.total) * 100)}%` : ''}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${m.total ? Math.min(100, (m.distinct / m.total) * 100) : 0}%` },
                    ]}
                  />
                </View>
                <Text style={styles.text}>
                  {number(m.cards)} views · {number(m.quizzes)} quizzes ·{' '}
                  {m.accuracy === null
                    ? 'no quiz results'
                    : `${m.accuracy}% correct (${m.correct}/${m.quizzes})`}
                </Text>
              </View>
            ))}
            {!modules.length && (
              <Text style={styles.text}>No mapped modules for this selection.</Text>
            )}
            <Text style={styles.note}>
              Dynamic cards and content outside this grade’s mapped modules count in the grade
              totals. Module mappings follow the installed Hiraiapedia version.
            </Text>
            <Text style={styles.note}>
              Detailed tracking since {new Date(report.since).toLocaleString()}.{'\n'}Updated{' '}
              {new Date(report.asOf).toLocaleString()}.{'\n'}Older records with no saved grade
              appear under Unknown. Previously expired history cannot be recovered. Records stay on
              this device until app data is cleared.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: card.stock },
  header: { padding: 16, borderBottomWidth: 1, borderColor: card.sage, gap: 10 },
  title: { fontFamily: fonts.slab, fontSize: 28, color: card.ink },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  text: { fontFamily: fonts.cardBody, fontSize: 15, color: card.ink },
  note: { fontFamily: fonts.cardBody, fontSize: 13, color: card.olive },
  heading: { fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink, marginTop: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    padding: 10,
    borderWidth: 1,
    borderColor: card.ink,
    borderRadius: 6,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  active: { backgroundColor: card.ink },
  activeText: { color: card.stock },
  input: {
    borderWidth: 1,
    borderColor: card.olive,
    borderRadius: 6,
    padding: 10,
    minWidth: 130,
    color: card.ink,
    fontFamily: fonts.cardBody,
  },
  table: { borderWidth: 1, borderColor: card.olive, borderRadius: 6, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: card.sage,
    minHeight: 44,
  },
  cell: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
    fontSize: 14,
    textAlign: 'center',
  },
  selected: { backgroundColor: card.sage },
  metric: { width: '48%', padding: 12, borderWidth: 1, borderColor: card.sage, borderRadius: 6 },
  big: { fontFamily: fonts.cardBodyBold, fontSize: 24, color: card.ink },
  module: { padding: 12, borderWidth: 1, borderColor: card.sage, borderRadius: 6, gap: 8 },
  moduleTitle: { fontFamily: fonts.cardBodyBold, fontSize: 17, color: card.ink },
  track: { height: 6, backgroundColor: card.sage, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: card.ink },
});
