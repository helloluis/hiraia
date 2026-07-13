import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';
import { LoaderDoodle } from './LoaderDoodle';

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

export function LoaderOverlay({ onDismiss, splash = false }: { onDismiss: () => void; splash?: boolean }) {
  // DEV-ONLY: true drives a fake 0→100 over ~2 min to preview the animations; MUST be false
  // in real builds so the loader tracks the actual engine warm-up (storeProgress/storeIsReady).
  const SIMULATE_LOADING = false;

  const storeProgress = useEngineStore((s) => s.loadingProgress);
  const storeIsReady = useEngineStore((s) => s.isReady);
  const storePhase = useEngineStore((s) => s.loadingPhase);
  const language = useEngineStore((s) => s.language);

  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [simulatedIsReady, setSimulatedIsReady] = useState(false);

  const loadingProgress = SIMULATE_LOADING ? simulatedProgress : storeProgress;
  const isReady = SIMULATE_LOADING ? simulatedIsReady : storeIsReady;
  // The simulator only exercises the warm-up curve, so treat it as the 'warming' phase.
  const loadingPhase = SIMULATE_LOADING ? 'warming' : storePhase;

  const [phase, setPhase] = useState<LoaderPhase>('sleeping');
  const [wakingFinished, setWakingFinished] = useState(false);
  const [exitFinished, setExitFinished] = useState(false);
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

  // The reaction clip chosen when the user taps the sleeping cat. Picked once per tap
  // (in handlePressCat) and held in a ref so the source-sync effect doesn't re-roll it.
  const nudgeSourceRef = useRef(sleepingReactions[0]);

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

  // The exit video may finish playing BEFORE the model is actually ready (the loader
  // timing is an estimate that may overextend). We must never slide the cover off into
  // a not-ready chat, so the dismiss is gated on the real isReady — read via a ref so
  // the player event listener sees the latest value.
  const isReadyRef = useRef(isReady);
  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  // Handle play to end event to transition between states
  useEventListener(player, 'playToEnd', () => {
    const currentPhase = phaseRef.current;
    const currentProgress = progressRef.current;

    if (currentPhase === 'nudged') {
      // Return to sleep or transition directly to waking if progress jumped
      if (currentProgress >= 97) {
        setPhase('waking');
      } else {
        setPhase('sleeping');
      }
    } else if (currentPhase === 'waking') {
      setWakingFinished(true);
      // SPLASH: the cat is a brief cosmetic intro decoupled from the (lazily-loaded)
      // model — walk off as soon as it finishes waking, regardless of progress/isReady.
      if (splash || currentProgress >= 95) {
        setPhase('exiting');
      }
    } else if (currentPhase === 'exiting') {
      // Walk-off finished. Only dismiss once the model is truly ready; otherwise hold
      // on the last exit frame and let the isReady effect below release it. In SPLASH
      // mode there is no model to wait for → dismiss now.
      setExitFinished(true);
      if (splash || isReadyRef.current) {
        setPhase('done');
      }
    }
  });

  // SPLASH: nudge the sleeping cat awake shortly after mount so the whole intro
  // (sleep → wake → walk off) plays in ~3-4s instead of tracking a model load.
  useEffect(() => {
    if (!splash) return;
    const id = setTimeout(() => {
      setPhase((p) => (p === 'sleeping' ? 'waking' : p));
    }, 750);
    return () => clearTimeout(id);
  }, [splash]);

  // Release the held exit frame the moment the engine becomes ready (covers the case
  // where the animation overextended past the real load).
  useEffect(() => {
    if (phase === 'exiting' && exitFinished && isReady) {
      setPhase('done');
    }
  }, [phase, exitFinished, isReady]);

  // Handle progress-based phase transitions
  useEffect(() => {
    if (phase === 'sleeping' || phase === 'nudged') {
      if (loadingProgress >= 97) {
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
      // Use the reaction chosen ONCE on tap (in handlePressCat). Re-rolling here would
      // re-fire on every activeSource change and flicker between reaction clips.
      nextSource = nudgeSourceRef.current;
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

  // Re-attach the video surface when the app returns to the foreground. On some
  // Adreno devices the native decoder surface comes back BLACK after a background→
  // resume (observed in logcat: "setOutputSurface … BAD_INDEX" on onHostResume),
  // leaving a black rectangle where the cat should be. Re-playing — and, for the
  // looping clips, re-setting the source — forces the surface to repaint. We skip
  // the one-shot end phases so we don't restart a clip mid-transition.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const p = phaseRef.current;
      if (p === 'sleeping' || p === 'nudged') {
        player.replace(activeSource);
      }
      player.play();
    });
    return () => sub.remove();
  }, [player, activeSource]);

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
      // Pick the reaction clip now, once, so the source-sync effect plays exactly one.
      const i = Math.floor(Math.random() * sleepingReactions.length);
      nudgeSourceRef.current = sleepingReactions[i];
      setPhase('nudged');
    }
  };

  if (isDismissed) return null;

  const welcomeMessage = getWelcomeMessage(language);
  const secondsRemaining = Math.max(0, Math.round((100 - loadingProgress) * 1.2));
  const subtextMessage = SIMULATE_LOADING
    ? `Testing animations (${secondsRemaining}s remaining)...`
    : getSubtextMessage(language, loadingProgress, loadingPhase);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    // Tap/swipe anywhere paints ephemeral crayon marks (something to do while waiting);
    // a near-stationary tap is forwarded to handlePressCat to nudge the sleeping cat.
    <LoaderDoodle onTap={handlePressCat}>
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

        {/* pointerEvents="none" so the touch falls through to the full-screen doodle
            gesture (the native video would otherwise swallow it). TextureView (not the
            default SurfaceView) so the crayon layer composites OVER the cat and to dodge
            the SurfaceView black-frame-on-resume bug. */}
        <View style={styles.middleContainer} pointerEvents="none">
          <View style={styles.videoContainer}>
            <VideoView
              player={player}
              style={styles.video}
              nativeControls={false}
              contentFit="contain"
              surfaceType="textureView"
            />
          </View>
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
            {loadingPhase === 'downloading' && (
              <Text style={styles.helperText}>{getDownloadHelperText(language)}</Text>
            )}
          </View>
        </View>
      </Animated.View>
    </LoaderDoodle>
  );
}

// Reassurance shown during the one-time first-run download (the ~3 GB base model +
// the embedder). It's a big, one-time fetch — tell the student it only happens once
// and runs in the background, so a long bar doesn't read as "stuck".
function getDownloadHelperText(lang: string | null): string {
  switch (lang) {
    case 'cebuano':
      return 'Daghan pa among gi-download — kausa ra ni nga himuon, dayon paspas na! 📚';
    case 'english':
      return "We're downloading a lot of files — just this once, then it's quick! 📚";
    case 'tagalog':
    default:
      return 'Marami pang dino-download — isang beses lang po ito, tapos mabilis na! 📚';
  }
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

function getSubtextMessage(
  lang: string | null,
  progress: number,
  phase: 'idle' | 'downloading' | 'warming' | 'ready'
): string {
  // The one-time 3 GB base-model download (first run only) gets its own honest copy —
  // it's a fetch, not the in-memory "loading her brain" step.
  if (phase === 'downloading') {
    switch (lang) {
      case 'cebuano':
        return 'gi-download ang utak ni Hiraia...';
      case 'english':
        return "downloading Hiraia's brain...";
      case 'tagalog':
      default:
        return 'dino-download ang utak ni Hiraia...';
    }
  }
  // Warm-up tail (every cold start). The cat wakes at 97%, so the "waking" copy only
  // shows in the final approach (≥95) and the rest is the load-into-RAM message.
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
  } else if (progress < 95) {
    switch (lang) {
      case 'cebuano':
        return 'gipang-load ang utak ni Hiraia...';
      case 'english':
        return "loading Hiraia's memory...";
      case 'tagalog':
      default:
        return 'niloload ang utak ni Hiraia...';
    }
  } else {
    switch (lang) {
      case 'cebuano':
        return 'nagmata na siya...';
      case 'english':
        return 'waking her up...';
      case 'tagalog':
      default:
        return 'nagigising na siya...';
    }
  }
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Must EXACTLY match the baked-in background of the cat videos (#165a69) so the
    // notebook-cover overlay and the video region read as one seamless surface.
    // Same value is set for the Android splash (colors.xml) + status bar (styles.xml).
    backgroundColor: '#165a69',
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
  helperText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: 'rgba(253, 253, 246, 0.55)',
    marginTop: 8,
    lineHeight: 19,
  },
  percentageText: {
    fontFamily: fonts.body,
    fontSize: 20,
    color: colors.accent,
  },
});
