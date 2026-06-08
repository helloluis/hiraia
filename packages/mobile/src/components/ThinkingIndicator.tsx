import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { Language } from '@hiraia/shared';

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

type Cue = { kind: 'emoji'; value: string } | { kind: 'text'; value: string };

const EMOJI_STEP_MS = 380; // gap between the 1st/2nd/3rd emoji
const TYPE_STEP_MS = 55; // per-character typewriter speed
const DWELL_MIN_MS = 3000;
const DWELL_MAX_MS = 5000;

export function ThinkingIndicator({ language }: { language?: Language }) {
  const active = useEngineStore((s) => s.language);
  const lang: Language = language ?? active ?? 'tagalog';
  const [display, setDisplay] = useState('');

  const library = useMemo<Cue[]>(
    () => [
      ...EMOJIS.map((value) => ({ kind: 'emoji' as const, value })),
      ...(PHRASES[lang] ?? PHRASES.tagalog).map((value) => ({ kind: 'text' as const, value })),
    ],
    [lang]
  );

  useEffect(() => {
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
  }, [library]);

  return <Text style={styles.text}>{display}</Text>;
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
