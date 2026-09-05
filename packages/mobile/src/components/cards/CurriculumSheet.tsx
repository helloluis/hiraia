/**
 * The CALENDAR — the MATATAG outline for the reader's grade, as a sheet over the deck.
 *
 * Opened from the cycling die/calendar button; lists every TOPIC of the grade that has at
 * least one card in the pool, in DepEd's own order, quarter by quarter (the outline is
 * `curriculumOutline` in data/cards.ts — the generated CG order filtered by card presence). A
 * topic is a Content-column title of the CG ("Mga Uri ng Lupa", "Ang Siklo ng Tubig"): the
 * 3-6-word heading a child recognises from class. The competency sentences under it are the
 * data model, never the copy. Tapping a row enters calendar mode at that topic
 * (cardStore.enterCurriculum): the feed then serves the topic's cards — the union of its
 * competencies' sets — until they run out and walks on to the next row.
 *
 * Printed in the deck's own language: a sheet of cream stock with an ink edge over the
 * darkened board, ink type, olive small caps for the quarter headings, and the gold marker
 * — the deck's "continue" colour — on the row currently held. No emoji, no glyph icons:
 * the close affordance is the same ✕-in-a-ring the ribbons use.
 *
 * Titles follow the tutor language (tl / bis renderings reviewed against DepEd classroom
 * usage; English is the CG's own wording and the fallback). Everything else on the sheet —
 * eyebrow, hint, quarter headings, domain names, a11y labels — is uiStrings.
 *
 * SEAM — sub-topic PILLS (follow-up, once the category backfill completes): each row will
 * grow a wrap of small pills under its title, one per `topicShelves(topic, language)` entry
 * (data/cards.ts), and a pill tap will call `onPick(topic.key, shelf.cat)`. Nothing renders
 * yet; see `PILLS_SLOT` below for where they mount.
 */
import { memo, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOMAIN_NAMES, GRADE_DOMAIN_MAP, type GradeLevel, type Language, type Quarter } from '@hiraia/shared';

import { GRADE_WORD } from '../../config/grades';
import { uiStrings } from '../../config/strings';
import { cardsForTopic, curriculumOutline, topicTitle, type OutlineTopic } from '../../data/cards';
import { useCardStore } from '../../store/cardStore';
import { card, cardAlpha, fonts } from '../../theme';
import { CARD_EDGE, CARD_RADIUS } from './CardFrame';

/** How much of the screen the sheet may take; the board stays visible above it. */
const SHEET_MAX_HEIGHT = 0.82;

/**
 * Where a row's sub-topic pills mount when they land (see the header note). Kept as an
 * explicit, empty slot rather than nothing at all so the follow-up is a one-place change and
 * the row's layout (title + chip on one line, pills wrapping beneath) is already decided.
 */
const PILLS_SLOT = null;

interface RowView {
  topic: OutlineTopic;
  title: string;
  unseen: number;
  total: number;
}

interface QuarterGroup {
  quarter: Quarter;
  rows: RowView[];
}

/**
 * The grade's outline, grouped by quarter, with each row's unseen/total count against the
 * session's seen set. Cheap (a Set lookup per card of the grade, ~15k) and only computed while
 * the sheet is visible — the memo keys on `visible` so a hidden sheet does no work per turn.
 */
function groupOutline(grade: GradeLevel, language: Language, seen: ReadonlySet<string>): QuarterGroup[] {
  const groups: QuarterGroup[] = [];
  for (const topic of curriculumOutline(grade)) {
    const ids = cardsForTopic(topic);
    let unseen = 0;
    for (const id of ids) if (!seen.has(id)) unseen += 1;
    const view: RowView = { topic, title: topicTitle(topic, language), unseen, total: ids.size };
    const last = groups[groups.length - 1];
    if (last && last.quarter === topic.quarter) last.rows.push(view);
    else groups.push({ quarter: topic.quarter, rows: [view] });
  }
  return groups;
}

export const CurriculumSheet = memo(function CurriculumSheet({
  visible,
  grade,
  language,
  activeKey,
  onPick,
  onClose,
}: {
  visible: boolean;
  grade: GradeLevel;
  language: Language;
  /** The topic currently held (calendar mode), by OutlineTopic.key, marked in gold; null when not in the mode. */
  activeKey: string | null;
  /** A row tap: enter the topic by key. (Pills will add an optional second argument, the shelf's `cat`.) */
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  // The session seen set, for the count chips. Replaced by the store on every turn, so the
  // memo below refreshes each time the sheet is opened onto a new page.
  const seen = useCardStore((s) => s.seen);
  const groups = useMemo(
    () => (visible ? groupOutline(grade, language, seen) : []),
    [visible, grade, language, seen]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Hardware back / Esc: the same close as the backdrop and the ✕.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* the board, darkened: tapping it closes the sheet */}
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.cards.closeCurriculum} />
        <View
          style={[
            styles.sheet,
            { maxHeight: `${Math.round(SHEET_MAX_HEIGHT * 100)}%`, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.eyebrow} numberOfLines={1}>
                {t.cards.curriculum}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                {GRADE_WORD[language]} {grade}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.cards.closeCurriculum}
              style={styles.close}
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.hint} numberOfLines={2}>
            {t.cards.curriculumHint}
          </Text>
          <View style={styles.rule} />

          {groups.length === 0 ? (
            <Text style={styles.empty}>{t.cards.curriculumEmpty}</Text>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
              {groups.map((g) => (
                <View key={g.quarter}>
                  <View style={styles.quarter}>
                    <View style={styles.quarterDiamond} />
                    <Text style={styles.quarterText} numberOfLines={1}>
                      {t.cards.quarters[g.quarter - 1]} · {DOMAIN_NAMES[GRADE_DOMAIN_MAP[grade][g.quarter]][language]}
                    </Text>
                  </View>
                  {g.rows.map((row) => {
                    const active = row.topic.key === activeKey;
                    return (
                      <Pressable
                        key={row.topic.key}
                        onPress={() => onPick(row.topic.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.rowPressed]}
                      >
                        <View style={[styles.marker, active && styles.markerActive]} />
                        <View style={styles.rowBody}>
                          <View style={styles.rowLine}>
                            <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={2}>
                              {row.title}
                            </Text>
                            <View style={[styles.chip, active && styles.chipActive]}>
                              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                                {row.unseen} / {row.total}
                              </Text>
                            </View>
                          </View>
                          {/* sub-topic pills mount here (follow-up) — see PILLS_SLOT */}
                          {PILLS_SLOT}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    // the board, dimmed — ink at 62% keeps the deck legible underneath yet clearly behind
    backgroundColor: cardAlpha(card.ink, 0.62),
  },
  sheet: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    paddingTop: 14,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitles: { flex: 1 },
  eyebrow: {
    fontFamily: fonts.gothic,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: card.olive,
  },
  title: { fontFamily: fonts.slab, fontSize: 20, color: card.ink, marginTop: 2 },
  // the same ✕-in-a-ring the ribbons use, in ink on stock
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: cardAlpha(card.ink, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontFamily: fonts.gothic, fontSize: 12, lineHeight: 14, color: card.ink },
  hint: { fontFamily: fonts.cardBody, fontSize: 13, lineHeight: 17, color: card.olive, marginTop: 6 },
  rule: { height: 1, backgroundColor: card.sage, marginTop: 10 },
  empty: {
    fontFamily: fonts.cardBody,
    fontSize: 15,
    color: card.olive,
    textAlign: 'center',
    paddingVertical: 28,
  },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingBottom: 6 },
  quarter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  quarterDiamond: {
    width: 7,
    height: 7,
    borderRadius: 1,
    backgroundColor: card.gold,
    transform: [{ rotate: '45deg' }],
  },
  quarterText: {
    flex: 1,
    fontFamily: fonts.gothic,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: card.olive,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingRight: 2,
    borderBottomWidth: 1,
    borderBottomColor: cardAlpha(card.sage, 0.45),
  },
  rowActive: { backgroundColor: cardAlpha(card.gold, 0.14) },
  rowPressed: { opacity: 0.6 },
  // the gold marker: a 4dp bar in the gutter, transparent until the row is the held topic
  marker: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'transparent' },
  markerActive: { backgroundColor: card.gold },
  // title + chip on one line; the pills (when they land) wrap beneath inside rowBody
  rowBody: { flex: 1 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // a DepEd title is a heading, not a sentence: one size up from the old competency text
  rowText: { flex: 1, fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 19, color: card.ink },
  rowTextActive: { fontFamily: fonts.cardBodyBold },
  chip: {
    minWidth: 52,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: cardAlpha(card.olive, 0.5),
    alignItems: 'center',
  },
  chipActive: { backgroundColor: card.gold, borderColor: card.gold },
  chipText: { fontFamily: fonts.gothic, fontSize: 9, letterSpacing: 0.6, color: card.olive },
  chipTextActive: { color: card.ink },
});
