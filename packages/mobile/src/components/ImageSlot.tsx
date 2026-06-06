import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

/**
 * Rendered wherever the tutor emits an `[image: <description>]` control token. Shows
 * a framed placeholder REGARDLESS of whether a matching image binary is bundled yet
 * — so the end-to-end image handler (model emits tag → app shows a picture slot) can
 * be tested before the image library is bundled in the APK.
 *
 * When the image library ships, resolve `desc` → a bundled asset here and render a
 * real <Image> (fall back to this placeholder when there's no match).
 */
export function ImageSlot({ desc }: { desc: string }) {
  return (
    <View style={styles.frame} accessibilityLabel={`Larawan: ${desc}`}>
      <Text style={styles.icon}>🖼️</Text>
      <Text style={styles.caption} numberOfLines={3}>
        {desc}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: 10,
    width: 200,
    minHeight: 140,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  icon: {
    fontSize: 44,
    marginBottom: 8,
  },
  caption: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.inkMuted,
    textAlign: 'center',
  },
});
