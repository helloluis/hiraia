/**
 * The READING GUIDE — a translucent gold marker stroke that sweeps left→right along each
 * line of a card's text in reading order, like a finger under the words for a young reader.
 *
 * HOW IT DRAWS. A card's text is several Text nodes (the question hook, the lifted display
 * term of a poster layout, the body). Each guided Text reports its line boxes through
 * `onTextLayout` — Fabric emits one event per Text with every line's x/y/width/height in the
 * Text's own coordinates, nested spans included, and the emitter only re-dispatches when the
 * measurements actually change (ParagraphEventEmitter), so the typewriter's per-tick span
 * shuffle costs no JS events. One absolutely positioned Animated.View band is laid under each
 * line, BEHIND the glyphs (first child of a wrapper the Text shares, `pointerEvents: none`,
 * never in layout), and grows from its left edge on the NATIVE driver: `scaleX` about the
 * centre, bracketed by the two translateX that move the pivot to the left end. No width
 * animation, no per-frame JS; the JS thread hears from it once per LINE (the sequence's
 * hand-off) and never per frame — which is what an Adreno-610 phone needs.
 *
 * HOW IT PACES. A line's sweep lasts its character count over READING_CHARS_PER_SECOND —
 * the one tunable — with a breath at each line end, and the lines run in READING ORDER: the
 * hook first, then the body; on a poster layout the words before the lifted term, the term,
 * then the rest, which is also their visual order top to bottom.
 *
 * HOW IT ENDS. A completed line keeps its stroke while the finger moves on, so mid-card the
 * page reads as highlighted-so-far. A beat after the last line every band fades out together.
 * They do NOT stay: a permanent gold wash under every line would tint the whole card and
 * drown the one highlight that is meant to stay — the peach `highlight` emphasis swatch that
 * marks the term a card teaches — and the finger, having led the reader through, lifts. The
 * page is left as printed.
 *
 * LIFECYCLE. The owner arms it (`armed`) once the typewriter is done; the run starts after a
 * short beat so the illustration and tickets land first. Any change to the line boxes while a
 * run is live (the poster shrink loop re-setting the type) stops the run, zeroes every band
 * and re-arms on the NEW boxes — a band is only ever drawn from the latest measurement of the
 * text it belongs to. Unmount stops the run. A text change (a cold row landing) invalidates
 * every box measured for the old string.
 *
 * REDUCED MOTION: nothing is drawn. The guide's only information IS its motion; a static
 * stroke under every line would be the permanent wash rejected above, carrying no guidance.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  type TextLayoutEvent,
  type TextProps,
  View,
} from 'react-native';

import { card, cardAlpha } from '../../theme';

/**
 * The reading rate the stroke leads at, in characters per second — the ONE pace constant.
 *
 * The card bank averages 6.0 characters per word in Tagalog including the space (5.9 Bisaya,
 * 5.7 English; measured over all 46,421 rows of cards.db), so 12 chars/s is 2.0 words/s, or
 * ~120 words per minute. Phil-IRI's grade 4–6 oral-fluency bands sit around 80–100 wpm and
 * silent reading runs faster than reading aloud, so this leads a grade-5 reader slightly
 * rather than dragging behind them — a guide should be a half-step ahead of the eye. A
 * median 153-character card sweeps in ~13 s. Lower it toward 10 if on-device reading shows
 * the finger outrunning the kids.
 */
export const READING_CHARS_PER_SECOND = 12;

/** A breath at the end of each line, as the eye returns to the left margin. */
const LINE_PAUSE_MS = 90;
/** Floor for a very short line (a lone figure, a two-letter word), so it still visibly sweeps. */
const LINE_MIN_MS = 220;
/** After the typewriter lands: let the illustration and tickets fade in (240 ms) first. */
const START_BEAT_MS = 520;
/** The band inks in at the start of its line rather than popping. */
const INK_IN_MS = 140;
/** How long the finished page holds its strokes before they lift. */
const HOLD_MS = 900;
const FADE_MS = 700;

/** Mustard gold at marker translucency — the glyphs stay ink, the paper shows through. */
const STROKE = cardAlpha(card.gold, 0.34);
/** A marker overshoots the line's ends by a hair. */
const OVERSHOOT = 3;
/** The stroke covers the glyph body, not the full leading. */
const VERTICAL_INSET = 0.12;

interface LineBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Characters the eye has to cover on this line — trailing whitespace excluded. */
  chars: number;
}

interface Slot {
  /** The string these boxes were measured for; boxes for any other string are stale. */
  forText: string;
  lines: LineBox[] | null;
  /** The Text's own offset inside its wrapper (a display line carries a margin). */
  dx: number;
  dy: number;
}

const lineDuration = (chars: number) =>
  Math.max(LINE_MIN_MS, Math.round((chars / READING_CHARS_PER_SECOND) * 1000));

export interface ReadingGuide {
  /** Off entirely (not the live card, or reduced motion): GuidedText prints a bare wrapper. */
  readonly on: boolean;
  /** @internal */
  readonly slots: Readonly<Record<string, Slot>>;
  /** @internal */
  readonly text: string;
  /** @internal */
  readonly fade: Animated.Value;
  /** @internal */
  progress(slot: string, n: number): Animated.Value[];
  /** @internal */
  onTextLayout(slot: string, e: TextLayoutEvent): void;
  /** @internal */
  onLayout(slot: string, e: LayoutChangeEvent): void;
}

interface Options {
  /** True only for the LIVE card; false for preview / outgoing / snapshot copies. */
  enabled: boolean;
  /** The typewriter has finished — the guide may begin after its beat. */
  armed: boolean;
  /** The string being read; a change invalidates every measured box and restarts. */
  text: string;
  /** Slot names in reading order. Every slot listed must report before the run starts. */
  order: readonly string[];
}

export function useReadingGuide({ enabled, armed, text, order }: Options): ReadingGuide {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const textRef = useRef(text);
  textRef.current = text;
  const values = useRef(new Map<string, Animated.Value[]>()).current;
  const fade = useRef(new Animated.Value(1)).current;
  /** The string whose sweep ran to its end — it is not run twice; only a new string is. */
  const sweptFor = useRef<string | null>(null);

  const progress = useCallback(
    (slot: string, n: number) => {
      let vs = values.get(slot);
      if (!vs) {
        vs = [];
        values.set(slot, vs);
      }
      while (vs.length < n) vs.push(new Animated.Value(0));
      return vs;
    },
    [values]
  );

  const onTextLayout = useCallback((slot: string, e: TextLayoutEvent) => {
    const forText = textRef.current;
    const lines: LineBox[] = e.nativeEvent.lines.map((l) => ({
      x: l.x,
      y: l.y,
      w: l.width,
      h: l.height,
      chars: l.text.replace(/\s+$/, '').length,
    }));
    setSlots((prev) => {
      const cur = prev[slot];
      if (cur && cur.forText === forText && sameLines(cur.lines, lines)) return prev;
      return { ...prev, [slot]: { forText, lines, dx: cur?.dx ?? 0, dy: cur?.dy ?? 0 } };
    });
  }, []);

  const onLayout = useCallback((slot: string, e: LayoutChangeEvent) => {
    const { x, y } = e.nativeEvent.layout;
    setSlots((prev) => {
      const cur = prev[slot];
      if (cur && cur.dx === x && cur.dy === y) return prev;
      return {
        ...prev,
        [slot]: {
          forText: cur?.forText ?? textRef.current,
          lines: cur?.lines ?? null,
          dx: x,
          dy: y,
        },
      };
    });
  }, []);

  const orderKey = order.join('|');

  /**
   * THE RUN. Re-armed from scratch whenever anything it was built on moves — the boxes, the
   * text, the reading order — so a band is never left standing on a stale measurement: the
   * cleanup stops the composite, zeroes every band and restores the fade before the next
   * effect builds the sequence on the latest boxes.
   */
  useEffect(() => {
    if (!enabled || !armed || sweptFor.current === text) return;
    const keys = orderKey ? orderKey.split('|') : [];
    const ready = keys.every((k) => slots[k]?.lines && slots[k]!.forText === text);
    if (!ready) return;

    const steps: Animated.CompositeAnimation[] = [];
    let first = true;
    for (const k of keys) {
      const lines = slots[k]!.lines!;
      const vs = progress(k, lines.length);
      lines.forEach((line, i) => {
        if (line.chars === 0 || line.w < 1) return;
        steps.push(
          Animated.timing(vs[i]!, {
            toValue: 1,
            duration: lineDuration(line.chars),
            delay: first ? START_BEAT_MS : LINE_PAUSE_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        );
        first = false;
      });
    }
    if (steps.length === 0) return;
    steps.push(
      Animated.timing(fade, {
        toValue: 0,
        duration: FADE_MS,
        delay: HOLD_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    const run = Animated.sequence(steps);
    run.start(({ finished }) => {
      if (finished) sweptFor.current = text;
    });
    return () => {
      run.stop();
      for (const vs of values.values()) for (const v of vs) v.setValue(0);
      fade.setValue(1);
    };
  }, [enabled, armed, text, orderKey, slots, progress, fade, values]);

  return useMemo(
    () => ({ on: enabled, slots, text, fade, progress, onTextLayout, onLayout }),
    [enabled, slots, text, fade, progress, onTextLayout, onLayout]
  );
}

function sameLines(a: LineBox[] | null, b: LineBox[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h || p.chars !== q.chars) {
      return false;
    }
  }
  return true;
}

/**
 * The bands under one guided Text — rendered BEFORE the Text so the glyphs print over them.
 *
 * MEMOISED on purpose: the owner re-renders its Text on every typewriter tick, and an
 * unmemoised band would rebuild its interpolations each time — which, on the native driver,
 * is a create/connect/drop of native nodes per band per tick on the JS thread. `guide` only
 * changes identity when a slot's boxes or the text change, so the bands re-render exactly
 * when their geometry does.
 */
const Bands = memo(function Bands({ guide, slot }: { guide: ReadingGuide; slot: string }) {
  const s = guide.slots[slot];
  if (!s?.lines || s.forText !== guide.text) return null;
  const vs = guide.progress(slot, s.lines.length);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: guide.fade }]} pointerEvents="none">
      {s.lines.map((line, i) => {
        if (line.chars === 0 || line.w < 1) return null;
        const w = line.w + OVERSHOOT * 2;
        const inset = line.h * VERTICAL_INSET;
        const inkIn = Math.min(0.5, INK_IN_MS / lineDuration(line.chars));
        const p = vs[i]!;
        return (
          <Animated.View
            key={i}
            style={[
              styles.band,
              {
                left: s.dx + line.x - OVERSHOOT,
                top: s.dy + line.y + inset,
                width: w,
                height: line.h - inset * 2,
                opacity: p.interpolate({ inputRange: [0, inkIn, 1], outputRange: [0, 1, 1] }),
                transform: [
                  { translateX: -w / 2 },
                  { scaleX: p.interpolate({ inputRange: [0, 1], outputRange: [0.001, 1] }) },
                  { translateX: w / 2 },
                ],
              },
            ]}
          />
        );
      })}
    </Animated.View>
  );
});

interface GuidedTextProps extends TextProps {
  guide: ReadingGuide;
  /** This Text's name in the guide's reading order. */
  slot: string;
  /**
   * Take the slot's TIME but draw no stroke — for type reversed out of ink (the knockout
   * chip), where a marker has nothing to show on and the chip is already the mark. The
   * finger dwells on the word for as long as it would take to read; the cadence stays whole.
   */
  silent?: boolean;
  children?: ReactNode;
}

/**
 * A Text that the reading guide can sweep. ALWAYS printed inside the same plain wrapper,
 * guided or not, so the preview sheet, the outgoing peel and the live card lay out
 * identically (the swap from preview to live is pixel-matched and must stay so); only the
 * live card attaches the measurement handlers and the bands.
 */
export function GuidedText({ guide, slot, silent, style, children, ...rest }: GuidedTextProps) {
  // One tree for both states, the Text always at the same child index, so the guide
  // switching on or off (reduce-motion resolves after mount) never remounts the Text.
  return (
    <View style={styles.wrap}>
      {guide.on && !silent ? <Bands guide={guide} slot={slot} /> : null}
      {/* KEYED on the string: a new string must re-measure, but Fabric only re-emits
          onTextLayout when the measurements CHANGE, and a term that reads the same in the
          next language at the same size would never report — the slot would sit "stale"
          forever. Remounting the Text on a text change guarantees a fresh report; it happens
          only when the string changes (a cold row landing), never per tick, and in both
          states so the guided and unguided trees stay identical. */}
      <Text
        key={guide.text}
        style={style}
        onTextLayout={guide.on ? (e) => guide.onTextLayout(slot, e) : undefined}
        onLayout={guide.on ? (e) => guide.onLayout(slot, e) : undefined}
        {...rest}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** No padding, no margin: the Text's line coordinates are the wrapper's, plus the Text's
   *  own measured offset. */
  wrap: {},
  band: {
    position: 'absolute',
    borderRadius: 3,
    backgroundColor: STROKE,
  },
});
