import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEngineStore } from '../../store/engineStore';
import { card, fonts } from '../../theme';

const copy = {
  english: {
    available: 'You can still use Hiraia to read cards, view downloaded illustrations, and take quizzes. Creating new cards with AI is temporarily unavailable.',
    hub: 'Your phone needs extra help', hubBody: 'Ask your teacher about HiraiaHub, which will help your phone create new cards.', soon: 'HiraiaHub is coming soon.',
    pressure: 'Hiraia needs a little more room', pressureBody: 'There is not enough free memory to run the AI right now. Close other apps and tap Try again, or restart your phone and reopen Hiraia.',
    storage: 'Your phone needs more storage', storageBody: 'Free up some storage on your phone, then try again. Your cards and quizzes are still available.',
    unknown: 'We could not check your phone', unknownBody: 'Try again in a moment. You can keep exploring cards and taking quizzes.', retry: 'Try again', keep: 'Keep learning',
  },
  tagalog: {
    available: 'Maaari pa ring gamitin ang Hiraia para magbasa ng mga card, tingnan ang mga na-download na larawan, at sumagot sa mga pagsusulit. Hindi muna magagamit ang paggawa ng bagong card gamit ang AI.',
    hub: 'Kailangan ng dagdag na tulong ng iyong telepono', hubBody: 'Tanungin ang iyong guro tungkol sa HiraiaHub para makagawa ng mga bagong card.', soon: 'Malapit nang dumating ang HiraiaHub.',
    pressure: 'Kailangan ng kaunting luwag ni Hiraia', pressureBody: 'Kulang ang libreng memorya para sa AI ngayon. Isara ang ibang app at pindutin ang Subukan muli, o i-restart ang telepono at buksan muli ang Hiraia.',
    storage: 'Kailangan ng dagdag na espasyo', storageBody: 'Magbakante ng espasyo sa iyong telepono, tapos subukan muli. Magagamit mo pa rin ang mga card at pagsusulit.',
    unknown: 'Hindi masuri ang iyong telepono', unknownBody: 'Subukan muli mamaya. Maaari ka pa ring magbasa ng mga card at sumagot sa mga pagsusulit.', retry: 'Subukan muli', keep: 'Magpatuloy sa pag-aaral',
  },
  cebuano: {
    available: 'Magamit gihapon ang Hiraia sa pagbasa og mga card, pagtan-aw sa na-download nga mga hulagway, ug pagtubag sa mga quiz. Dili pa magamit ang paghimo og bag-ong mga card gamit ang AI.',
    hub: 'Nagkinahanglan og dugang tabang ang imong telepono', hubBody: 'Pangutan-a ang imong magtutudlo bahin sa HiraiaHub aron makahimo og bag-ong mga card.', soon: 'Moabot na ang HiraiaHub sa dili madugay.',
    pressure: 'Nagkinahanglan og gamayng luna ang Hiraia', pressureBody: 'Kulang ang libre nga memorya alang sa AI karon. Isira ang ubang app ug pindota ang Sulayi pag-usab, o i-restart ang telepono ug ablihi pag-usab ang Hiraia.',
    storage: 'Kinahanglan og dugang espasyo', storageBody: 'Pagbakante og espasyo sa imong telepono, dayon sulayi pag-usab. Magamit gihapon ang mga card ug quiz.',
    unknown: 'Dili masusi ang imong telepono', unknownBody: 'Sulayi pag-usab unya. Makabasa gihapon ka og mga card ug makatubag sa mga quiz.', retry: 'Sulayi pag-usab', keep: 'Padayon sa pagkat-on',
  },
};
export function MemoryNotice() {
  const reason = useEngineStore(s => s.memoryNotice);
  const language = useEngineStore(s => s.language) ?? 'tagalog';
  const dismiss = useEngineStore(s => s.dismissMemoryNotice);
  const y = useRef(new Animated.Value(-600)).current;
  const insets = useSafeAreaInsets();
  useEffect(() => { if (reason) y.setValue(-600); }, [reason, y]);
  const t = copy[language as keyof typeof copy] ?? copy.english;
  const key = reason === 'unsupported' ? 'hub' : reason ?? 'unknown';
  return <Modal visible={!!reason} transparent animationType="none" onRequestClose={dismiss}
    onShow={() => Animated.timing(y, { toValue: 0, duration: 280, useNativeDriver: true }).start()}>
    <View style={styles.backdrop}>
      <Animated.View accessibilityViewIsModal style={[styles.panel, { marginTop: insets.top + 16, transform: [{ translateY: y }] }]}>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 2 }}>
        <Text accessibilityRole="header" style={styles.title}>{t[key]}</Text>
        <Text style={styles.body}>{t.available}</Text>
        <Text style={styles.body}>{t[`${key}Body`]}</Text>
        {reason === 'unsupported' && <Text style={styles.body}>{t.soon}</Text>}
        {reason !== 'unsupported' && <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
          dismiss();
          const s = useEngineStore.getState();
          if (s.language) void s.changeLanguage(s.language);
        }}><Text style={styles.label}>{t.retry}</Text></Pressable>}
        <Pressable accessibilityRole="button" style={styles.button} onPress={dismiss}><Text style={styles.label}>{t.keep}</Text></Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000088', padding: 20 },
  panel: { flexShrink: 1, maxHeight: '90%', backgroundColor: card.stock, borderRadius: 22, borderWidth: 3, borderColor: card.sage, padding: 22 },
  title: { color: card.ink, fontFamily: fonts.cardBodyBold, fontSize: 24, marginBottom: 16 },
  body: { color: card.ink, fontFamily: fonts.cardBody, fontSize: 18, lineHeight: 27, marginBottom: 18 },
  button: { backgroundColor: card.sage, borderRadius: 14, padding: 15, marginTop: 10 },
  label: { color: card.ink, fontFamily: fonts.cardBodyBold, fontSize: 18, textAlign: 'center' },
});
