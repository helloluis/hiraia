import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

import { colors, notebook } from '../theme';

/**
 * Lined notebook-paper backdrop, mirroring the web `.notebook-paper` style:
 * cream fill, blue horizontal rules every 32px, and a pink vertical margin rule.
 * Drawn with plain Views (no react-native-svg) to avoid a native dependency.
 *
 * Pass `height` to size the lined sheet (ChatThread makes a sheet as tall as the
 * scroll content, then translates it so the paper scrolls WITH the messages). With
 * no height it fills the parent (static backdrop).
 */
export function NotebookBackground({ height }: { height?: number }) {
  const h = height ?? Dimensions.get('window').height * 1.5;
  const lines = useMemo(() => {
    const count = Math.ceil(h / notebook.lineSpacing) + 1;
    return Array.from({ length: count }, (_, i) => i * notebook.lineSpacing);
  }, [h]);

  return (
    <View style={[styles.fill, height != null && { height }]} pointerEvents="none">
      {lines.map((top) => (
        <View key={top} style={[styles.rule, { top }]} />
      ))}
      <View style={styles.margin} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.rule,
  },
  margin: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: notebook.marginX,
    width: 2,
    backgroundColor: colors.margin,
  },
});
