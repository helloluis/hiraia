import { startTelemetry } from '../telemetry';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { OnboardingCarousel } from '../components/onboarding/OnboardingCarousel';
import { TITLE_EXIT_MS, TitleScreen } from '../components/TitleScreen';
import { useCardStore } from '../store/cardStore';
import { useEngineStore } from '../store/engineStore';
import { colors, fontAssets } from '../theme';

// Hold the native splash (the icon on ink, see the expo-splash-screen plugin in app.json)
// until the TitleScreen — the same mark on the same ink — has painted; it releases the
// splash itself, one frame after layout. Module scope on purpose: it has to run before
// expo-router's own auto-hide gets a look in.
//
// NOTE the plugin entry in app.json is load-bearing: with only the legacy `expo.splash` key
// the Android MainActivity never registers SplashScreenManager, and both this call and
// hideAsync() are no-ops — the OS drops its starting window on the activity's first (empty)
// frame and the app flashes its window background before JS paints.
void SplashScreen.preventAutoHideAsync();

/**
 * Belt for the held splash: if the TitleScreen never lays out (a throw during the first
 * render lands in the router's error boundary UNDER the held splash), the splash is
 * released anyway so a broken boot shows its error instead of a frozen icon. Idempotent —
 * the TitleScreen's own hide normally fires long before this.
 */
const SPLASH_HOLD_MAX_MS = 4000;

/**
 * How long the title stays up at MINIMUM, from mount. A warm start can be ready in a couple
 * of hundred ms, and a title that flashes and peels before the eye has settled reads as a
 * glitch; 900 ms is enough for the pen to travel most of the mark before the sheet is thrown.
 */
const TITLE_MIN_MS = 900;
/**
 * Safety net: whatever the readiness signals do, the title is thrown after this long — the
 * feed underneath has its own not-yet-hydrated state and the app must never strand behind
 * a splash. Generous, because a cold first install copies the card database on this path.
 */
const TITLE_MAX_MS = 15000;

/** The title sheet: on show, in flight, or unmounted. */
type TitlePhase = 'shown' | 'exiting' | 'gone';

export default function RootLayout() {
  useEffect(() => startTelemetry(), []);
  const bootstrap = useEngineStore((s) => s.bootstrap);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const bootstrapped = useEngineStore((s) => s.bootstrapped);
  const language = useEngineStore((s) => s.language);
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);
  const isReady = useEngineStore((s) => s.isReady);
  const engineError = useEngineStore((s) => s.error);
  const hydrated = useCardStore((s) => s.hydrated);
  const [fontsLoaded] = useFonts(fontAssets);

  // bootstrap() resolves the saved language and nothing more — it deliberately does NOT
  // load the engine. See the note below the effects.

  useEffect(() => {
    // Resolve the saved language. The engine is NOT started here — it loads only when
    // something needs it (the feed's search field, or onboarding's language pick).
    void bootstrap();
  }, [bootstrap]);

  // The warm-up loader NO LONGER covers the app.
  //
  // Measured on the target device: `warm-up complete (77835ms)` — 78 seconds of sleeping cat
  // before anything was reachable. But the card feed is entirely ZERO-MODEL: local card data
  // and bundled images, no LLM. The only things that need the engine are the feed's search
  // box and the reward-card text. Blocking the whole app on a model the home screen never
  // calls made the first minute and a half of every cold start dead air.
  //
  // The loading state now lives INSIDE the one control that is actually unavailable — the
  // search field renders a quiet warming state and only offers its placeholder once the
  // engine is ready (see CardFeedScreen).
  //
  // Nothing raises the overlay any more, and that is correct rather than an oversight:
  //   - it was already gated on !onboardingActive, so it never covered first launch;
  //   - the feed is zero-model and now says so in the search field.
  // Its ONLY job was the returning-user warm-up, which is the thing being removed. The
  // component is left in the tree unused rather than deleted — the sleeping-cat wake
  // sequence is brand work worth keeping available — but it is no longer wired here.
  void isReady;
  void engineError;

  // ---- the title sheet ----
  //
  // The TitleScreen (the icon's "hi" mark being traced on ink) covers the app from the first
  // JS frame until it is FULLY loaded, then peels off toward the top-right like a swiped
  // card. "Fully loaded" is two signals, by path:
  //   - feed path (a returning reader): fonts + bootstrap AND cardStore.hydrated. The feed
  //     kicks hydrate() itself when it mounts, so the Stack has to be rendered UNDER the
  //     title as soon as the shell is ready — hydration runs while the pen is still going.
  //   - first launch / tutorial: fonts + bootstrap. The carousel is the next thing to show,
  //     and the feed deliberately does not hydrate under it (the grade picked there weights
  //     the first draw), so waiting on `hydrated` would strand the title.
  // The LLM is not part of readiness — the feed is zero-model; the search field carries its
  // own progress bar.
  const shellReady = fontsLoaded && bootstrapped;
  const appReady = shellReady && (onboardingActive || hydrated);
  const [title, setTitle] = useState<TitlePhase>('shown');
  const titleShownAt = useRef(Date.now());

  useEffect(() => {
    const timer = setTimeout(() => void SplashScreen.hideAsync(), SPLASH_HOLD_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (title !== 'shown') return;
    const elapsed = Date.now() - titleShownAt.current;
    const wait = appReady
      ? Math.max(0, TITLE_MIN_MS - elapsed) // ready: hold to the minimum, then throw
      : Math.max(0, TITLE_MAX_MS - elapsed); // not ready: the safety net
    const timer = setTimeout(() => setTitle('exiting'), wait);
    return () => clearTimeout(timer);
  }, [appReady, title]);

  // Belt to the flight's own completion callback: if the sheet is thrown and never reports
  // back (a cancelled animation, a remount mid-flight), it is dropped anyway.
  useEffect(() => {
    if (title !== 'exiting') return;
    const timer = setTimeout(() => setTitle('gone'), TITLE_EXIT_MS + 400);
    return () => clearTimeout(timer);
  }, [title]);

  const onTitleGone = useCallback(() => setTitle('gone'), []);

  return (
    <GestureHandlerRootView style={styles.root}>
      {/* Light content over the title's ink; the app's own dark-on-paper style after. */}
      <StatusBar style={title === 'gone' ? 'dark' : 'light'} />

      {/* The Stack mounts as soon as fonts + bootstrap are in — under the title — so the
          feed can start hydrating while the mark is still being traced. */}
      {shellReady && (
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      )}

      {/* First launch (no language yet) OR Settings → "show tutorial": the onboarding
          carousel. Slide-1 pick calls changeLanguage() — which loads the engine / starts
          the model download — so the wait overlaps the rest of the tutorial. */}
      {shellReady && onboardingActive && (
        <OnboardingCarousel
          initialLanguage={language}
          onPickLanguage={changeLanguage}
          onFinish={() => setOnboardingActive(false)}
        />
      )}

      {/* The title sheet, last in the tree so it sits over everything until it is thrown. */}
      {title !== 'gone' && <TitleScreen exiting={title === 'exiting'} onGone={onTitleGone} />}

      {/* Engine warm-up (started in bootstrap): sleeping-cat loader until isReady. */}
    </GestureHandlerRootView>
  );
}

const styles = {
  // Paper: it is what the sheet reveals as it tilts off (the feed's own ground), and the
  // title covers the root edge-to-edge until then, so nothing else ever shows through.
  root: { flex: 1, backgroundColor: colors.paper },
};
