/**
 * Read-aloud, over a voice that ships INSIDE the APK.
 *
 * The first version of this used the OS engine through expo-speech, on the assumption
 * that Android's `fil-PH` voice works offline. It does not: on the devices this app is
 * built for it is a network voice and fails with error -4 the moment there is no signal —
 * which is the normal case here, not the edge case. So the voice is ours now: an MMS-VITS
 * checkpoint fine-tuned on Hiraia's own content, run on-device. See docs/TTS.md.
 *
 * This module is the UI's whole view of speech: which languages can be read, a hook with
 * a `speaking` flag, and the joining rule for card fields. The model, the tokenizer and
 * the playback queue live under `voice/`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Language } from '@hiraia/shared';

import { hasBundledVoice, preloadVoice } from './voice/engine';
import { speak as speakNow, stop as stopNow } from './voice/player';

/**
 * Whether the read-aloud control should be shown at all for this language.
 *
 * Cebuano is currently false: there is no fine-tuned Cebuano voice yet, and the stock
 * `mms-tts-ceb` checkpoint is male and reads inconsistently — a third narrator rather
 * than the same teacher. Its corpus script is written; this flips on with the voice.
 */
export function canSpeak(language: Language): boolean {
  return hasBundledVoice(language);
}

export { preloadVoice };

/**
 * The button's state is a PHASE, not a boolean, because on a slow phone the stretch
 * between the tap and the first sound is seconds long and a control that looks inert for
 * that long reads as broken to a child:
 *
 *   idle ──tap──▶ loading ──first audio──▶ speaking ──finished/stopped──▶ idle
 *
 * `loading` starts at the tap; `speaking` starts when sound actually comes out (the
 * player's onStart), which is also the cue the reading guide keys its sweep to. Speech
 * stops on unmount, so pulling the ticket to the next card never leaves audio running
 * underneath the new one.
 */
export type SpeechPhase = 'idle' | 'loading' | 'speaking';

export function useSpeech() {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopNow();
    };
  }, []);

  const stop = useCallback(() => {
    stopNow();
    if (alive.current) setPhase('idle');
  }, []);

  const speak = useCallback(
    async (
      text: string,
      language: Language,
      hooks?: { onStart?: () => void; onError?: () => void },
    ) => {
      const body = text.trim();
      if (!body) return;
      setPhase('loading');
      try {
        await speakNow(body, language, () => {
          if (alive.current) setPhase('speaking');
          hooks?.onStart?.();
        });
      } catch (e) {
        console.warn('[speech] could not read this aloud:', e);
        hooks?.onError?.();
      } finally {
        if (alive.current) setPhase('idle');
      }
    },
    [],
  );

  const toggle = useCallback(
    (
      text: string,
      language: Language,
      hooks?: { onStart?: () => void; onError?: () => void },
    ) => {
      // A second tap stops rather than queues — barge-in, the way a kid expects.
      if (phase !== 'idle') stop();
      else void speak(text, language, hooks);
    },
    [phase, speak, stop],
  );

  return { phase, speaking: phase !== 'idle', speak, stop, toggle };
}

/**
 * Join card fields into one utterance. Blank fields drop out, and each part gets terminal
 * punctuation so the reader pauses between them instead of running the question straight
 * into the first option.
 */
export function utterance(...parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .map((p) => (/[.!?…]$/.test(p) ? p : `${p}.`))
    .join(' ');
}
