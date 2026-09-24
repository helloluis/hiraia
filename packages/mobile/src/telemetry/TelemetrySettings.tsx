import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import { setTelemetryEnabled, telemetryEnabled } from './index';
const copy = {
  english: [
    'Help improve Hiraia',
    'Share usage counts, quiz scores and download errors when online. The Hiraia service does not receive names or question and answer text. When a student joins a class with a Hiraia Tala QR, that teacher receives only that student’s name and activity counts, not those of other students on this phone.',
    'Could not save. Please try again.',
  ],
  tagalog: [
    'Tumulong na pagandahin ang Hiraia',
    'Ibahagi ang bilang ng paggamit, marka sa quiz at error sa download kapag online. Hindi tumatanggap ng pangalan o teksto ng tanong at sagot ang serbisyo ng Hiraia. Kapag sumali ang isang mag-aaral sa klase gamit ang QR ng Hiraia Tala, ang pangalan at bilang ng activity lang ng mag-aaral na iyon ang natatanggap ng guro, hindi ang sa ibang mag-aaral sa teleponong ito.',
    'Hindi na-save. Pakisubukang muli.',
  ],
  cebuano: [
    'Tabangi ang pagpaayo sa Hiraia',
    'Ipaambit ang ihap sa paggamit, iskor sa quiz ug mga sayop sa download kon online. Dili madawat sa serbisyo sa Hiraia ang ngalan o teksto sa pangutana ug tubag. Kon moapil ang usa ka estudyante sa klase pinaagi sa QR sa Hiraia Tala, ang ngalan ug ihap sa activity lang niadtong estudyante ang madawat sa magtutudlo, dili ang sa ubang estudyante niining telepono.',
    'Wala ma-save. Sulayi pag-usab.',
  ],
};
export function TelemetrySettings({ language }: { language: Language }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const text = copy[language];
  useEffect(() => {
    let alive = true;
    void telemetryEnabled()
      .then((v) => {
        if (alive) setEnabled(v);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <View style={{ marginVertical: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: '#20342c', fontWeight: '600' }}>{text[0]}</Text>
        <Switch
          accessibilityLabel={text[0]}
          value={enabled ?? false}
          disabled={enabled === null || busy}
          onValueChange={(value) => {
            setBusy(true);
            setError(false);
            void setTelemetryEnabled(value)
              .then(() => setEnabled(value))
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        />
      </View>
      <Text style={{ color: '#58635c', fontSize: 13, lineHeight: 18 }}>{text[1]}</Text>
      {error && <Text accessibilityRole="alert">{text[2]}</Text>}
    </View>
  );
}
