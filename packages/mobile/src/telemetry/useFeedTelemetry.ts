import { useReviewStore } from '../reviews/store';
import { useProfiles } from '../profiles';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useCardStore } from '../store/cardStore';
import { useEngineStore } from '../store/engineStore';
import { showQuiz, viewCard } from './views';

export function useFeedTelemetry(visible = true) {
  const profiles = useProfiles();
  const reviewing = useReviewStore((s) => s.open || s.busy || !!s.error);
  const pageKey = useCardStore((s) => s.pageKey);
  const current = useCardStore((s) => s.current);
  const question = useCardStore((s) => s.question);
  const response = useCardStore((s) => s.response);
  const lessonRecap = useCardStore((s) => s.lessonRecap);
  const titleCard = useCardStore((s) => s.titleCard);
  const reward = useCardStore((s) => s.reward);
  const hydrated = useCardStore((s) => s.hydrated);
  const onboarding = useEngineStore((s) => s.onboardingActive);
  const language = useEngineStore((s) => s.language) || 'english';
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        clearTimeout(timer);
        if (
          !visible ||
          AppState.currentState !== 'active' ||
          !hydrated ||
          onboarding ||
          profiles.choosing ||
          !profiles.ready ||
          lessonRecap ||
          titleCard ||
          reward ||
          reviewing
        )
          return;
        // Committed, focused page visible for 500 ms; no preloads or outgoing animation copies.
        timer = setTimeout(() => {
          if (question) showQuiz(pageKey, question.f, language);
          else if (response?.kind === 'generated') viewCard(pageKey, 'generated', language);
          else if (!response && current) {
            viewCard(pageKey, 'curated', language, current.id);
            useCardStore.getState().prepareReview();
          }
        }, 500);
      };
      schedule();
      const sub = AppState.addEventListener('change', schedule);
      return () => {
        clearTimeout(timer);
        sub.remove();
      };
    }, [
      visible,
      reviewing,
      lessonRecap,
      titleCard,
      pageKey,
      current,
      question,
      response,
      reward,
      hydrated,
      onboarding,
      language,
      profiles.choosing,
      profiles.ready,
    ])
  );
}
