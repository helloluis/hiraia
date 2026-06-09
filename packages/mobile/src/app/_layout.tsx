import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LoaderOverlay } from '../components/LoaderOverlay';
import { OnboardingCarousel } from '../components/onboarding/OnboardingCarousel';
import { useChatStore } from '../store/chatStore';
import { useEngineStore } from '../store/engineStore';
import { colors, fontAssets } from '../theme';

export default function RootLayout() {
  const bootstrap = useEngineStore((s) => s.bootstrap);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const bootstrapped = useEngineStore((s) => s.bootstrapped);
  const language = useEngineStore((s) => s.language);
  const isReady = useEngineStore((s) => s.isReady);
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);
  const hydrate = useChatStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts(fontAssets);

  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    // Resolve the saved language and (if set) load the engine for it. When none is
    // saved, `language` stays null and the onboarding carousel is shown below.
    void bootstrap();
    // Load persisted chat history from SQLite (replaces the old zustand-persist
    // auto-hydration). Sets hasHydrated, which gates the cold-start factoid.
    void hydrate();
  }, [bootstrap, hydrate]);

  // Show the warm-up loader (sleeping → waking cat) when a language is chosen but the
  // engine isn't ready — EXCEPT during onboarding, whose DownloadSlide shows its own
  // progress. After onboarding finishes, if the model is still warming, the loader takes over.
  useEffect(() => {
    if (language !== null && !isReady && !onboardingActive) {
      setShowLoader(true);
    }
  }, [language, isReady, onboardingActive]);

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

      {/* First launch (no language yet) OR Settings → "show tutorial": the onboarding
          carousel. Slide-1 pick calls changeLanguage() — which loads the engine / starts
          the model download — so the wait overlaps the rest of the tutorial. */}
      {onboardingActive && (
        <OnboardingCarousel
          initialLanguage={language}
          onPickLanguage={changeLanguage}
          onFinish={() => setOnboardingActive(false)}
        />
      )}

      {/* Model warm-up takeover (sleeping → waking cat) for returning users, or after
          onboarding finishes while the engine is still warming up. */}
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
