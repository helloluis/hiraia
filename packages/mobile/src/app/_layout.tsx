import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
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
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);
  const hydrate = useChatStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts(fontAssets);

  // Brief cat-waking SPLASH on cold open (question-cards branch). The model is now
  // lazy-loaded (see engineStore.bootstrap), so this is a ~3-4s cosmetic intro, NOT a
  // ~25s model warm-up. Shown once per app launch, for a returning user (skip during
  // onboarding, which has its own flow).
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    // Resolve the saved language (no eager engine load anymore).
    void bootstrap();
    // Load persisted chat history from SQLite (gates the cold-start factoid in chat).
    void hydrate();
  }, [bootstrap, hydrate]);

  // Fire the splash once bootstrap knows there's a saved language and we're not onboarding.
  const splashFired = useRef(false);
  useEffect(() => {
    if (bootstrapped && language !== null && !onboardingActive && !splashFired.current) {
      splashFired.current = true;
      setShowSplash(true);
    }
  }, [bootstrapped, language, onboardingActive]);

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

      {/* Brief cat-waking splash on cold open (model is lazy-loaded; this is cosmetic). */}
      {showSplash && <LoaderOverlay splash onDismiss={() => setShowSplash(false)} />}
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
};
