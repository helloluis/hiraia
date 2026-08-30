import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { type ArtSource } from '../data/artSource';
import { colors, fonts } from '../theme';

/**
 * Full-screen zoomable viewer for an illustration. Pinch to zoom + drag to pan so a
 * kid on a small screen can see detail; tap the dark backdrop or ✕ to close. `source`
 * is the resolved image (null until the image library is bundled → shows a big
 * placeholder so the flow is testable now).
 */
export function Lightbox({
  visible,
  desc,
  source,
  onClose,
}: {
  visible: boolean;
  desc: string;
  source: ArtSource;
  onClose: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // reset zoom/pan each time it opens
  useEffect(() => {
    if (visible) {
      scale.value = 1; savedScale.value = 1;
      tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    }
  }, [visible, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 6)); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) { // snap back to fit + recenter
        scale.value = withTiming(1); savedScale.value = 1;
        tx.value = withTiming(0); ty.value = withTiming(0); savedTx.value = 0; savedTy.value = 0;
      }
    });
  const pan = Gesture.Pan()
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });
  const composed = Gesture.Simultaneous(pinch, pan);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.imageWrap, imgStyle]}>
            {source != null ? (
              <Animated.Image source={source} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderIcon}>🖼️</Text>
                <Text style={styles.placeholderCaption}>{desc}</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
        <Pressable style={styles.close} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 20, 24, 0.92)' },
  imageWrap: { width: '90%', height: '70%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  placeholder: {
    width: '100%', height: '100%', borderRadius: 16, borderWidth: 2, borderStyle: 'dashed',
    borderColor: colors.white, alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  placeholderIcon: { fontSize: 90, marginBottom: 14 },
  placeholderCaption: { fontFamily: fonts.display, fontSize: 20, color: colors.white, textAlign: 'center' },
  close: {
    position: 'absolute', top: 48, right: 22, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: colors.white, fontSize: 22, fontFamily: fonts.body },
});
