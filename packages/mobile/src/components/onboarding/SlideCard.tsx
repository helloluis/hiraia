import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { card, cardAlpha } from '../../theme';
import { CARD_EDGE, CARD_RADIUS } from '../cards/CardFrame';

export function SlideCard({
  children,
  backgroundColor = card.stock,
}: {
  children: ReactNode;
  backgroundColor?: string;
}) {
  return (
    <View style={styles.deck}>
      <View style={styles.cardLedge} pointerEvents="none" />
      <View style={[styles.cardLayer, { backgroundColor }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1, width: '100%', maxWidth: 672, alignSelf: 'center',
    paddingHorizontal: 16, marginTop: 2, marginBottom: 14 },
  cardLedge: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    bottom: -4,
    borderRadius: CARD_RADIUS + 1,
    backgroundColor: cardAlpha(card.ink, 0.55), // ink at 55% — the printed drop under a card
  },
  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    left: 16,
    right: 16,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    overflow: 'hidden', // slide content is clipped to the card's rounded corners
  },
});
