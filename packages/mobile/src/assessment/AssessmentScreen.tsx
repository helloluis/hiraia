import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardSpeaker } from '../components/cards/CardSpeaker';
import { useProfiles } from '../profiles';
import { useEngineStore } from '../store/engineStore';
import { card, fonts } from '../theme';
import { stop as stopSpeech } from '../voice/player';
import { useAssessmentStore } from './store';
import { assessmentRegistry, ASSESSMENT_EVALUATION_ENABLED } from './registry';
import { assessmentCopy, assessmentUiLanguage, canLeaveAssessmentError } from './uiCopy';
import { AssessmentDiagramView } from './AssessmentDiagramView';
import { AssessmentQuestions } from './AssessmentQuestions';

const EVALUATION = ASSESSMENT_EVALUATION_ENABLED;
const ENABLED = EVALUATION || assessmentRegistry.productionEnabled;

/** A native modal owns the whole session, including process-restored sessions and failures. */
export function AssessmentScreen() {
  const profiles = useProfiles();
  const grade = useEngineStore((s) => s.grade);
  const selectedLanguage = useEngineStore((s) => s.language) ?? 'tagalog';
  const state = useAssessmentStore();
  const { activeSession: session, results, hydrate } = state;
  const language = assessmentUiLanguage(session?.language ?? results?.session.language ?? selectedLanguage);
  const t = assessmentCopy(language);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [pendingOption, setPendingOption] = useState<{ itemId: string; optionId: string } | null>(null);
  const saving = useRef(false);
  const usedReadAloud = useRef(new Set<string>());
  const scroll = useRef<ScrollView>(null);
  const visible = ENABLED && (!state.loaded || !!session || !!results || !!state.error);

  useEffect(() => {
    if (!ENABLED || !profiles.ready || !profiles.hasChoice || profiles.choosing) return;
    void hydrate({ profileId: profiles.activeId, grade, language: selectedLanguage });
  }, [profiles.ready, profiles.hasChoice, profiles.choosing, profiles.activeId, grade, selectedLanguage, hydrate]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
      if (next !== 'active') stopSpeech();
      else if (ENABLED && profiles.ready && profiles.hasChoice && !profiles.choosing) {
        // Recompute a 14-day due entry on foreground; this never starts a quiz itself.
        void hydrate({ profileId: profiles.activeId, grade, language: selectedLanguage });
      }
    });
    return () => listener.remove();
  }, [profiles.ready, profiles.hasChoice, profiles.choosing, profiles.activeId, grade, selectedLanguage, hydrate]);

  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    stopSpeech();
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      back.remove();
      stopSpeech();
    };
  }, [visible]);

  useEffect(() => {
    setPendingOption(null);
    usedReadAloud.current.clear();
    scroll.current?.scrollTo({ y: 0, animated: false });
    stopSpeech();
  }, [session?.id, results?.completedAt]);

  const answer = async (itemId: string, optionId: string) => {
    if (!session || saving.current || pendingOption || state.busy || state.error) return;
    saving.current = true;
    stopSpeech();
    setPendingOption({ itemId, optionId });
    // Save the selected item before displaying its answer. Browsing does not
    // change the pending item; retry() always retries the same durable choice.
    try {
      await state.answer({ sessionId: session.id, itemId, optionId, supportUsed: usedReadAloud.current.has(itemId) ? 'read_aloud' : 'none' });
    } finally {
      saving.current = false;
      setPendingOption(null);
    }
  };

  const closeResults = async () => {
    if (!results || results.session.answers.length !== 12 || state.busy) return;
    stopSpeech();
    await state.dismissResults();
  };

  const validResults = results && results.session.answers.length === 12 && results.score.total === 12;
  const invalidSession = !!session && session.items.length !== 12;
  const recovering = !!state.error || invalidSession;
  const canLeaveError = canLeaveAssessmentError(state.loaded, !!session, !!results);
  const errorMessage = state.error.startsWith('The device date ')
    ? t.dateError : canLeaveError ? t.startError : t.error;

  if (!ENABLED) return null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      allowSwipeDismissal={false}
      onRequestClose={() => { /* Complete the session before leaving. */ }}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.heading}>
          <Text style={styles.brand}>{t.title}</Text>
          {EVALUATION && <Text style={styles.preview}>{t.preview}</Text>}
        </View>
        {!recovering && !validResults && session && !invalidSession ? (
          <AssessmentQuestions key={session.id} session={session} language={language}
            foreground={foreground} busy={state.busy} pending={pendingOption}
            onAnswer={(itemId, optionId) => void answer(itemId, optionId)}
            onReadAloud={itemId => usedReadAloud.current.add(itemId)} />
        ) : <ScrollView
          ref={scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          accessibilityViewIsModal
        >
          {recovering ? (
            <View style={styles.paper}>
              <Text style={styles.body} accessibilityRole="alert">{errorMessage}</Text>
              <Pressable
                style={styles.continue}
                disabled={state.busy}
                onPress={() => void state.retry()}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{state.busy ? t.loading : t.retry}</Text>
              </Pressable>
              {canLeaveError && (
                <Pressable
                  style={styles.secondary}
                  disabled={state.busy}
                  onPress={() => void state.cancelStart()}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>{t.finish}</Text>
                </Pressable>
              )}
            </View>
          ) : validResults ? (
            <View style={styles.paper}>
              <Text style={styles.title} accessibilityRole="header">{t.done}</Text>
              <Text style={styles.score}>{results.score.correct} / 12</Text>
              <Text style={styles.centeredBody}>{t.correct}</Text>
              <Text style={styles.body}>{t.scope}</Text>
              {EVALUATION && <Text style={styles.note}>{t.previewNote}</Text>}
              <View style={styles.metrics}>
                {[
                  { label: t.benchmark, metric: results.benchmark },
                  { label: t.recent, metric: results.recent },
                  { label: t.readiness, metric: results.readiness },
                ].map(({ label, metric }) => (
                  <View key={label} style={styles.metric}>
                    <Text style={styles.metricLabel}>{label}</Text>
                    <Text style={styles.metricValue}>{metric.correct} / {metric.total}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.note}>{t.counts}</Text>
              {results.recent.total === 0 && <Text style={styles.note}>{t.noRecent}</Text>}
              <Text style={styles.body}>{results.session.kind === 'baseline' ? t.baseline : results.comparison ? t.comparison : t.comparisonStart}</Text>
              {results.comparison && (
                <Text style={styles.body}>
                  {t.benchmarkChange}: {results.comparison.benchmarkDifference > 0 ? '+' : ''}{results.comparison.benchmarkDifference} ({t.benchmark.toLowerCase()})
                </Text>
              )}
              <Text style={styles.sectionTitle} accessibilityRole="header">{t.review}</Text>
              {results.session.items.map((item, index) => {
                const selected = results.session.answers.find((entry) => entry.itemId === item.itemId);
                const selectedText = item.options.find((option) => option.id === selected?.optionId)?.text;
                const correctText = item.options.find((option) => option.id === item.correctOptionId)?.text;
                const remembered = selected?.optionId === item.correctOptionId;
                const insight = results.targetInsights.find((entry) => entry.targetId === item.targetId);
                return (
                  <View key={item.id} style={styles.reviewItem}>
                    <Text style={styles.insight}>{remembered ? t.remembered : insight?.recommendation === 'reinforce' ? t.reinforce : t.recheck}</Text>
                    <Text style={styles.reviewQuestion}>{index + 1}. {item.stem}</Text>
                    {item.diagram && <AssessmentDiagramView diagram={item.diagram} language={results.session.language} />}
                    <Text style={styles.body}>{t.yourAnswer}: {selectedText}</Text>
                    {!remembered && <Text style={styles.answer}>{t.answer}: {correctText}</Text>}
                    <Text style={styles.body}>{item.explanation}</Text>
                    {foreground && (
                      <CardSpeaker
                        text={`${item.stem}. ${t.answer}: ${correctText}. ${item.explanation}`}
                        language={language}
                      />
                    )}
                  </View>
                );
              })}
              <Pressable style={styles.continue} onPress={() => void closeResults()} disabled={state.busy} accessibilityRole="button">
                <Text style={styles.buttonText}>{t.finish}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={card.stock} />
              <Text style={styles.loadingText}>{t.loading}</Text>
            </View>
          )}
        </ScrollView>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: card.board },
  heading: { paddingHorizontal: 20, paddingVertical: 14, gap: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: fonts.cardBodyBold, fontSize: 22, color: card.stock },
  preview: { fontFamily: fonts.cardBody, fontSize: 14, color: card.gold },
  scrollContent: { padding: 12, paddingBottom: 24, flexGrow: 1 },
  paper: { backgroundColor: card.stock, borderColor: card.ink, borderWidth: 3, borderRadius: 18, padding: 20, gap: 16 },
  title: { fontFamily: fonts.cardBodyBold, fontSize: 28, lineHeight: 35, color: card.ink, textAlign: 'center' },
  score: { fontFamily: fonts.cardBodyBold, fontSize: 60, lineHeight: 70, color: card.ink, textAlign: 'center' },
  body: { fontFamily: fonts.cardBody, fontSize: 18, lineHeight: 25, color: card.ink },
  centeredBody: { fontFamily: fonts.cardBodyBold, fontSize: 18, lineHeight: 25, color: card.ink, textAlign: 'center' },
  note: { fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 21, color: card.olive },
  continue: { backgroundColor: card.gold, borderColor: card.ink, borderWidth: 2, borderRadius: 12, minHeight: 56, padding: 14, justifyContent: 'center', marginTop: 8 },
  secondary: { backgroundColor: card.stock, borderColor: card.ink, borderWidth: 2, borderRadius: 12, minHeight: 56, padding: 14, justifyContent: 'center' },
  buttonText: { fontFamily: fonts.cardBodyBold, fontSize: 20, lineHeight: 27, textAlign: 'center', color: card.ink },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.cardBody, fontSize: 18, color: card.stock },
  metrics: { gap: 12, borderTopColor: card.sage, borderTopWidth: 1, borderBottomColor: card.sage, borderBottomWidth: 1, paddingVertical: 16 },
  metric: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  metricLabel: { flex: 1, fontFamily: fonts.cardBody, fontSize: 17, lineHeight: 24, color: card.ink },
  metricValue: { fontFamily: fonts.cardBodyBold, fontSize: 21, color: card.ink },
  sectionTitle: { fontFamily: fonts.cardBodyBold, fontSize: 24, lineHeight: 32, color: card.ink, marginTop: 8 },
  reviewItem: { gap: 12, borderTopColor: card.sage, borderTopWidth: 1, paddingVertical: 16 },
  insight: { fontFamily: fonts.cardBodyBold, fontSize: 15, lineHeight: 21, color: card.olive },
  reviewQuestion: { fontFamily: fonts.cardBodyBold, fontSize: 20, lineHeight: 27, color: card.ink },
  answer: { fontFamily: fonts.cardBodyBold, fontSize: 18, lineHeight: 25, color: card.ink },
});
