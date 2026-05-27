import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SidebarScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Hiraia</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>Close</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Chats</Text>
        <Text style={styles.placeholder}>No chats yet</Text>

        <Text style={styles.sectionTitle}>Notes</Text>
        <Text style={styles.placeholder}>No notes yet</Text>

        <Text style={styles.sectionTitle}>Files</Text>
        <Text style={styles.placeholder}>No files uploaded</Text>
      </View>

      <TouchableOpacity style={styles.newChatButton}>
        <Text style={styles.newChatText}>+ New Chat</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F8',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  closeButton: {
    fontSize: 16,
    color: '#2563EB',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
  },
  placeholder: {
    fontSize: 14,
    color: '#6B6B6B',
  },
  newChatButton: {
    backgroundColor: '#2563EB',
    padding: 16,
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
  },
  newChatText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
