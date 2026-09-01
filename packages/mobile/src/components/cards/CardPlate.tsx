/**
 * THE MATTED ENGRAVING — how this deck prints a picture, in one place.
 *
 * A peach mat with the 3px ink edge, a white inner window, the illustration inside it, and a
 * tap that opens the pinch-zoom Lightbox. It is lifted out of CardPage because a SECOND card
 * now prints one: the generated response card (ResponseCard), whose picture is chosen by
 * retrieval from the grounded fact the card states. The brief for that card is that it should read as a
 * card of the same deck, and the only way to guarantee that is for both to be the same
 * component — a copied set of plate styles would drift on the first restyle and the generated
 * card would quietly become a different kind of object.
 *
 * LOOK — design/mockups/midcentury.html. The art is greyscale line work on an opaque WHITE
 * bed, so it sits on a white plate inside a peach mat; the mat is what makes it read as a
 * mounted print rather than a pasted-in label. (The mockup fills the window with card stock
 * and knocks the white bed out with mix-blend-mode:multiply. RN has no blend modes, so the
 * window is plate white and the art's own bed continues it seamlessly. The alternative — a
 * white-knockout pass over all 18.8k images — is the funded pipeline job, not a restyle.)
 *
 * There is deliberately NO placeholder branch. `source` is already known to be drawable when
 * this renders: both callers resolve through `artSourceFor` and print a picture-less layout
 * when it comes back null. A plate that could show a broken-image glyph would turn "we had no
 * confident picture" — the ordinary outcome on a generated card — into a visible failure.
 */
import { useMemo, useState } from 'react';
import { Animated, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { type ArtSource } from '../../data/artSource';
import { card } from '../../theme';
import { Lightbox } from '../Lightbox';

/**
 * Travel that turns a tap into a drag. Matches the feed pan's own activation slop, so there is
 * no band where the tap has already failed but the pan has not yet started.
 */
const DRAG_SLOP = 10;

export function CardPlate({
  source,
  label,
  enabled = true,
  style,
}: {
  /** The resolved illustration. Never null — the caller prints a different layout for that. */
  source: Exclude<ArtSource, null>;
  /** The card's spoken name: the zoom hint, the screen-reader label, the lightbox caption. */
  label: string;
  /** False while the page is still typing itself in — the zoom arrives with the rest. */
  enabled?: boolean;
  /** Caller's own box for the mat (CardPage animates its opacity in with the other extras). */
  style?: StyleProp<ViewStyle>;
}) {
  const [zoom, setZoom] = useState(false);

  /**
   * Tap-to-zoom as an RNGH gesture rather than a Pressable, because the feed's swipe is an
   * RNGH pan on an ancestor and the plate covers a large share of the card. Mixing RN's
   * responder system with RNGH is where a drag gets swallowed: whichever claims the touch
   * first keeps it. Expressed as a Tap, RNGH arbitrates both in one tree — a Tap fails the
   * moment the finger travels, so any real drag falls through to the page turn.
   */
  const zoomTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(DRAG_SLOP)
        .enabled(enabled)
        .onEnd((_e, ok) => {
          if (ok) runOnJS(setZoom)(true);
        }),
    [enabled]
  );

  return (
    <Animated.View style={[plateStyles.mat, style]}>
      <GestureDetector gesture={zoomTap}>
        <View
          style={styles.window}
          accessible
          accessibilityRole="imagebutton"
          accessibilityLabel={`Larawan: ${label}. I-tap para palakihin.`}
        >
          <Image source={source} style={styles.art} resizeMode="contain" />
        </View>
      </GestureDetector>
      <Lightbox visible={zoom} desc={label} source={source} onClose={() => setZoom(false)} />
    </Animated.View>
  );
}

export const plateStyles = StyleSheet.create({
  /**
   * The mat, exported so a card that has NO picture can print its type in the same box — same
   * size, same place, same peach. That is the whole idea of the poster layout: the reader sees
   * a card of the deck printed differently, not a card whose picture failed to arrive.
   */
  mat: {
    flex: 1,
    minHeight: 136, // the floor the type ramp is tuned never to breach
    marginTop: 10,
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 7,
    padding: 6,
  },
});

const styles = StyleSheet.create({
  window: {
    flex: 1,
    backgroundColor: card.plate,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  art: { width: '100%', height: '100%' },
});
