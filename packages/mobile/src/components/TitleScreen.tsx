/** Boot cover: the complete glyph is visible from the native splash onward.
 * A gentle UI-thread pulse keeps it alive without ever collapsing to a seed dot.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Reanimated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import geometry from './brand/brand.generated.json';
import { card } from '../theme';
import { useReduceMotion } from './cards/useReduceMotion';

// Matches the full glyph inside the 200dp native splash asset.
const GLYPH_SIDE = 125;
const GLYPH_YELLOW = '#E9B949';

// ------------------------------------------------------------------------- the exit peel ----

/**
 * The exit copies the feed's SWIPE peel (CardFeedScreen: the pan's onEnd + peelTransform):
 * carry on sideways past the release point by TOSS_CARRY, lift 1.12 heights, tilt
 * PEEL_TILT_DEG around the hinge corner, cubic ease-OUT. The sheet is "thumbed up-and-right"
 * — a right-side hinge (side = 1) thrown upward (down = 0) — so it hinges on its
 * bottom-right corner and leaves past the top-right. Numbers are duplicated rather than
 * imported: the feed keeps them private to its shell, and this screen must not pull the
 * whole feed module (and its data) into the boot path just for four constants.
 */
const TOSS_CARRY = 2.2; // = CardFeedScreen.TOSS_CARRY
const PEEL_TILT_DEG = 10; // = CardFeedScreen.PEEL_TILT_DEG
const LIFT_HEIGHTS = 1.12; // = the feed's `h * 1.12` lift
/**
 * The virtual release offset the sheet is "let go" at, as a fraction of its width — the
 * sideways nudge a thumb gives a card it flicks up-and-right. Carried by TOSS_CARRY it puts
 * the sheet's exit ~0.26 widths to the right, enough to read as toward the corner and not a
 * straight lift. Only the DESTINATION uses it: a feed card is already sitting at its drag
 * offset when the finger lifts, but this sheet is at rest, so its flight starts from 0 —
 * starting it at the release offset would snap the whole screen sideways by 12% first.
 */
const RELEASE_X = 0.12;
/**
 * Flight time. The feed's flight is 140–380 ms (FLIP_MS), chosen so the card's initial speed
 * matches the finger's. A full-screen sheet travels ~1.6x a card's distance, and a sheet
 * that clears the screen in a card's time reads as a cut rather than a peel; at 420 ms the
 * cubic-out initial speed (3D/T ≈ 3 × 1.15 screen-heights / 0.42 s ≈ 6,500 dp/s) is still
 * a brisk thumb-flick, so it feels thrown, not dismissed.
 */
export const TITLE_EXIT_MS = 420;
/** Reduced motion: no flight, a plain fade of the same length order. */
const REDUCED_EXIT_MS = 220;

/** The feed's corner-hinge sandwich (CardFeedScreen.peelTransform), verbatim. */
function peelTransform(
  x: number,
  y: number,
  peel: number,
  side: number,
  down: number,
  w: number,
  h: number
) {
  'worklet';
  const cx = side === 0 ? -w / 2 : w / 2;
  const cy = down === 1 ? -h / 2 : h / 2;
  const deg = (side === 0 ? PEEL_TILT_DEG : -PEEL_TILT_DEG) * (down === 1 ? -1 : 1) * peel;
  return [
    { translateX: x },
    { translateY: y },
    { translateX: -cx },
    { translateY: -cy },
    { rotate: `${deg}deg` },
    { translateX: cx },
    { translateY: cy },
  ];
}

// --------------------------------------------------------------------------- the screen ----

interface TitleScreenProps {
  /** Flip to true once and the sheet flies off; `onGone` fires when it has left. */
  exiting: boolean;
  onGone: () => void;
}

export function TitleScreen({ exiting, onGone }: TitleScreenProps) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // ---- native splash hand-off ----
  // Hide the native splash the frame AFTER this screen has laid out, so the OS frame (same
  // complete glyph, same ink) is only ever swapped for a painted copy of itself.
  const splashHidden = useRef(false);
  const onLayout = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    requestAnimationFrame(() => {
      void SplashScreen.hideAsync();
    });
  }, []);

  const glow = useSharedValue(1);
  // Animate the native view, not SVG group opacity: GroupView's bitmap layer can
  // be invalidated mid-draw on Android (reproduced on both Jambo and Redmi).
  const glyphStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  useEffect(() => {
    cancelAnimation(glow);
    glow.value = 1;
    if (reduceMotion || exiting) return;
    glow.value = withRepeat(
      withTiming(0.78, {
        duration: 1200,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true
    );
    return () => cancelAnimation(glow);
  }, [glow, reduceMotion, exiting]);

  // ---- the exit (UI thread) ----
  const flyX = useSharedValue(0);
  const flyY = useSharedValue(0);
  const flyPeel = useSharedValue(0);
  const fade = useSharedValue(1);
  const gone = useRef(false);
  const finish = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    onGone();
  }, [onGone]);

  useEffect(() => {
    if (!exiting) return;
    if (reduceMotion) {
      fade.value = withTiming(0, { duration: REDUCED_EXIT_MS }, () => {
        runOnJS(finish)();
      });
      return;
    }
    // The same trajectory the feed's onEnd computes for a swipe released at (RELEASE_X·w, 0)
    // and thrown upward: carry sideways by TOSS_CARRY, lift LIFT_HEIGHTS, tilt as it goes.
    // The flight starts from where the sheet IS (rest, 0/0) — see RELEASE_X.
    const targetX = width * RELEASE_X * TOSS_CARRY;
    const targetY = -(height * LIFT_HEIGHTS);
    const timing = { duration: TITLE_EXIT_MS, easing: Easing.out(Easing.cubic) };
    flyX.value = 0;
    flyY.value = 0;
    flyPeel.value = 0;
    flyX.value = withTiming(targetX, timing);
    flyY.value = withTiming(targetY, timing);
    flyPeel.value = withTiming(1, timing, () => {
      // finished or not, the sheet is done — the shell's timeout is the belt to this brace.
      runOnJS(finish)();
    });
  }, [exiting, reduceMotion, width, height, flyX, flyY, flyPeel, fade, finish]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    // side = 1 (right hinge), down = 0 (thrown upward): hinge on the bottom-right corner.
    transform: peelTransform(flyX.value, flyY.value, flyPeel.value, 1, 0, width, height),
  }));

  return (
    <Reanimated.View
      style={[styles.sheet, sheetStyle]}
      onLayout={onLayout}
      // The sheet is a cover, not a window: taps while it is up must NOT fall through to the
      // feed or the onboarding carousel mounted beneath it (box-only = the sheet itself is
      // the touch target and simply does nothing with the touch).
      pointerEvents="box-only"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Reanimated.View style={glyphStyle}>
        <Svg width={GLYPH_SIDE} height={GLYPH_SIDE} viewBox="0 0 40 40">
          <Circle cx={20} cy={37} r={2} fill={GLYPH_YELLOW} />
          {geometry.layers.map((d) => (
            <Path
              key={d}
              d={d}
              fill="none"
              stroke={GLYPH_YELLOW}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the onboarding overlay (zIndex 100); order in the tree does the same on Android.
    zIndex: 1000,
    // The sheet's printed edge as it lifts off the feed. Android draws its shadow from
    // elevation (kept modest — the shadow's size scales with it); ink-on-ink it is invisible
    // until the sheet moves, then reads as a card edge over the paper.
    elevation: 12,
    shadowColor: card.ink,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
});
