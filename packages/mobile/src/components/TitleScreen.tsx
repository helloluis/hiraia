/**
 * TitleScreen — the boot title: the app icon's "hi" mark, big, on forest ink, with a pen
 * tracing its outline in a loop until the app is ready — and then the whole sheet PEELS OFF
 * TOWARD THE TOP-RIGHT the way a swiped flash card leaves the deck.
 *
 * Where it sits in the boot: the native splash (app.json → expo-splash-screen plugin: the
 * same icon on the same ink, NATIVE_SPLASH_IMAGE_DP wide) is held with
 * SplashScreen.preventAutoHideAsync() and released the frame after this screen has laid
 * out. The native frame draws the icon at a fixed dp size, not screen-relative, so this
 * screen starts its mark at THAT size and zooms it up to the big one — the hand-off is the
 * same picture on the same background that then grows, not a cut. The shell (_layout.tsx)
 * keeps it mounted OVER the app until the feed is hydrated (or, on first launch, until the
 * onboarding carousel is the next thing to show), then flips `exiting`.
 *
 * Everything that moves here runs on the UI thread (reanimated shared values → animated
 * props/style). That is not a nicety: the JS thread is BUSY for exactly the seconds this
 * screen is on show (SQLite copy, settings/seen-store reads, first-page warm), so a
 * JS-driven loop would stutter precisely when it was supposed to be reassuring.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import {
  HI_MARK_BOX,
  HI_MARK_PATHS,
  HI_MARK_TOTAL_LENGTH,
  type HiMarkPath,
} from '../generated/hiMark.generated';
import { card, cardAlpha } from '../theme';
import { useReduceMotion } from './cards/useReduceMotion';

// ---------------------------------------------------------------------------- the trace ----

/**
 * One pen cycle: draw the whole outline (h → i dot → i stem → triangle) and then wipe it
 * from the start so it reads as a trail following the pen, then start again. Ease-in-out
 * per cycle so the pen leaves and arrives softly instead of snapping between loops.
 */
export const TRACE_CYCLE_MS = 2400;

/**
 * The width, in dp, the native splash draws the icon at — expo-splash-screen's `imageWidth`
 * in app.json (its Android drawable is a 288 dp canvas with the image `imageWidth` wide in
 * the middle; on Android 12+ the system splash presents that same drawable). The mark is
 * shown at exactly this size on the first frame and zoomed up to the big one, so the
 * native→JS hand-off is continuous. Keep in step with app.json.
 */
const NATIVE_SPLASH_IMAGE_DP = 200;
/** How long the mark takes to grow from the native splash size to the title size. */
const TITLE_ZOOM_MS = 360;

/** Outline stroke in dp (round caps/joins). Converted to box units against the drawn side. */
const TRACE_STROKE_DP = 2.75;

/** The solid mark under the trace, at low alpha so the pen has something to "ink in". */
const UNDERLAY_ALPHA = 0.14;

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

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/**
 * strokeDashoffset for one outline given the pen's travel along the WHOLE mark.
 *
 * `pen` runs 0 → 2·total per cycle. The head is at `pen`; the wiping tail follows one full
 * mark-length behind, at `pen − total`. With strokeDasharray = [len, len] a single offset
 * can show any prefix (offset = len − head) or any suffix (offset = −tail), and because the
 * tail lags by ≥ len the two never need to be true at once — so their sum is exact:
 *   before the head arrives → len (hidden); head inside → len − head (drawing);
 *   between → 0 (fully drawn); tail inside → −tail (wiping); after → −len (hidden).
 */
function dashOffsetFor(pen: number, start: number, len: number, total: number) {
  'worklet';
  const head = Math.min(Math.max(pen - start, 0), len);
  const tail = Math.min(Math.max(pen - total - start, 0), len);
  return len - head - tail;
}

interface TracePathProps {
  path: HiMarkPath;
  start: number;
  pen: SharedValue<number>;
  stroke: string;
  strokeWidth: number;
}

function TracePath({ path, start, pen, stroke, strokeWidth }: TracePathProps) {
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffsetFor(pen.value, start, path.length, HI_MARK_TOTAL_LENGTH),
  }));
  return (
    <AnimatedPath
      d={path.d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={[path.length, path.length]}
      animatedProps={animatedProps}
    />
  );
}

// Pen order and where each outline starts along the whole mark (module init, once).
const TRACE_ORDER: { path: HiMarkPath; start: number }[] = [];
{
  let start = 0;
  for (const path of HI_MARK_PATHS) {
    TRACE_ORDER.push({ path, start });
    start += path.length;
  }
}

const inkFor = (p: HiMarkPath) => (p.colour === 'peach' ? card.peach : card.stock);

// --------------------------------------------------------------------------- the screen ----

interface TitleScreenProps {
  /** Flip to true once and the sheet flies off; `onGone` fires when it has left. */
  exiting: boolean;
  onGone: () => void;
}

export function TitleScreen({ exiting, onGone }: TitleScreenProps) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // The mark box is the shorter screen side, centred, so the block comes out 36% of that
  // side wide — exactly the icon's own layout (its block is 36% of the icon's width).
  const side = Math.min(width, height);
  const strokeWidth = (TRACE_STROKE_DP * HI_MARK_BOX) / side;

  // ---- native splash hand-off ----
  // Hide the native splash the frame AFTER this screen has laid out, so the OS frame (same
  // icon, same ink) is only ever swapped for a painted copy of itself.
  const splashHidden = useRef(false);
  const onLayout = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    requestAnimationFrame(() => {
      void SplashScreen.hideAsync();
    });
  }, []);

  // ---- the zoom from the native splash's icon size (UI thread) ----
  // The Svg is laid out at the full title size; the first frame scales it down to the size
  // the native splash drew the icon at, then it grows. Reduced motion: shown at full size.
  const zoom = useSharedValue(reduceMotion ? 1 : Math.min(1, NATIVE_SPLASH_IMAGE_DP / side));
  useEffect(() => {
    if (reduceMotion) {
      zoom.value = 1;
      return;
    }
    zoom.value = withTiming(1, { duration: TITLE_ZOOM_MS, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(zoom);
  }, [zoom, reduceMotion]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));

  // ---- the trace (UI thread) ----
  const pen = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pen.value = 0;
    pen.value = withRepeat(
      withTiming(2 * HI_MARK_TOTAL_LENGTH, {
        duration: TRACE_CYCLE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false
    );
    return () => cancelAnimation(pen);
  }, [pen, reduceMotion]);

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
      <Reanimated.View style={markStyle}>
        <Svg width={side} height={side} viewBox={`0 0 ${HI_MARK_BOX} ${HI_MARK_BOX}`}>
          {reduceMotion ? (
            // No trace: the mark, solid, as it is on the icon.
            HI_MARK_PATHS.map((p) => <Path key={p.id} d={p.d} fill={inkFor(p)} />)
          ) : (
            <>
              {HI_MARK_PATHS.map((p) => (
                <Path key={`u-${p.id}`} d={p.d} fill={cardAlpha(inkFor(p), UNDERLAY_ALPHA)} />
              ))}
              {TRACE_ORDER.map(({ path: p, start }) => (
                <TracePath
                  key={`t-${p.id}`}
                  path={p}
                  start={start}
                  pen={pen}
                  stroke={inkFor(p)}
                  strokeWidth={strokeWidth}
                />
              ))}
            </>
          )}
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
