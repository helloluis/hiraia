import { Stack } from 'expo-router';

export default function TabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Chat' }} />
      <Stack.Screen name="sidebar" options={{ title: 'Menu', presentation: 'modal' }} />
    </Stack>
  );
}
