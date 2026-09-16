/**
 * "Update available!" — a notification bar ABOVE the whole UI, mounted once in
 * app/_layout.tsx over the navigator (Luis, 2026-09-16: surfaced app-wide, dismissible,
 * and a dismissal stays dismissed for a week — see SNOOZE_MS in store/updateStore.ts).
 *
 * This replaces the feed-slot ribbon (CardFeedScreen) as the ONE passive surface for
 * the update; the active path is Settings → "Check for updates" (sidebar.tsx). Same
 * store, same lifecycle: shown from 'available' through 'failed'; idle, checking and
 * snoozed render nothing. The ✕ is withheld while downloading (the bar IS the progress
 * surface) and when the release is forced (below minSupportedVersionCode).
 *
 * Same ink/gold ribbon language as the retired feed slot — moved, not redesigned. No
 * entrance animation, deliberately: reduced-motion-neutral, and a bar that pushes the
 * layout down (it is the first child of the root column) never covers content.
 */
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiStrings } from '../config/strings';
import { useEngineStore } from '../store/engineStore';
import { describeUpdate, useUpdateStore } from '../store/updateStore';
import { card, cardAlpha, fonts } from '../theme';

export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const language = useEngineStore((s) => s.language);
  const status = useUpdateStore((s) => s.status);
  const manifest = useUpdateStore((s) => s.manifest);
  const pct = useUpdateStore((s) => s.pct);
  const forced = useUpdateStore((s) => s.forced);

  const onAction = useCallback(() => {
    const u = useUpdateStore.getState();
    if (u.status === 'available') void u.startDownload();
    else if (u.status === 'ready') void u.install();
    else if (u.status === 'failed') void u.retry();
  }, []);
  const onSnooze = useCallback(() => void useUpdateStore.getState().snooze(), []);

  const visible =
    !!manifest &&
    (status === 'available' || status === 'downloading' || status === 'ready' || status === 'failed');
  if (!visible || !manifest) return null;

  const t = uiStrings(language);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 5 }]} accessibilityLiveRegion="polite">
      <Text style={styles.label} numberOfLines={1}>
        {t.cards.update.label}
      </Text>
      <Text style={styles.body} numberOfLines={1}>
        {describeUpdate(manifest)}
      </Text>
      {status === 'downloading' ? (
        <View style={styles.chip} accessibilityRole="progressbar">
          <Text style={styles.chipText}>{pct}%</Text>
        </View>
      ) : (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.chip, styles.chipTap, pressed && styles.chipPressed]}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {status === 'ready'
              ? t.cards.update.install
              : status === 'failed'
                ? t.cards.update.retry
                : t.cards.update.download}
          </Text>
        </Pressable>
      )}
      {!forced && status !== 'downloading' ? (
        <Pressable
          onPress={onSnooze}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.cards.update.snooze}
          style={styles.dismiss}
        >
          <Text style={styles.dismissGlyph}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The feed ribbon's ink bar, promoted to an edge-to-edge system bar: same contrast
  // reasoning (gold on ink = 5.25:1; on graphite it fell under AA), no radius/margins
  // because it now owns the screen edge, and the status-bar inset is padded inside it
  // so the ink runs behind the clock.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 7,
    backgroundColor: card.ink,
  },
  label: {
    fontFamily: fonts.gothic,
    fontSize: 8.5,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: card.gold,
  },
  body: {
    flex: 1,
    fontFamily: fonts.cardBody,
    fontSize: 13,
    color: card.stock,
  },
  chip: {
    height: 20,
    minWidth: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: cardAlpha(card.stock, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipTap: {
    borderColor: card.gold,
  },
  chipPressed: {
    backgroundColor: cardAlpha(card.gold, 0.18),
  },
  chipText: {
    fontFamily: fonts.gothic,
    fontSize: 8.5,
    letterSpacing: 1.2,
    lineHeight: 12,
    textTransform: 'uppercase',
    color: card.stock,
  },
  dismiss: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: cardAlpha(card.stock, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissGlyph: {
    fontFamily: fonts.gothic,
    fontSize: 10,
    color: card.stock,
  },
});
