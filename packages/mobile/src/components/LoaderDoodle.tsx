import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * LoaderDoodle — gives a waiting student something to do during the (potentially long
 * first-run) loader: tap or swipe anywhere and leave ephemeral crayon marks that bloom
 * and fade. Entirely native-powered with NO new dependency — gesture detection runs on
 * the UI thread (react-native-gesture-handler) and every mark's bloom/fade is a
 * Reanimated worklet (also UI thread); the marks themselves are plain native Views. The
 * only JS work is appending/pruning a small capped array, throttled to one mark per few
 * px of travel.
 *
 * Wraps the loader content: a single full-screen Pan gesture covers the whole screen.
 * A near-stationary touch is treated as a tap and forwarded to `onTap` (so the existing
 * "nudge the sleeping cat" behavior is preserved); a drag paints a trail.
 */

// Kid crayon-box palette; one colour is chosen per stroke.
const CRAYONS = [
  '#ff5d5d',
  '#ffb43d',
  '#ffe14d',
  '#5ec96b',
  '#3db4ff',
  '#7a6bff',
  '#ff7ec6',
  '#ff8a3d',
];

const LIFE_MS = 2500; // a mark's full bloom→fade lifetime
const MAX_MARKS = 150; // hard cap on live Views (oldest dropped first); raised to match
// the longer lifetime so a sustained scribble isn't truncated before its marks fade

const MIN_STEP = 7; // min px of travel between marks along a swipe
const TAP_SLOP = 8; // total displacement under this on release = a tap (nudge), not a stroke

interface DoodleMark {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
}

function Mark({ x, y, size, color }: Omit<DoodleMark, 'id'>) {
  // t runs 0→1 linearly over the lifetime; opacity/scale are shaped separately so the
  // mark POPS in like a crayon press, STAYS solid for ~the first second, then fades out
  // over the rest — rather than dissolving the instant it's drawn.
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: LIFE_MS });
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 0.4, 1], [0, 0.92, 0.92, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(t.value, [0, 0.12, 1], [0.5, 1.05, 1.0], Extrapolation.CLAMP) },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.mark,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function LoaderDoodle({
  onTap,
  children,
}: {
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const [marks, setMarks] = useState<DoodleMark[]>([]);
  const idRef = useRef(0);
  const colorRef = useRef<string>(CRAYONS[0] ?? '#ff5d5d');
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Cancel pending removals on unmount (the whole loader unmounts after dismiss).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  const beginStroke = useCallback(() => {
    colorRef.current = CRAYONS[Math.floor(Math.random() * CRAYONS.length)] ?? '#ff5d5d';
  }, []);

  const addMark = useCallback((x: number, y: number) => {
    const id = idRef.current++;
    const size = 16 + Math.random() * 16;
    const mark: DoodleMark = { id, x, y, size, color: colorRef.current };
    setMarks((prev) => {
      const next = [...prev, mark];
      return next.length > MAX_MARKS ? next.slice(next.length - MAX_MARKS) : next;
    });
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      setMarks((prev) => prev.filter((m) => m.id !== id));
    }, LIFE_MS + 80);
    timers.current.add(handle);
  }, []);

  // One Pan gesture handles everything: onBegin paints the first mark, onUpdate paints
  // the trail (throttled by distance), and a near-stationary release is forwarded as a
  // tap so the cat-nudge still works. minDistance(0) → activates immediately so onUpdate
  // fires even for slow, small drags.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      startX.value = e.x;
      startY.value = e.y;
      lastX.value = e.x;
      lastY.value = e.y;
      runOnJS(beginStroke)();
      runOnJS(addMark)(e.x, e.y);
    })
    .onUpdate((e) => {
      const dx = e.x - lastX.value;
      const dy = e.y - lastY.value;
      if (dx * dx + dy * dy >= MIN_STEP * MIN_STEP) {
        lastX.value = e.x;
        lastY.value = e.y;
        runOnJS(addMark)(e.x, e.y);
      }
    })
    .onEnd((e) => {
      const dx = e.x - startX.value;
      const dy = e.y - startY.value;
      if (onTap && dx * dx + dy * dy < TAP_SLOP * TAP_SLOP) {
        runOnJS(onTap)();
      }
    });

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {children}
        {/* Above the loader overlay (which sets zIndex 999 + an opaque background), or the
            crayon marks render behind it and never show. elevation matches for Android. */}
        <View style={styles.markLayer} pointerEvents="none">
          {marks.map((m) => (
            <Mark key={m.id} x={m.x} y={m.y} size={m.size} color={m.color} />
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  markLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000, // sit above the loader overlay (zIndex 999)
    elevation: 1000, // Android stacking
  },
  mark: {
    position: 'absolute',
  },
});
