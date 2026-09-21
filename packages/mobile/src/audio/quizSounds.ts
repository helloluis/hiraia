import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer } from 'expo-audio';
import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPreparedCue, createQuizStreak, createSoundBag } from './quizFeedbackCore';

const sources = [
  require('../../assets/audio/quiz/soft-rising.wav'),
  require('../../assets/audio/quiz/crystalline.wav'),
  require('../../assets/audio/quiz/bright.wav'),
  require('../../assets/audio/quiz/achievement.wav'),
  require('../../assets/audio/quiz/sparkle.wav'),
  require('../../assets/audio/quiz/synth-texture.wav'),
  require('../../assets/audio/quiz/glossy-1.wav'),
  require('../../assets/audio/quiz/glossy-2.wav'),
  require('../../assets/audio/quiz/jewel-1.wav'),
  require('../../assets/audio/quiz/jewel-2.wav'),
];
const nextSound = createSoundBag(sources.length);
export const recordQuizFeedback = createQuizStreak();
const KEY = 'hiraia.quiz-sounds.v1';
let preference = { ready: false, enabled: true };
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
const snapshot = () => preference;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function publish() {
  for (const fn of listeners) fn();
}
function initialize() {
  return (loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      preference = { ready: true, enabled: raw !== 'false' };
      publish();
    })
    .catch(() => {
      preference = { ready: true, enabled: false };
      publish();
    }));
}
export function useQuizSoundSettings() {
  useEffect(() => {
    void initialize();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export async function setQuizSoundsEnabled(enabled: boolean) {
  await initialize();
  await AsyncStorage.setItem(KEY, String(enabled));
  preference = { ready: true, enabled };
  publish();
}

/** Prepare while the student reads. One native player, released on card exit.
 * No global audio-mode changes: keep read-aloud's audio routing intact.
 */
export function useQuizSparkle(eligible: boolean): () => void {
  const cue = useRef<ReturnType<typeof createPreparedCue> | null>(null);
  useEffect(() => {
    if (!eligible) return;
    void initialize();
    try {
      const player = createAudioPlayer(sources[nextSound()]!, { updateInterval: 1000 });
      player.volume = 0.65;
      const prepared = createPreparedCue(
        player,
        () => preference.ready && preference.enabled && AppState.currentState === 'active'
      );
      cue.current = prepared;
      const app = AppState.addEventListener('change', (state) => {
        if (state !== 'active') prepared.stop();
      });
      const stop = subscribe(() => {
        if (!preference.enabled) prepared.stop();
      });
      return () => {
        app.remove();
        stop();
        prepared.dispose();
        cue.current = null;
      };
    } catch {
      /* Missing audio support must never prevent answering. */
    }
  }, [eligible]);
  return useCallback(() => {
    cue.current?.play();
  }, []);
}
