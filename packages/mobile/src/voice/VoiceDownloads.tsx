import { useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useEngineStore } from '../store/engineStore';
import { downloadControlsCopy, downloadStatusCopy } from '../config/downloadStrings';
import { card, fonts } from '../theme';
import { voiceForLanguage } from './catalog';
import { setVoiceDownloadsEnabled, subscribeVoiceDownloads, voiceDownloadStatus } from './downloads';

/** The selected voice's real availability; text and the feed never wait for it. */
export function VoiceDownloads({ compact = false }: { compact?: boolean }) {
  const language = useEngineStore(s => s.language);
  const state = useSyncExternalStore(subscribeVoiceDownloads, voiceDownloadStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!language) return null;
  const voice = voiceForLanguage(language);
  if (!voice) return null;
  const status = downloadStatusCopy[language];
  const controls = downloadControlsCopy[language];
  const phase = state.language === language ? state.phase : 'checking';
  const detail = phase === 'unavailable' ? status.missing : status[phase];
  const downloadable = voice.delivery === 'download';
  const showPercent = phase === 'downloading' || (phase === 'paused' && state.percent > 0);
  return <View style={{ marginVertical: compact ? 4 : 18, gap: 8 }}>
    {!compact && <Text style={{ fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink }}>{voice.label}</Text>}
    <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.cardBody, fontSize: 15, color: card.ink }}>
      {compact ? `${voice.label} · ` : ''}{detail}{showPercent ? ` · ${state.percent}%` : ''}{downloadable && phase !== 'ready' ? ` · ${(voice.bytes / 1e6).toFixed(1)} MB` : ''}
    </Text>
    {error && <Text accessibilityRole="alert" style={{ color: card.ink }}>{controls.error}</Text>}
    {!compact && downloadable && phase !== 'ready' && <Pressable accessibilityRole="button" disabled={saving}
      onPress={() => {
        setSaving(true); setError(false);
        void setVoiceDownloadsEnabled(phase === 'failed' || !state.enabled)
          .catch(() => setError(true)).finally(() => setSaving(false));
      }} style={{ borderWidth: 3, borderColor: card.ink, borderRadius: 11, backgroundColor: card.gold,
        minHeight: 48, padding: 12, alignSelf: 'flex-start', opacity: saving ? 0.5 : 1 }}>
      <Text style={{ color: card.ink, fontFamily: fonts.cardBodyBold }}>
        {state.enabled && phase !== 'failed' ? controls.pause : controls.resume}
      </Text>
    </Pressable>}
  </View>;
}
