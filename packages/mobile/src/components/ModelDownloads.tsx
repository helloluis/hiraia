import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useEngineStore } from '../store/engineStore';
import { card, fonts } from '../theme';
import { initializeModelDownloadPreference, modelDownloadPreference, setModelDownloadsEnabled, subscribeModelDownloadPreference } from '../engine/modelDownloadControl';

const copy = {
  english: {title: 'AI downloads', detail: 'Search and tutor models download automatically. Pausing keeps downloaded files and progress.', pause: 'Pause downloads', resume: 'Resume downloads', error: 'Could not save this setting. Please try again.'},
  tagalog: {title: 'Mga download ng AI', detail: 'Awtomatikong dina-download ang mga modelo para sa paghahanap at tutor. Hindi mabubura ang mga na-download kapag naka-pause.', pause: 'I-pause ang download', resume: 'Ipagpatuloy ang download', error: 'Hindi na-save ang setting. Subukan muli.'},
  cebuano: {title: 'Mga download sa AI', detail: 'Awtomatikong i-download ang mga modelo para sa pagpangita ug tutor. Dili mapapas ang mga na-download kon naka-pause.', pause: 'I-pause ang download', resume: 'Ipadayon ang download', error: 'Wala ma-save ang setting. Sulayi pag-usab.'},
};
export function ModelDownloads() {
  const t = copy[useEngineStore(s => s.language) || 'english'];
  const state = useSyncExternalStore(subscribeModelDownloadPreference, modelDownloadPreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { void initializeModelDownloadPreference().catch(() => setError(true)); }, []);
  return <View style={{marginVertical: 18, gap: 8}}>
    <Text style={{fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink}}>{t.title}</Text>
    <Text style={{fontFamily: fonts.cardBody, fontSize: 15, color: card.ink}}>{t.detail}</Text>
    {error && <Text accessibilityRole="alert" style={{color: card.ink}}>{t.error}</Text>}
    <Pressable accessibilityRole="button" disabled={saving || (!state.ready && !error)} onPress={() => {
      setSaving(true); setError(false);
      void setModelDownloadsEnabled(!state.enabled).catch(() => setError(true)).finally(() => setSaving(false));
    }} style={{borderWidth: 3, borderColor: card.ink, borderRadius: 11, backgroundColor: card.gold, minHeight: 48, padding: 12, alignSelf: 'flex-start', opacity: saving ? 0.5 : 1}}>
      <Text style={{color: card.ink, fontFamily: fonts.cardBodyBold}}>{state.enabled ? t.pause : t.resume}</Text>
    </Pressable>
  </View>;
}
