import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

  // bootstrap() resolves the saved language and nothing more — it deliberately does NOT
  // load the engine. See the note below the effects.

  useEffect(() => {
    // Resolve the saved language. The engine is NOT started here — it loads only when
    // something needs it (search field tap, /chat, or onboarding's language pick).
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
  // engine is ready (see CardFeedScreen). /chat needs the model but does not need a cover
  // either: it kicks its own load and shows an "Alam mo ba na…?" factoid to read meanwhile.
  //
  // Nothing raises the overlay any more, and that is correct rather than an oversight:
  //   - it was already gated on !onboardingActive, so it never covered first launch;
  //   - /chat kicks its own load and shows a "Alam mo ba na…?" factoid while the model
  //     warms, so it never needed a full-screen cover either;
  //   - the feed is zero-model and now says so in the search field.
  // Its ONLY job was the returning-user warm-up, which is the thing being removed. The
  // component is left in the tree unused rather than deleted — the sleeping-cat wake
  // sequence is brand work worth keeping available — but it is no longer wired here.
  void isReady;
  void engineError;


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
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
};
