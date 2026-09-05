import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { card, fonts } from '../theme';
import { activitySummary } from './index';
import type { ActivitySummary } from './activity';

const rows = [
  ['Cards', 'cards'], ['Dynamic Cards', 'dynamic'],
  ['Quizzes', 'quizzes'], ['Correct Quizzes', 'correct'],
] as const;

export function ActivityTable() {
  const [summary, setSummary] = useState<ActivitySummary>();
  const [failed, setFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = () => {
      void activitySummary().then(value => {
        if (active) { setSummary(value); setFailed(false); }
      }).catch(() => { if (active) setFailed(true); });
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, []));
  return <View style={styles.section}>
    <Text style={styles.title}>Activity on this device</Text>
    <View style={styles.table}>
      <View style={[styles.row, styles.heading]}>
        <Text style={[styles.label, styles.header]}>Counter</Text>
        {['Last 24h', 'This Week', 'This Quarter'].map(label =>
          <Text key={label} style={[styles.value, styles.header]}>{label}</Text>)}
      </View>
      {rows.map(([label, key]) => <View key={key} style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        {[0, 1, 2].map(i => <Text key={i} style={styles.value}>
          {failed ? '—' : summary ? summary.counts[i]![key].toLocaleString() : '…'}
        </Text>)}
      </View>)}
    </View>
    {failed ? <Text style={styles.note}>Counters unavailable. Reopen Settings to retry.</Text> : summary &&
      <Text style={styles.note}>Tracking since {new Date(summary.since).toLocaleString()}.
        {'\n'}Updated {new Date(summary.asOf).toLocaleString()}.</Text>}
  </View>;
}
const styles = StyleSheet.create({
  section: { marginTop: 18 },
  title: { fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink, marginBottom: 8 },
  table: { borderWidth: 1, borderColor: card.olive, borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: card.sage, minHeight: 42, paddingHorizontal: 6, paddingVertical: 8 },
  heading: { backgroundColor: card.ink },
  label: { flex: 1.45, fontFamily: fonts.cardBodyBold, fontSize: 14, color: card.ink },
  value: { flex: 1, fontFamily: fonts.cardBody, fontSize: 14, color: card.ink, textAlign: 'center' },
  header: { color: card.stock, fontSize: 12, fontFamily: fonts.cardBodyBold },
  note: { fontFamily: fonts.cardBody, fontSize: 12, color: card.olive, marginTop: 8 },
});
