import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import { card, fonts } from '../theme';
import { setQuizSoundsEnabled, useQuizSoundSettings } from './quizSounds';

const labels = {
  english: ['Quiz sounds', 'Could not save. Please try again.'],
  tagalog: ['Mga tunog sa quiz', 'Hindi na-save. Pakisubukan muli.'],
  cebuano: ['Mga tingog sa quiz', 'Wala ma-save. Sulayi pag-usab.'],
};
export function QuizSoundSettings({ language }: { language: Language }) {
  const { ready, enabled } = useQuizSoundSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [label, failure] = labels[language];
  return (
    <View style={{ marginTop: 18 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={{ fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink }}>
          {label}
        </Text>
        <Switch
          accessibilityLabel={label}
          value={enabled}
          disabled={!ready || saving}
          trackColor={{ false: card.sage, true: card.ink }}
          thumbColor={card.stock}
          onValueChange={(value) => {
            setSaving(true);
            setError(false);
            void setQuizSoundsEnabled(value)
              .catch(() => setError(true))
              .finally(() => setSaving(false));
          }}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={{ fontFamily: fonts.cardBody, color: card.ink }}>
          {failure}
        </Text>
      )}
    </View>
  );
}
