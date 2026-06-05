import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useEngineStore } from '../store/engineStore';
import { colors, fontAssets } from '../theme';

export default function RootLayout() {
  const { initialize } = useEngineStore();
  const [fontsLoaded] = useFonts(fontAssets);

  useEffect(() => {
    // Initialize the QVAC engine when app starts
    void initialize();
  }, [initialize]);

  if (!fontsLoaded) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
};
