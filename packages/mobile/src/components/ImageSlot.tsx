import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { resolveImage } from '../generated/imageMap';
import { colors, fonts } from '../theme';

import { Lightbox } from './Lightbox';

/**
 * A 128×128 thumbnail for a science illustration. Tap → full-screen pinch-zoom
 * Lightbox. `slug` resolves to a bundled 512×512 PNG via the generated IMAGE_MAP;
 * if there's no match (e.g. a model [image:] description rather than a slug) it
 * falls back to a placeholder so the flow still renders.
 */
export function ImageSlot({ desc, slug }: { desc: string; slug?: string }) {
  const [open, setOpen] = useState(false);
  const source = resolveImage(slug ?? desc);

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
    // No solid frame — the illustration should read as part of the bubble, not a pasted-in
    // photo. A faint dashed outline is the only hint, signalling "tap to enlarge".
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // `multiply` drops the illustration's white ground into the bubble colour (the assets are
  // label-free, individually generated illustrations on white), so it feels incorporated.
  thumbImage: { width: '100%', height: '100%', mixBlendMode: 'multiply' },
  thumbIcon: { fontSize: 48 },
});
