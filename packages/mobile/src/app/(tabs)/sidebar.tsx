import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotebookBackground } from '../../components/NotebookBackground';
import { colors, fonts } from '../../theme';

export default function SidebarScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <NotebookBackground />
      <View style={styles.header}>
        <Text style={styles.title}>Hiraia</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>Isara</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Mga Usapan</Text>
        <Text style={styles.placeholder}>Wala pang usapan</Text>

        <Text style={styles.sectionTitle}>Mga Tala</Text>
        <Text style={styles.placeholder}>Wala pang tala</Text>

        <Text style={styles.sectionTitle}>Mga File</Text>
        <Text style={styles.placeholder}>Walang naka-upload na file</Text>
      </View>

      <TouchableOpacity style={styles.newChatButton}>
        <Text style={styles.newChatText}>+ Bagong Usapan</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  title: {
    fontFamily: fonts.title,
    fontSize: 28,
    color: colors.ink,
  },
  closeButton: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.primary,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 24,
    marginBottom: 8,
  },
  placeholder: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkMuted,
  },
  newChatButton: {
    backgroundColor: colors.primary,
    padding: 16,
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
  },
  newChatText: {
    fontFamily: fonts.body,
    color: colors.white,
    fontSize: 18,
  },
});
