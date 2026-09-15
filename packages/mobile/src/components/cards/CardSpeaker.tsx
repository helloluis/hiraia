/**
 * The read-aloud speaker, wired up: `BandSpeaker`/`Speaker` from CardFrame are the printed
 * furniture, this holds the speech state.
 *
 * Pass `variant="band"` to print it in the card's index-band stamp disc (where the cat used
 * to sit), or the default to put it on the ticket's ledge line at the bottom-right.
 */
import { useEffect } from 'react';
import { Alert } from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { canSpeak, preloadVoice, useSpeech } from '../../speech';
import { BandSpeaker, Speaker } from './CardFrame';

export function CardSpeaker({
  text,
  language,
  variant = 'ticket',
  onAudioStart,
}: {
  text: string;
  language: Language;
  /** 'band' prints it in the index-band stamp disc; 'ticket' beside the gold ticket. */
  variant?: 'band' | 'ticket';
  /**
   * Fires when sound actually starts — seconds after the tap on a slow phone. CardPage
   * keys the reading guide's sweep to it so the gold marker moves with the voice, not
   * with the silence before it.
   */
  onAudioStart?: () => void;
}) {
  const t = uiStrings(language);
  const { phase, toggle } = useSpeech();

  // Warm the model while the card is being read rather than on the tap. The first load
  // also materialises the weights out of the APK, which is the slow part and happens
  // exactly once per install.
  useEffect(() => {
    preloadVoice(language);
  }, [language]);

  // No voice trained for this language yet — render nothing rather than a button that
  // speaks in a different narrator's voice. Hooks run first so the order stays stable.
  if (!canSpeak(language)) return null;

  const press = () =>
    toggle(text, language, {
      onStart: onAudioStart,
      onError: () =>
        Alert.alert(t.speech.failedTitle, t.speech.failedBody, [{ text: t.speech.dismiss }]),
    });
  const label = phase !== 'idle' ? t.speech.stop : t.speech.listen;
  if (variant === 'band') {
    return <BandSpeaker phase={phase} accessibilityLabel={label} onPress={press} />;
  }
  return <Speaker speaking={phase !== 'idle'} accessibilityLabel={label} onPress={press} />;
}
