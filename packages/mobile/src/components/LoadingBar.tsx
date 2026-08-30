import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { colors } from '../theme';

/**
 * A thick dark-green bar that fills left-to-right while the on-device model loads,
 * shown directly above the text field. The slow part (loading the GGUF into the GPU,
 * ~25-30s) emits no real progress, so we ease toward ~90% over the typical load time
 * and only complete to 100% when `loading` flips false — honest-feeling without faking
 * precision. Renders nothing once loading is done and the bar has faded.
 *
 * `failed` exists because "stopped loading" has TWO meanings and they must not look
 * identical. A load that GAVE UP used to just flip `loading` false, which ran the
 * success animation — the fill sweeping to 100% and vanishing, the exact frames a
 * finished download plays. A child watching the bar was told the opposite of what
 * happened. On failure the bar therefore fades out from wherever it had reached and
 * never completes, leaving the honest copy in the input placeholder to say why.
 */
export function LoadingBar({ loading, failed = false }: { loading: boolean; failed?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [hidden, setHidden] = useState(!loading);

  useEffect(() => {
    if (loading) {
      setHidden(false);
      progress.setValue(0);
      opacity.setValue(1);
      // Decelerate toward 90% over ~28s (a typical cold-start); never reach the end
      // until the engine actually reports ready.
      Animated.timing(progress, {
        toValue: 0.9,
        duration: 28000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    } else if (failed) {
      // Gave up: freeze the fill where it stopped and dissolve it. No completion frame.
      progress.stopAnimation();
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start(() => setHidden(true));
    } else {
      // Snap to full, then fade the bar out.
      Animated.timing(progress, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start(() => setHidden(true));
    }
  }, [loading, failed, progress, opacity]);

  if (hidden) return null;

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View style={[styles.track, { opacity }]} pointerEvents="none">
      <Animated.View style={[styles.fill, { width }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 5,
    width: '100%',
    backgroundColor: 'transparent',
  },
  fill: {
    height: 5,
    backgroundColor: colors.greenDark,
  },
});
