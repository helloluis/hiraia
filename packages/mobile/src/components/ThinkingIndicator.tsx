import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import type { Language } from '@hiraia/shared';

import { useChatStore } from '../store/chatStore';
import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';

/**
 * The "thinking" indicator shown while the model is prefilling/working, BEFORE the
 * first token arrives (replaces a static spinner). On a slow on-device 3B the wait can
 * be 10-40s, so a changing emoji/phrase gives the child a sense that the device is busy
 * doing something — much better perceived performance than a frozen wheel.
 *
 * Two kinds of cues, picked at random and swapped every 3-5s:
 *   - emoji: printed three times, one at a time (🤔 → 🤔 🤔 → 🤔 🤔 🤔)
 *   - text phrase: typewritered on, char by char, with a trailing " …"
 *
 * Text phrases are scoped to the ACTIVE language (no Bisaya in a Tagalog chat); emojis
 * are language-neutral. Pass `language` to override (e.g. the onboarding demo); otherwise
 * it follows the engine's current language.
 *
 * `style` likewise overrides only the TYPE. The chat is still on the notebook theme and
 * keeps its handwriting in muted blue-grey; the onboarding demo now prints on a mid-century
 * card, where that face and that blue-grey are the one thing on the card from another
 * palette. Nothing about the animation changes with it.
 */

// Language-neutral cues. Each is animated as three copies appearing one at a time.
const EMOJIS = ['🤔', '💭', '🧠', '🧐', '🔍', '⏱', '👀', '😺', '🐱', '📝', '📖', '💫', '🌼'];

// Short "doing something" phrases PER LANGUAGE (the trailing " …" is added by the renderer).
// Extend freely; keep each list in its own language.
const PHRASES: Record<Language, string[]> = {
  tagalog: [
    'nag-iisip',
    'pinag-iisipan',
    'nagta-type',
    'isinusulat',
    'naghahanap',
    'hinahanap',
    'tumitingin',
    'binubuklat',
  ],
  cebuano: ['naghunahuna', 'nangita', 'gipangita', 'nagtan-aw', 'nagsulat', 'nangita og tubag'],
  english: ['thinking', 'typing', 'writing', 'searching', 'finding', 'looking'],
};

// Fuller "still working on it" phrases rotated DURING the long prefill (after retrieval),
// interleaved with the topic anchor ("Binabasa ang tungkol sa <topic>") so a ~30s wait
// shows variety instead of one frozen line. Cosmetic only.
const WORKING_PHRASES: Record<Language, string[]> = {
  tagalog: [
    'Pinag-iisipan ang sagot',
    'Isinusulat ang paliwanag',
    'Inaayos ang mga salita',
    'Halos tapos na',
  ],
  cebuano: [
    'Gihunahuna ang tubag',
    'Gisulat ang pasabot',
    'Gihan-ay ang mga pulong',
    'Hapit na',
  ],
  english: ['Thinking it through', 'Writing the explanation', 'Putting the words together', 'Almost there'],
};

type Cue = { kind: 'emoji'; value: string } | { kind: 'text'; value: string };

const EMOJI_STEP_MS = 380; // gap between the 1st/2nd/3rd emoji
const TYPE_STEP_MS = 55; // per-character typewriter speed
const DWELL_MIN_MS = 3000;
const DWELL_MAX_MS = 5000;

export function ThinkingIndicator({
  language,
  style,
}: {
  language?: Language;
  /** Type overrides (face/size/colour); defaults to the notebook theme's muted hand. */
  style?: StyleProp<TextStyle>;
}) {
  const active = useEngineStore((s) => s.language);
  const lang: Language = language ?? active ?? 'tagalog';
  const [display, setDisplay] = useState('');

  // Real-pipeline narration set by chatStore.sendMessage ("Naghahanap…" → "Binabasa
  // ang tungkol sa <topic>…"). When present it OVERRIDES the random cues below, so the
  // wait reflects what's actually happening. Empty (e.g. warm-up) → random cues.
  const status = useChatStore((s) => s.thinkingStatus);
  // Always-animating ellipsis (… cycles 0→3 dots) so a 30s prefill never looks frozen.
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : `${d}.`)), 450);
    return () => clearInterval(id);
  }, []);

  // In status mode, rotate through [topic anchor, …working phrases] every ~3.5s so the
  // long prefill has variety. Resets to the anchor (index 0) whenever the stage/turn
  // changes (status string changes), so the topic shows first.
  const rotation = useMemo<string[]>(
    () => (status ? [status, ...(WORKING_PHRASES[lang] ?? WORKING_PHRASES.tagalog)] : []),
    [status, lang]
  );
  const [rotIdx, setRotIdx] = useState(0);
  useEffect(() => {
    if (!status) return;
    setRotIdx(0);
    const id = setInterval(() => setRotIdx((i) => (i + 1) % rotation.length), 3500);
    return () => clearInterval(id);
  }, [status, rotation.length]);

  const library = useMemo<Cue[]>(
    () => [
      ...EMOJIS.map((value) => ({ kind: 'emoji' as const, value })),
      ...(PHRASES[lang] ?? PHRASES.tagalog).map((value) => ({ kind: 'text' as const, value })),
    ],
    [lang]
  );

  useEffect(() => {
    if (status) return; // status mode (real pipeline narration) handles the display
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };
    const clearAll = () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };

    const playEmoji = (g: string) => {
      setDisplay(g);
      later(() => {
        if (cancelled) return;
        setDisplay(`${g} ${g}`);
        later(() => {
          if (cancelled) return;
          setDisplay(`${g} ${g} ${g}`);
        }, EMOJI_STEP_MS);
      }, EMOJI_STEP_MS);
    };

    const playText = (phrase: string) => {
      const full = `${phrase} …`;
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        i += 1;
        setDisplay(full.slice(0, i));
        if (i < full.length) later(tick, TYPE_STEP_MS);
      };
      tick();
    };

    const cycle = () => {
      if (cancelled) return;
      clearAll(); // drop any leftover animation timers from the previous cue
      const cue = library[Math.floor(Math.random() * library.length)]!;
      if (cue.kind === 'emoji') playEmoji(cue.value);
      else playText(cue.value);
      const dwell = DWELL_MIN_MS + Math.random() * (DWELL_MAX_MS - DWELL_MIN_MS);
      later(cycle, dwell);
    };

    cycle();
    return () => {
      cancelled = true;
      clearAll();
    };
  }, [library, status]);

  // Status mode: rotating phrase (topic anchor ↔ working phrases) + live ellipsis, so the
  // long prefill shows what's happening AND varies. Otherwise: the random warm-up cue.
  return (
    <Text style={[styles.text, style]}>
      {status ? `${rotation[rotIdx] ?? status} ${dots}` : display}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 24,
    color: colors.inkMuted,
    minHeight: 24, // reserve a line so the bubble doesn't jump as text types on
  },
});
