import { useState } from 'react';
import { Image, type LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useArtSource } from '../data/artSource';
import { colors, fonts } from '../theme';

import { Lightbox } from './Lightbox';

// Cap on wide viewports (tablets / landscape) so the illustration stays a tidy square
// instead of dominating the thread.
const MAX_SIDE = 320;

/**
 * A square thumbnail for a science illustration. Tap → full-screen pinch-zoom
 * Lightbox. `slug` resolves to a bundled 512×512 PNG via the generated IMAGE_MAP;
 * if there's no match (e.g. a model [image:] description rather than a slug) it
 * falls back to a placeholder so the flow still renders.
 *
 * Square is enforced by measuring the available width (onLayout) and setting an
 * EXPLICIT width===height — not `aspectRatio: 1` + `width: '100%'`, which on Android
 * can derive height from the unclamped width and render a tall rectangle on wide
 * viewports. Full-width on narrow devices, capped at MAX_SIDE on wide ones.
 */
export function ImageSlot({ desc, slug }: { desc: string; slug?: string }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(0); // measured square side = min(available width, MAX_SIDE)
  const source = useArtSource(slug ?? desc);

  const onWrapLayout = (e: LayoutChangeEvent) => {
    const next = Math.min(e.nativeEvent.layout.width, MAX_SIDE);
    if (next > 0 && Math.abs(next - side) > 0.5) setSide(next);
  };

  return (
    <>
      {/* Full-width measuring wrapper; the square thumb sizes to min(its width, MAX_SIDE). */}
      <View style={styles.wrap} onLayout={onWrapLayout}>
        <TouchableOpacity
          style={[styles.thumb, side > 0 ? { width: side, height: side } : styles.thumbFallback]}
          onPress={() => setOpen(true)}
          activeOpacity={0.85}
          accessibilityLabel={`Larawan: ${desc}. I-tap para palakihin.`}
        >
          {source != null ? (
            <Image source={source} style={styles.thumbImage} resizeMode="cover" />
          ) : (
            <Text style={styles.thumbIcon}>🖼️</Text>
          )}
        </TouchableOpacity>
      </View>
      <Lightbox visible={open} desc={desc} source={source} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: 10,
    alignItems: 'flex-start',
  },
  thumb: {
    // A clean, deliberate rounded card — the illustration's white ground reads as the card
    // surface (Android RN can't blend it into the bubble). A faint dashed outline is the only
    // hint that it's tappable ("tap to enlarge").
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // clip the illustration to the rounded card
  },
  // First-paint fallback before onLayout measures: full-width square, capped. Replaced by the
  // explicit { width: side, height: side } as soon as the wrapper reports its width.
  thumbFallback: { width: '100%', maxWidth: MAX_SIDE, aspectRatio: 1 },
  thumbImage: { width: '100%', height: '100%' },
  thumbIcon: { fontSize: 48 },
});
