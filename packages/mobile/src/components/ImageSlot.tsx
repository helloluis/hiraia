import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fonts } from '../theme';

import { Lightbox } from './Lightbox';

/**
 * A 128×128 thumbnail rendered wherever the tutor emits an `[image: <desc>]` token.
 * Tap → full-screen pinch-zoom Lightbox. Works REGARDLESS of a binary existing: until
 * the image library is bundled, `resolveImage` returns null and we show a placeholder
 * (so the end-to-end handler is testable now). When images ship, point resolveImage at
 * the bundled asset map and both the thumbnail and lightbox render the real picture.
 */
function resolveImage(_desc: string): number | null {
  // TODO: map desc/slug → require('../../assets/science-images/<slug>.png') once bundled.
  return null;
}

export function ImageSlot({ desc }: { desc: string }) {
  const [open, setOpen] = useState(false);
  const source = resolveImage(desc);

  return (
    <>
      <TouchableOpacity
        style={styles.thumb}
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
      <Lightbox visible={open} desc={desc} source={source} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  thumb: {
    marginTop: 10,
    width: 128,
    height: 128,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbIcon: { fontSize: 48 },
});
