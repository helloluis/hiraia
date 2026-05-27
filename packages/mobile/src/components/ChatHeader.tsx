import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function ChatHeader() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.push('/sidebar')} style={styles.menuButton}>
        <Text style={styles.menuIcon}>☰</Text>
      </TouchableOpacity>

      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>
          New Chat
        </Text>
      </View>

      <View style={styles.pills}>
        <TouchableOpacity style={styles.pill}>
          <Text style={styles.pillText}>EN</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pill}>
          <Text style={styles.pillText}>G7</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    backgroundColor: '#FFFFFF',
  },
  menuButton: {
    padding: 8,
  },
  menuIcon: {
    fontSize: 24,
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  pills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    backgroundColor: '#F7F7F8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2563EB',
  },
});
