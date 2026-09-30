import { Text, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import { card } from '../theme';
// Google Nearby's Android transport is not available on Windows. Keep its camera
// scanner out of the desktop module graph; importing it starts an online worker.
export function TalaSettings(_props: { language: Language }) {
  return <View><Text style={{ color: card.ink }}>
    Classroom sync with Tala is available on Android and ChromeOS. Your Windows
    reading and quiz history is saved on this computer.
  </Text></View>;
}
