import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

import { colors, notebook } from '../theme';

/**
 * Lined notebook-paper backdrop, mirroring the web `.notebook-paper` style:
 * cream fill, blue horizontal rules every 32px, and a pink vertical margin rule.
 * Drawn with plain Views (no react-native-svg) to avoid a native dependency.
 *
 * Render as the first child of a flex:1 container with the content layered on top.
 */
export function NotebookBackground() {
  const lines = useMemo(() => {
    // Cover the tallest plausible viewport; extra height is clipped by the parent.
    const height = Dimensions.get('window').height * 1.5;
    const count = Math.ceil(height / notebook.lineSpacing);
    return Array.from({ length: count }, (_, i) => (i + 1) * notebook.lineSpacing);
  }, []);

  return (
    <View style={styles.fill} pointerEvents="none">
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
