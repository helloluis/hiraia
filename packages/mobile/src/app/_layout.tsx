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
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);
  const isReady = useEngineStore((s) => s.isReady);
  const engineError = useEngineStore((s) => s.error);
  const hydrate = useChatStore((s) => s.hydrate);
  const [fontsLoaded] = useFonts(fontAssets);

  // Sleeping-cat WARM-UP loader (returning user): bootstrap() starts the engine load at
  // boot, and the gated LoaderOverlay (tap-to-nudge the sleeping cat, wake video at 97%,
  // dismisses only once isReady) covers the wait so the model is warm before the kid can
  // reach the feed's search box. On a load error we skip the loader entirely and land on
  // the (zero-model) feed; the feed's warmModel() retries in the background.
  const [loaderVisible, setLoaderVisible] = useState(false);

  useEffect(() => {
    // Resolve the saved language and (for a returning user) start warming the engine.
    void bootstrap();
    // Load persisted chat history from SQLite (gates the cold-start factoid in chat).
    void hydrate();
  }, [bootstrap, hydrate]);

  // The warm-up loader NO LONGER covers the app.
  //
  // Measured on the target device: `warm-up complete (77835ms)` — 78 seconds of sleeping cat
  // before anything was reachable. But the card feed is entirely ZERO-MODEL: local card data
  // and bundled images, no LLM. The only things that need the engine are the feed's search
  // box, /chat, and the reward-card text. Blocking the whole app on a model the home screen
  // never calls made the first minute and a half of every cold start dead air.
  //
  // The loading state now lives INSIDE the one control that is actually unavailable — the
  // search field renders a quiet warming state and only offers its placeholder once the
  // engine is ready (see CardFeedScreen). /chat still waits for the model, correctly, since
  // it genuinely cannot function without one.
  //
  // `loaderVisible` is kept (not deleted) because the onboarding path and a background
  // warmModel() retry both still have legitimate reasons to raise it; it is simply no longer
  // raised by the returning-user warm-up.
  void isReady;
  void engineError;

  // Bail OUT of the loader on a load error — otherwise the kid would be stuck on the
  // sleeping cat at 0% forever. The (zero-model) feed is usable without the engine, and
  // its warmModel() retries the load in the background (which re-shows the loader).
  useEffect(() => {
    if (loaderVisible && engineError) setLoaderVisible(false);
  }, [loaderVisible, engineError]);

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

      {/* Engine warm-up (started in bootstrap): sleeping-cat loader until isReady. */}
      {loaderVisible && <LoaderOverlay onDismiss={() => setLoaderVisible(false)} />}
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
};
