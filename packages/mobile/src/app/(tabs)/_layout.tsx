import { Stack } from 'expo-router';

export default function TabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Cards' }} />
      {/* Chat is shelved on the question-cards branch but stays routable at /chat. */}
      <Stack.Screen name="chat" options={{ title: 'Chat' }} />
      <Stack.Screen
        name="sidebar"
        options={{
          title: 'Menu',
          // transparent so the 80%-width panel sits over a dimmed backdrop (the
          // panel looks like the cover of the user's notebook); slide from the left.
          presentation: 'transparentModal',
          animation: 'slide_from_left',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}
