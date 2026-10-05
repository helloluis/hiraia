import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { card, fonts } from '../theme';
import { readAssessmentHistory } from './historyRepository';
import { assessmentRegistry, ASSESSMENT_EVALUATION_ENABLED } from './registry';
import { useAssessmentStore } from './store';
import type { AssessmentResult, Score } from './types';

const LANGUAGES = { en: 'English', tl: 'Tagalog', bis: 'Cebuano' };
const score = (value: Score) => `${value.correct} / ${value.total}`;
const date = (value: string) => new Date(value).toLocaleString();

/** Keep the read-only report behind the same admission boundary as the assessment. */
export function AssessmentHistory({ profileId }: { profileId: string }) {
  if (!ASSESSMENT_EVALUATION_ENABLED && !assessmentRegistry.productionEnabled) return null;
  return <HistoryContent profileId={profileId} />;
}

function HistoryContent({ profileId }: { profileId: string }) {
  const currentHistory = useAssessmentStore((state) => state.history);
  const [loaded, setLoaded] = useState<{ profileId: string; history: AssessmentResult[] } | null>(null);
  const [failure, setFailure] = useState<{ profileId: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    let request = 0;
    setLoaded(null);
    setFailure(null);
    setExpanded(null);
    const refresh = async () => {
      const thisRequest = ++request;
      try {
        const history = await readAssessmentHistory(profileId, ASSESSMENT_EVALUATION_ENABLED ? 'local_evaluation' : 'production');
        if (active && request === thisRequest) {
          setLoaded({ profileId, history });
          setFailure(null);
        }
      } catch {
        if (active && request === thisRequest) {
          setLoaded(null);
          setFailure({ profileId, message: 'Saved assessments could not be read. Your records have not been changed.' });
        }
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { active = false; subscription.remove(); };
  }, [profileId, currentHistory, revision]));
  // Clear the visible rows on the first render of a changed profile, before effects run.
  const history = loaded?.profileId === profileId ? loaded.history : null;
  const error = failure?.profileId === profileId ? failure.message : '';
  const groups = useMemo(() => {
    const mode = ASSESSMENT_EVALUATION_ENABLED ? 'local_evaluation' : 'production';
    const grouped = new Map<string, { key: string; support: boolean; attempts: AssessmentResult[] }>();
    const attempts = (history ?? []).filter((result) => result.session.profileId === profileId && result.session.admissionMode === mode)
      .slice().sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
    for (const result of attempts) {
      const support = result.session.answers.some((answer) => answer.supportUsed === 'read_aloud');
      const key = `${result.session.comparisonKey}:${support ? 'read-aloud' : 'unaided'}`;
      const group = grouped.get(key) ?? { key, support, attempts: [] };
      group.attempts.push(result);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [history, profileId]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">Hiraia assessment history</Text>
      <Text style={styles.note}>
        All saved recall checks for this profile. These results describe learning within Hiraia;
        they are not a school exam, a grade-level decision, or proof of Revised K-12 Curriculum mastery.
        A teacher can use them alongside classroom observations.
      </Text>
      {ASSESSMENT_EVALUATION_ENABLED && (
        <Text style={styles.note}>Evaluation preview: teacher, language and student-pilot reviews remain pending.</Text>
      )}
      {error ? (
        <View style={styles.details}>
          <Text style={styles.body} accessibilityRole="alert">{error}</Text>
          <Pressable style={styles.attemptButton} accessibilityRole="button" onPress={() => setRevision((value) => value + 1)}>
            <Text style={styles.action}>Try reading the history again</Text>
          </Pressable>
        </View>
      ) : !history ? (
        <Text style={styles.body}>Loading saved assessments…</Text>
      ) : groups.length === 0 ? (
        <Text style={styles.body}>No completed Hiraia assessments saved for this profile.</Text>
      ) : (
        <>
          <Text style={styles.note}>
            Results are grouped by grade, language, reading support and question coverage.
            Benchmark difficulty has not been calibrated. Compare these small samples cautiously;
            total scores can change when the mix of questions changes.
          </Text>
          {groups.map((group, groupIndex) => {
            const first = group.attempts[0]!;
            const latest = group.attempts[group.attempts.length - 1]!;
            return (
              <View style={styles.group} key={group.key}>
                <Text style={styles.subheading} accessibilityRole="header">
                  Group {groupIndex + 1} · Grade {first.session.grade} · {LANGUAGES[first.session.language]}
                </Text>
                <Text style={styles.note}>
                  {group.support ? 'Read-aloud used on one or more items' : 'No read-aloud recorded'}
                  {' · '}{group.attempts.length} saved {group.attempts.length === 1 ? 'attempt' : 'attempts'}
                </Text>
                <Text style={styles.body}>
                  Starting benchmark: {score(first.benchmark)} · {date(first.completedAt)}
                </Text>
                <Text style={styles.body}>
                  Latest benchmark: {score(latest.benchmark)} · {date(latest.completedAt)}
                </Text>
                <Text style={styles.body}>
                  Recent-card questions: starting {score(first.recent)} · latest {score(latest.recent)}
                </Text>
                <Text style={styles.note}>
                  Recent-card counts show the questions actually included; six recent questions are not always available.
                </Text>
                {[...group.attempts].reverse().map((result) => {
                  const open = expanded === result.session.id;
                  return (
                    <View style={styles.attempt} key={result.session.id}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        onPress={() => setExpanded(open ? null : result.session.id)}
                        style={styles.attemptButton}
                      >
                        <Text style={styles.subheading}>
                          {date(result.completedAt)} · {result.session.kind === 'baseline' ? 'Starting check' : 'Follow-up'}
                        </Text>
                        <Text style={styles.body}>
                          Total {score(result.score)} · Benchmark {score(result.benchmark)}
                        </Text>
                        <Text style={styles.body}>
                          Recent {score(result.recent)} · Earlier foundations {score(result.readiness)}
                        </Text>
                        <Text style={styles.note}>
                          {result.session.exactRepeats} exact item repeats from the previous three attempts.
                        </Text>
                        {result.comparison && (
                          <Text style={styles.body}>
                            Benchmark change: {result.comparison.benchmarkDifference > 0 ? '+' : ''}{result.comparison.benchmarkDifference}
                            {' '}correct compared with {date(result.comparison.previousCompletedAt)}.
                          </Text>
                        )}
                        <Text style={styles.action}>{open ? 'Hide questions and insights' : 'Show questions and insights'}</Text>
                      </Pressable>
                      {open && (
                        <View style={styles.details}>
                          <Text style={styles.note}>
                            One response is a small observation. A missed answer suggests a recheck;
                            repeated misses may suggest more practice. No automatic grade change is made.
                          </Text>
                          {result.session.items.map((item, index) => {
                            const answer = result.session.answers.find((entry) => entry.itemId === item.itemId);
                            const selected = item.options.find((option) => option.id === answer?.optionId);
                            const correct = item.options.find((option) => option.id === item.correctOptionId);
                            const insight = result.targetInsights.find((entry) => entry.targetId === item.targetId);
                            const label = insight?.recommendation === 'remembered' ? 'Remembered this time'
                              : insight?.recommendation === 'reinforce' ? 'More practice may help' : 'Recheck this idea';
                            return (
                              <View key={item.id} style={styles.item}>
                                <Text style={styles.subheading}>{index + 1}. {item.stem}</Text>
                                <Text style={styles.body}>Answer: {selected?.text ?? 'Not recorded'}</Text>
                                <Text style={styles.body}>Correct answer: {correct?.text ?? 'Not recorded'}</Text>
                                <Text style={styles.body}>{item.explanation}</Text>
                                <Text style={styles.note}>{label}{insight ? ` · ${insight.correct} / ${insight.total} for this target` : ''}</Text>
                                <Text style={styles.note}>Idea checked: {item.claim}</Text>
                                <Text style={styles.note}>Scope: {item.claimLimit}</Text>
                                <Text style={styles.note}>Target: {item.targetId} · Item: {item.itemId}, revision {item.revision}</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
          <Text style={styles.note}>Saved on this device. This report does not send assessment results to a teacher or server.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 12, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: card.olive },
  heading: { fontFamily: fonts.cardBodyBold, fontSize: 21, lineHeight: 28, color: card.ink },
  subheading: { fontFamily: fonts.cardBodyBold, fontSize: 16, lineHeight: 23, color: card.ink },
  body: { fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 22, color: card.ink },
  note: { fontFamily: fonts.cardBody, fontSize: 13, lineHeight: 19, color: card.olive },
  group: { gap: 10, borderWidth: 1, borderColor: card.sage, borderRadius: 8, padding: 12 },
  attempt: { borderTopWidth: 1, borderColor: card.sage },
  attemptButton: { gap: 8, paddingVertical: 14, minHeight: 48 },
  action: { fontFamily: fonts.cardBodyBold, fontSize: 15, lineHeight: 22, color: card.teal },
  details: { gap: 12, paddingBottom: 12 },
  item: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: card.sage },
});
