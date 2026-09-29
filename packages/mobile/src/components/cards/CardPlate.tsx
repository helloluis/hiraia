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
import { useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { type ArtSource } from '../../data/artSource';
import { card } from '../../theme';
import { Lightbox } from '../Lightbox';

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

  // A native button yields to the native feed scroll and supports keyboard, mouse,
  // switch access and screen-reader activation as well as a touch tap.
  const [focused, setFocused] = useState(false);

  return (
    <Animated.View style={[plateStyles.mat, style]}>
        <Pressable
          style={[styles.window, focused && { outlineColor: card.ink, outlineWidth: 3 }]}
          onPress={() => setZoom(true)} disabled={!enabled} focusable={enabled}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          accessible
          accessibilityRole="imagebutton"
          accessibilityLabel={label}
        >
          <Image source={source} style={styles.art} resizeMode="contain" />
        </Pressable>
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
