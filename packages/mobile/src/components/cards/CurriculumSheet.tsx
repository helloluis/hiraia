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
 * Subcategory pills use the intersection of taxonomy labels and this topic’s cards.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOMAIN_NAMES, GRADE_DOMAIN_MAP, type GradeLevel, type Language, type Quarter } from '@hiraia/shared';

import { GRADE_WORD } from '../../config/grades';
import { uiStrings } from '../../config/strings';
import {
  TOPIC_MIN_CARDS,
  cardsForTopic,
  curriculumOutline,
  topicShelves,
  topicTitle,
  type OutlineTopic,
  type TopicShelf,
} from '../../data/cards';
import { useCardStore } from '../../store/cardStore';
import { awardStars, type TopicAward } from '../../reviews/logic';
import { useReviewStore } from '../../reviews/store';
import { card, cardAlpha, fonts } from '../../theme';
import { CARD_EDGE, CARD_RADIUS } from './CardFrame';

/** How much of the screen the sheet may take; the board stays visible above it. */
const SHEET_MAX_HEIGHT = 0.82;

interface RowView {
  topic: OutlineTopic;
  title: string;
  unseen: number;
  total: number;
  stars: number;
  shelves: TopicShelf[];
}

interface QuarterGroup {
  quarter: Quarter;
  rows: RowView[];
}

/** The flat, virtualizable form of the outline: headings and rows in one list. */
type SheetItem = { kind: 'quarter'; quarter: Quarter } | { kind: 'row'; row: RowView };

/**
 * The grade's outline, grouped by quarter, with each row's unseen/total count against the
 * session's seen set. Cheap (a Set lookup per card of the grade, ~15k) and only computed while
 * the sheet is visible — the memo keys on `visible` so a hidden sheet does no work per turn.
 */
function groupOutline(
  grade: GradeLevel,
  language: Language,
  seen: ReadonlySet<string>,
  awards: Readonly<Record<string, TopicAward>>
): QuarterGroup[] {
  const groups: QuarterGroup[] = [];
  for (const topic of curriculumOutline(grade)) {
    const ids = cardsForTopic(topic);
    let unseen = 0;
    for (const id of ids) if (!seen.has(id)) unseen += 1;
    const view: RowView = {
      topic,
      title: topicTitle(topic, language),
      unseen,
      total: ids.size,
      stars: awardStars(awards[topic.key]),
      // A shelf below the floor is the same broken promise TOPIC_MIN_CARDS already rejects one
      // level up ("hide if there are less than 3"), and tapping one builds a lesson run of a
      // single card. Filtered HERE, at the presentation layer, never inside `topicShelves`:
      // `curriculumCursor` re-derives shelves by id to restore a persisted run, so hiding one
      // there would turn an already-saved run into a dead tap. Cuts G5 from 673 pills to 299
      // (G3: 1008 -> 448) with nothing made unreachable — those cards still come from the row.
      shelves: topicShelves(topic, language).filter((sh) => sh.ids.size >= TOPIC_MIN_CARDS),
    };
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
  /** Enter the whole topic or a selected subcategory. */
  onPick: (key: string, shelfCat?: string) => void;
  onClose: () => void;
}) {
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  // The session seen set, for the count chips. Replaced by the store on every turn, so the
  // memo below refreshes each time the sheet is opened onto a new page.
  const seen = useCardStore((s) => s.seen);
  const activeCat = useCardStore((s) => s.curriculum?.lessonRun?.shelfCat);
  const awards = useReviewStore((s) =>
    s.data?.grade === grade ? s.data.awards : EMPTY_AWARDS
  );
  /**
   * The rows, built one frame AFTER the sheet is asked for — `null` while pending.
   *
   * Built in the render pass this used to be, `groupOutline` plus the whole row tree landed in
   * the same commit that mounts the Modal, so nothing at all appeared on screen until every
   * row and pill had been reconciled, laid out and measured. Deferring lets the sheet's own
   * chrome — backdrop, header, hint, rule — paint immediately, which is the acknowledgement
   * the tap was missing.
   *
   * `requestAnimationFrame`, not `InteractionManager`: the cycling button's face crossfade
   * runs without `isInteraction: false`, so it holds an interaction handle for 250 ms and
   * would make the fill arrive at an unpredictable time.
   *
   * `null` is NOT `[]` and the distinction is load-bearing — see the render below.
   */
  const [groups, setGroups] = useState<QuarterGroup[] | null>(null);
  useEffect(() => {
    if (!visible) {
      setGroups(null);
      return;
    }
    const id = requestAnimationFrame(() => setGroups(groupOutline(grade, language, seen, awards)));
    return () => cancelAnimationFrame(id);
    // `seen` and `awards` stay in here: the chips and the stars must keep tracking the store
    // while the sheet is open, or grading a topic under it leaves stale counts on screen.
  }, [visible, grade, language, seen, awards]);

  /**
   * Quarter headings and topic rows in one flat list, so the FlatList below virtualizes over
   * ROWS. Virtualizing over the quarter groups instead would be pure overhead: there are
   * exactly four of them, so any sane window renders all four and mounts every row anyway.
   */
  const items = useMemo<SheetItem[]>(
    () =>
      (groups ?? []).flatMap((g) => [
        { kind: 'quarter' as const, quarter: g.quarter },
        ...g.rows.map((row) => ({ kind: 'row' as const, row })),
      ]),
    [groups]
  );

  const renderItem = useCallback(
    ({ item }: { item: SheetItem }) =>
      item.kind === 'quarter' ? (
        <QuarterHeading label={`${t.cards.quarters[item.quarter - 1]} \u00b7 ${DOMAIN_NAMES[GRADE_DOMAIN_MAP[grade][item.quarter]][language]}`} />
      ) : (
        <Row
          row={item.row}
          active={item.row.topic.key === activeKey}
          activeCat={activeCat}
          onPick={onPick}
        />
      ),
    [t, grade, language, activeKey, activeCat, onPick]
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
            // Hold the final height while the rows are still being built, so the sheet opens
            // at its real size instead of popping up as a header-sized stub and then jumping.
            // Safe to assume it is the max: every grade's outline is 29-46 rows, which
            // overflows 82% of any phone screen many times over.
            groups === null && { minHeight: `${Math.round(SHEET_MAX_HEIGHT * 100)}%` },
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

          {/* `null` = not built yet; `[]` = this grade genuinely has no cards. Collapsing the
              two would print "Wala pang kard para sa baitang na ito" for one frame on every
              open — telling a child something false, then contradicting it. */}
          {groups === null ? null : groups.length === 0 ? (
            <Text style={styles.empty}>{t.cards.curriculumEmpty}</Text>
          ) : (
            <FlatList
              style={styles.scroll}
              contentContainerStyle={styles.scrollBody}
              data={items}
              keyExtractor={keyOfItem}
              renderItem={renderItem}
              initialNumToRender={5}
              windowSize={5}
            />
          )}
        </View>
      </View>
    </Modal>
  );
});

/** One quarter's heading band — an olive small-caps rule with the gold diamond. */
const QuarterHeading = memo(function QuarterHeading({ label }: { label: string }) {
  return (
    <View style={styles.quarter}>
      <View style={styles.quarterDiamond} />
      <Text style={styles.quarterText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

/**
 * One topic row: the DepEd title, its star award, an unseen/total chip, and the subcategory
 * pills beneath. Its own memoized component so the FlatList can recycle rows without
 * re-rendering the ones that did not change.
 */
const Row = memo(function Row({
  row,
  active,
  activeCat,
  onPick,
}: {
  row: RowView;
  active: boolean;
  activeCat: string | undefined;
  onPick: (key: string, shelfCat?: string) => void;
}) {
  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <View style={[styles.marker, active && styles.markerActive]} />
      <View style={styles.rowBody}>
        <Pressable
          onPress={() => onPick(row.topic.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={({ pressed }) => [styles.rowLine, pressed && styles.rowPressed]}
        >
          <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={2}>
            {row.title}
          </Text>
          {row.stars > 0 ? (
            <Text
              style={styles.stars}
              accessibilityLabel={`${row.stars} ${row.stars === 1 ? 'star' : 'stars'}`}
            >
              {'\u2605'.repeat(row.stars)}
            </Text>
          ) : null}
          <View style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {row.unseen} / {row.total}
            </Text>
          </View>
        </Pressable>
        <View style={styles.pills}>
          {row.shelves.map((shelf) => (
            <Pressable
              key={shelf.cat}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}: ${shelf.label}`}
              accessibilityState={{ selected: active && shelf.cat === activeCat }}
              onPress={() => onPick(row.topic.key, shelf.cat)}
              style={({ pressed }) => [
                styles.pill,
                active && shelf.cat === activeCat && styles.chipActive,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.pillText}>{shelf.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
});

const keyOfItem = (it: SheetItem) => (it.kind === 'quarter' ? `q${it.quarter}` : it.row.topic.key);

const EMPTY_AWARDS: Readonly<Record<string, TopicAward>> = {};

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
  // flexShrink lets the virtualized list derive a viewport from onLayout inside the
  // sheet's `maxHeight` box; without it a VirtualizedList here collapses or overruns.
  scroll: { flexGrow: 0, flexShrink: 1 },
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
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1, borderColor: card.sage, backgroundColor: cardAlpha(card.sage, 0.18) },
  pillText: { fontFamily: fonts.cardBody, fontSize: 12, color: card.ink },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // a DepEd title is a heading, not a sentence: one size up from the old competency text
  rowText: { flex: 1, fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 19, color: card.ink },
  rowTextActive: { fontFamily: fonts.cardBodyBold },
  stars: { fontFamily: fonts.gothic, fontSize: 11, letterSpacing: 1, color: card.gold },
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
