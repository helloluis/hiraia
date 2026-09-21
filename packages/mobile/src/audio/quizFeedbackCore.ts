/** Shuffle without repeating at a bag boundary; every cue plays before cycling. */
export function createSoundBag(count: number, random = Math.random) {
  let bag: number[] = [];
  let last = -1;
  return () => {
    if (!bag.length) {
      bag = Array.from({ length: count }, (_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
      }
    }
    last = bag.pop()!;
    return last;
  };
}

/** Live answers only; deliberately resets on restart or student change. */
export function createQuizStreak() {
  let profile: string | null = null;
  let correctInARow = 0;
  return (profileId: string, correct: boolean): boolean => {
    if (profile !== profileId) {
      profile = profileId;
      correctInARow = 0;
    }
    correctInARow = correct ? correctInARow + 1 : 0;
    return correctInARow > 0 && correctInARow % 3 === 0;
  };
}

export interface CuePlayer {
  isLoaded: boolean;
  play(): void;
  pause(): void;
  remove(): void;
}

/** Never wait for loading and then play a late sound on a different card. */
export function createPreparedCue(player: CuePlayer, canPlay: () => boolean) {
  let used = false;
  let disposed = false;
  return {
    play() {
      if (used || disposed) return;
      used = true;
      try {
        if (canPlay() && player.isLoaded) player.play();
      } catch {
        /* Feedback cannot block a quiz. */
      }
    },
    stop() {
      try {
        if (!disposed) player.pause();
      } catch {
        /* Already released by native audio. */
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        player.remove();
      } catch {
        /* Best-effort release. */
      }
    },
  };
}
