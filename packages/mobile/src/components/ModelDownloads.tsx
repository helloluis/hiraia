import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useEngineStore } from '../store/engineStore';
import { card, fonts } from '../theme';
import { initializeModelDownloadPreference, modelDownloadPreference, setModelDownloadsEnabled, subscribeModelDownloadPreference } from '../engine/modelDownloadControl';

import { downloadControlsCopy as copy } from '../config/downloadStrings';

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
