import { useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useEngineStore } from '../store/engineStore';
import { card, fonts } from '../theme';
import { imageDownloadStatus, subscribeImageDownloads, setImageDownloadsEnabled } from './installer';
const copy = {
 english: { title: 'Illustrations', detail: 'Common illustrations and images for your grade download automatically while Hiraia is open.', start: 'Download illustrations', pause: 'Pause download', resume: 'Resume download', done: 'Common illustrations and images for your grade are available offline.', progress: 'packs installed', error: 'Download paused. Check your connection and free storage, then retry.', retry: 'Retry', installing: 'Installing', loading: 'Checking saved illustrations…' },
 tagalog: { title: 'Mga larawan', detail: 'Awtomatikong dina-download ang mga pangkalahatang larawan at mga larawan para sa iyong baitang habang bukas ang Hiraia.', start: 'I-download ang mga larawan', pause: 'I-pause ang download', resume: 'Ipagpatuloy ang download', done: 'Magagamit na offline ang lahat ng larawan.', progress: 'paketeng na-install', error: 'Naka-pause ang download. Suriin ang koneksiyon at bakanteng storage, saka subukan muli.', retry: 'Subukan muli', installing: 'Ini-install', loading: 'Sinusuri ang mga naka-save na larawan…' },
 cebuano: { title: 'Mga hulagway', detail: 'Awtomatikong i-download ang kasagarang mga hulagway ug mga hulagway para sa imong grado samtang abli ang Hiraia.', start: 'I-download ang mga hulagway', pause: 'I-pause ang download', resume: 'Ipadayon ang download', done: 'Magamit na offline ang tanang hulagway.', progress: 'ka pakete nga na-install', error: 'Na-pause ang download. Susiha ang koneksiyon ug bakanteng storage, unya sulayi pag-usab.', retry: 'Sulayi pag-usab', installing: 'Gi-install', loading: 'Gisusi ang mga na-save nga hulagway…' },
};
export function ImageDownloads() {
 const language = useEngineStore(s=>s.language); const t=copy[language || 'english'];
 const state=useSyncExternalStore(subscribeImageDownloads,imageDownloadStatus,imageDownloadStatus);
 const [saving,setSaving]=useState(false); const [saveError,setSaveError]=useState(false);
 const done=state.ready && state.completed===state.total;
 const busy=state.enabled && !state.error;
 const label=state.error ? t.retry : busy ? t.pause : state.completed ? t.resume : t.start;
 return <View style={{ marginVertical: 18, gap: 8 }}>
  <Text style={{ fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink }}>{t.title}</Text>
  <Text style={{ color: card.ink, fontSize: 15, fontFamily: fonts.cardBody }}>{done ? t.done : t.detail}</Text>
  <Text accessibilityLiveRegion="polite" style={{ color: card.ink, fontSize: 15, fontFamily: fonts.cardBody }}>
   {!state.ready ? t.loading : `${state.completed}/${state.total} ${t.progress}${state.phase==='downloading' ? ` · ${state.percent}%` : state.phase==='installing' ? ` · ${t.installing}` : ''}`}
  </Text>
  {(state.error || saveError) && <Text accessibilityRole="alert" style={{ color: card.ink }}>{t.error}</Text>}
  {!done && <Pressable accessibilityRole="button" disabled={saving || !state.ready} onPress={() => {
   setSaving(true);setSaveError(false);
   void setImageDownloadsEnabled(state.error || !state.enabled).catch(()=>setSaveError(true)).finally(()=>setSaving(false));
  }} style={{ borderWidth: 3, borderColor: card.ink, borderRadius: 11, backgroundColor: card.gold, minHeight: 48, padding: 12, alignSelf: 'flex-start', opacity: saving ? 0.5 : 1 }}>
   <Text style={{ color: card.ink, fontFamily: fonts.cardBodyBold }}>{label}</Text>
  </Pressable>}
 </View>;
}
