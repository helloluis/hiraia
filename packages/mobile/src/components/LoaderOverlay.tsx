import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';

const { height: screenHeight } = Dimensions.get('window');

// Video assets located in packages/loader/videos
const sleepingDefault = require('../../../loader/videos/cat-sleeping-loop-1.mp4');

// ADDING NEW REACTION VIDEOS:
// You can easily add more videos to this array to make user nudges more interesting!
const sleepingReactions = [
  require('../../../loader/videos/cat-sleeping-loop-2.mp4'),
  require('../../../loader/videos/cat-sleeping-loop-3.mp4'),
  require('../../../loader/videos/cat-sleeping-loop-4.mp4'),
];

const wakingVideo = require('../../../loader/videos/cat-waking.mp4');
const exitVideo = require('../../../loader/videos/cat-exit.mp4');

type LoaderPhase = 'sleeping' | 'nudged' | 'waking' | 'exiting' | 'done';

export function LoaderOverlay({ onDismiss }: { onDismiss: () => void }) {
  // DEV-ONLY: true drives a fake 0→100 over ~2 min to preview the animations; MUST be false
  // in real builds so the loader tracks the actual engine warm-up (storeProgress/storeIsReady).
  const SIMULATE_LOADING = false;

  const storeProgress = useEngineStore((s) => s.loadingProgress);
  const storeIsReady = useEngineStore((s) => s.isReady);
  const language = useEngineStore((s) => s.language);

  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [simulatedIsReady, setSimulatedIsReady] = useState(false);

  const loadingProgress = SIMULATE_LOADING ? simulatedProgress : storeProgress;
  const isReady = SIMULATE_LOADING ? simulatedIsReady : storeIsReady;

  const [phase, setPhase] = useState<LoaderPhase>('sleeping');
  const [wakingFinished, setWakingFinished] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Simulation timer (0 to 100 over 120 seconds, i.e., 1200ms per 1%)
  useEffect(() => {
    if (!SIMULATE_LOADING) return;

    const interval = setInterval(() => {
      setSimulatedProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setSimulatedIsReady(true);
          return 100;
        }
        return prev + 1;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  // Smooth progress animation
  const progressAnim = useRef(new Animated.Value(0)).current;
  // Slide out animation
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Track the source currently loaded in the player to avoid redundant replace calls
  const [activeSource, setActiveSource] = useState(sleepingDefault);

  // Initialize the player with default sleeping loop
  const player = useVideoPlayer(sleepingDefault, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Keep track of the current phase in a ref to use in the event listener safely
  const phaseRef = useRef<LoaderPhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep track of progress in a ref for the same reason
  const progressRef = useRef(loadingProgress);
  useEffect(() => {
    progressRef.current = loadingProgress;
  }, [loadingProgress]);

  // Handle play to end event to transition between states
  useEventListener(player, 'playToEnd', () => {
    const currentPhase = phaseRef.current;
    const currentProgress = progressRef.current;

    if (currentPhase === 'nudged') {
      // Return to sleep or transition directly to waking if progress jumped
      if (currentProgress >= 85) {
        setPhase('waking');
      } else {
        setPhase('sleeping');
      }
    } else if (currentPhase === 'waking') {
      setWakingFinished(true);
      if (currentProgress >= 95) {
        setPhase('exiting');
      }
    } else if (currentPhase === 'exiting') {
      setPhase('done');
    }
  });

  // Handle progress-based phase transitions
  useEffect(() => {
    if (phase === 'sleeping' || phase === 'nudged') {
      if (loadingProgress >= 85) {
        setPhase('waking');
      }
    } else if (phase === 'waking' && wakingFinished) {
      if (loadingProgress >= 95) {
        setPhase('exiting');
      }
    }
  }, [loadingProgress, phase, wakingFinished]);

  // Sync player options and source when phase changes
  useEffect(() => {
    let nextSource = sleepingDefault;
    let shouldLoop = true;

    if (phase === 'sleeping') {
      nextSource = sleepingDefault;
      shouldLoop = true;
    } else if (phase === 'nudged') {
      const randomIndex = Math.floor(Math.random() * sleepingReactions.length);
      nextSource = sleepingReactions[randomIndex];
      shouldLoop = false;
    } else if (phase === 'waking') {
      nextSource = wakingVideo;
      shouldLoop = false;
    } else if (phase === 'exiting') {
      nextSource = exitVideo;
      shouldLoop = false;
    } else if (phase === 'done') {
      // Slide out the overlay container upwards
      Animated.timing(slideAnim, {
        toValue: -screenHeight,
        duration: 800,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }).start(() => {
        setIsDismissed(true);
        onDismiss();
      });
      return;
    }

    if (nextSource !== activeSource) {
      setActiveSource(nextSource);
      player.replace(nextSource);
    }
    player.loop = shouldLoop;
    player.play();
  }, [phase, player, activeSource, slideAnim]);

  // Animate progress bar smoothly
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: loadingProgress / 100,
      duration: 350,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [loadingProgress, progressAnim]);

  // Dismiss overlay completely if engine becomes ready and we've finished the animations
  // (This handles cases where the user hot-reloads or transitions complete, ensuring we don't block the screen)
  useEffect(() => {
    if (isReady && phase === 'sleeping') {
      // If we are already ready but somehow still sleeping (e.g. settings reload/hot reload),
      // wake up immediately.
      setPhase('waking');
    }
  }, [isReady, phase]);

  const handlePressCat = () => {
    if (phase === 'sleeping') {
      setPhase('nudged');
    }
  };

  if (isDismissed) return null;

  const welcomeMessage = getWelcomeMessage(language);
  const secondsRemaining = Math.max(0, Math.round((100 - loadingProgress) * 1.2));
  const subtextMessage = SIMULATE_LOADING
    ? `Testing animations (${secondsRemaining}s remaining)...`
    : getSubtextMessage(language, loadingProgress);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.topContainer}>
        <Text style={styles.welcomeText}>{welcomeMessage}</Text>
      </View>

      <View style={styles.middleContainer}>
        <TouchableWithoutFeedback onPress={handlePressCat}>
          <View style={styles.videoContainer}>
            <VideoView
              player={player}
              style={styles.video}
              nativeControls={false}
              contentFit="contain"
            />
          </View>
        </TouchableWithoutFeedback>
      </View>

      <View style={styles.bottomContainer}>
        <View style={styles.progressWrapper}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <View style={styles.progressLabels}>
            <Text style={styles.subtext}>{subtextMessage}</Text>
            <Text style={styles.percentageText}>{Math.round(loadingProgress)}%</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function getWelcomeMessage(lang: string | null): string {
  switch (lang) {
    case 'cebuano':
      return 'pagmata na, hiraia!';
    case 'english':
      return 'wake up, hiraia!';
    case 'tagalog':
    default:
      return 'gising na, hiraia!';
  }
}

function getSubtextMessage(lang: string | null, progress: number): string {
  if (progress < 15) {
    switch (lang) {
      case 'cebuano':
        return 'nag-boot up pa...';
      case 'english':
        return 'starting up...';
      case 'tagalog':
      default:
        return 'nag-bo-boot up pa...';
    }
  } else if (progress < 85) {
    switch (lang) {
      case 'cebuano':
        return 'gipang-load ang utak ni Hiraia...';
      case 'english':
        return "loading Hiraia's memory...";
      case 'tagalog':
      default:
        return 'niloload ang utak ni Hiraia...';
    }
  } else if (progress < 95) {
    switch (lang) {
      case 'cebuano':
        return 'nagmata na siya...';
      case 'english':
        return 'waking her up...';
      case 'tagalog':
      default:
        return 'nagigising na siya...';
    }
  } else {
    switch (lang) {
      case 'cebuano':
        return 'hapit na...';
      case 'english':
        return 'almost ready...';
      case 'tagalog':
      default:
        return 'malapit na...';
    }
  }
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#226474',
    zIndex: 999,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  topContainer: {
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 32,
    width: '100%',
  },
  welcomeText: {
    fontFamily: fonts.display,
    fontSize: 38,
    color: '#fdfdf6',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.15)',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  },
  middleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 720 / 404,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  bottomContainer: {
    alignItems: 'stretch',
    marginBottom: 20,
    paddingHorizontal: 32,
    width: '100%',
  },
  progressWrapper: {
    width: '100%',
    alignItems: 'stretch',
  },
  progressTrack: {
    height: 12,
    backgroundColor: 'rgba(253, 253, 246, 0.15)',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(253, 253, 246, 0.25)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent, // warm yellow
    borderRadius: 6,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  subtext: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: 'rgba(253, 253, 246, 0.7)',
  },
  percentageText: {
    fontFamily: fonts.body,
    fontSize: 20,
    color: colors.accent,
  },
});
