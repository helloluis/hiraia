import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useProfiles } from '../profiles';
import { useEngineStore } from '../store/engineStore';
import { card, fonts } from '../theme';
import { assessmentRegistry, ASSESSMENT_EVALUATION_ENABLED } from './registry';
import { useAssessmentStore } from './store';
import { assessmentCopy } from './uiCopy';

const ENABLED = ASSESSMENT_EVALUATION_ENABLED || assessmentRegistry.productionEnabled;

/** An explicit start is independent of the automatic fortnightly reminder. */
export function AssessmentSettings() {
  const router = useRouter();
  const profiles = useProfiles();
  const language = useEngineStore(s => s.language) ?? 'tagalog';
  const grade = useEngineStore(s => s.grade);
  const busy = useAssessmentStore(s => s.busy);
  const [starting, setStarting] = useState(false);
  const pressed = useRef(false);
  const t = assessmentCopy(language);
  if (!ENABLED) return null;
  const disabled = starting || busy || !profiles.ready || !profiles.hasChoice || profiles.choosing;

  const start = async () => {
    if (disabled || pressed.current) return;
    pressed.current = true;
    setStarting(true);
    try {
      // requestStart persists before opening, resumes an unfinished attempt, and retains
      // content eligibility, profile isolation, answer storage and result history.
      await useAssessmentStore.getState().requestStart({ profileId: profiles.activeId, grade, language });
      router.back();
    } finally {
      pressed.current = false;
      setStarting(false);
    }
  };

  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: starting }}
      disabled={disabled} onPress={() => void start()}
      style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.label}>{starting ? t.loading : t.nudge}</Text>
    </Pressable>
    {ASSESSMENT_EVALUATION_ENABLED && <Text style={styles.note}>{t.previewNote}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 20, gap: 8 },
  button: { minHeight: 52, padding: 14, borderWidth: 3, borderRadius: 12,
    borderColor: card.ink, backgroundColor: card.gold, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  label: { fontFamily: fonts.cardBodyBold, fontSize: 18, color: card.ink },
  note: { fontFamily: fonts.cardBody, fontSize: 14, lineHeight: 20, color: card.ink },
});
