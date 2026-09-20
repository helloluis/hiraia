import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAssetUpdateStore } from '../store/assetUpdateStore';
import { useEngineStore } from '../store/engineStore';
import { useUpdateStore } from '../store/updateStore';
import { card, fonts } from '../theme';

const copy = {
  english: {title: 'Learning updates', model: 'Improved tutor model', images: 'illustration packs', download: 'Update', retry: 'Retry', ready: 'Model saved. Reopen Hiraia to use it.', queued: 'Illustration updates queued. Manage downloads in Settings.', error: 'Update paused. Check internet and free storage, then retry.', close: 'Remind me next week'},
  tagalog: {title: 'Mga update', model: 'Pinahusay na tutor model', images: 'pakete ng larawan', download: 'I-update', retry: 'Subukan muli', ready: 'Na-save ang model. Buksan muli ang Hiraia para gamitin ito.', queued: 'Nakapila na ang mga larawan. Pamahalaan ang download sa Settings.', error: 'Naka-pause ang update. Suriin ang internet at storage, saka subukan muli.', close: 'Ipaalala sa susunod na linggo'},
  cebuano: {title: 'Mga update', model: 'Gipauswag nga tutor model', images: 'pakete sa hulagway', download: 'I-update', retry: 'Sulayi pag-usab', ready: 'Na-save ang model. Ablihi pag-usab ang Hiraia aron magamit kini.', queued: 'Nakapila na ang mga hulagway. Dumalaa ang download sa Settings.', error: 'Na-pause ang update. Susiha ang internet ug storage, unya sulayi pag-usab.', close: 'Pahinumdom sunod semana'},
};
export function AssetUpdateBanner() {
  const insets = useSafeAreaInsets();
  const u = useAssetUpdateStore();
  const apk = useUpdateStore(s => s.status);
  const t = copy[useEngineStore(s => s.language) || 'english'];
  const stage = useEngineStore(s => s.readyStage);
  if (!['available','downloading','ready','failed'].includes(u.status)) return null;
  // APKs take priority; do not invite competing large transfers.
  if (['available','downloading','ready','failed'].includes(apk)) return null;
  const busy = !['idle','done'].includes(stage);
  return <View accessibilityLiveRegion="polite" style={{backgroundColor: card.ink, padding: 12, paddingTop: insets.top + 8, gap: 6}}>
    <Text style={{color: card.gold, fontFamily: fonts.cardBodyBold}}>{t.title}</Text>
    <Text style={{color: card.stock, fontFamily: fonts.cardBody}}>
      {u.status === 'ready' ? [u.model ? t.ready : '', u.imageCount ? t.queued : ''].filter(Boolean).join(' ') :
        `${[u.model ? t.model : '', u.imageCount ? `${u.imageCount} ${t.images}` : ''].filter(Boolean).join(' · ')} · ${Math.ceil(u.bytes / 1048576)} MB`}
    </Text>
    {!!u.model?.notes && u.status !== 'ready' && <Text style={{color: card.stock}}>{u.model.notes}</Text>}
    {u.status === 'failed' && <Text style={{color: card.stock}}>{t.error}</Text>}
    <View style={{flexDirection:'row', gap:16}}>
      {u.status === 'downloading' ? <Text style={{color:card.gold}}>{u.pct}%</Text> : <>
        {u.status !== 'ready' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void u.download()} style={{minHeight:44, justifyContent:'center', opacity:busy?0.4:1}}>
          <Text style={{color:card.gold}}>{u.status === 'failed' ? t.retry : t.download}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={() => void u.snooze()} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:card.stock}}>✕</Text></Pressable>
      </>}
    </View>
  </View>;
}
