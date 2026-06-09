import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LanguagePicker } from '../components/LanguagePicker';
import { LoaderOverlay } from '../components/LoaderOverlay';
import { useChatStore } from '../store/chatStore';
import { useEngineStore } from '../store/engineStore';
import { colors, fontAssets } from '../theme';

export default function RootLayout() {
  const bootstrap = useEngineStore((s) => s.bootstrap);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const bootstrapped = useEngineStore((s) => s.bootstrapped);
  const language = useEngineStore((s) => s.language);
  const isReady = useEngineStore((s) => s.isReady);
  const hydrate = useChatStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts(fontAssets);

  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    // Resolve the saved language and (if set) load the engine for it. When none is
    // saved, `language` stays null and the first-launch picker is shown below.
    void bootstrap();
    // Load persisted chat history from SQLite (replaces the old zustand-persist
    // auto-hydration). Sets hasHydrated, which gates the cold-start factoid.
    void hydrate();
  }, [bootstrap, hydrate]);

  // Show loader overlay when a language has been selected but the engine is warming up
  useEffect(() => {
    if (language !== null && !isReady) {
      setShowLoader(true);
    }
  }, [language, isReady]);

  if (!fontsLoaded || !bootstrapped) {
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
      {/* First launch: no language chosen yet → takeover picker (loads the engine
          with the right adapter the first time, avoiding an immediate reload). */}
      {language === null && <LanguagePicker onPick={changeLanguage} />}

      {/* Loader overlay overlaying the chat layout */}
      {showLoader && (
        <LoaderOverlay
          onDismiss={() => {
            setShowLoader(false);
          }}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
};
