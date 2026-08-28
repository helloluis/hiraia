-- Feed "seen" store: a weight-reduction memory, not a blocklist. Persistent across restarts.
-- Lives in the existing expo-sqlite db (packages/mobile/src/db/index.ts) beside settings/notes.
CREATE TABLE IF NOT EXISTS card_seen (
  card_id    TEXT PRIMARY KEY,           -- ffct-NNNNN
  first_seen INTEGER NOT NULL,           -- epoch ms
  last_seen  INTEGER NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1
);
-- NOT card.topic: that field is a per-card slug (15,739 distinct values in 16,948 cards, 67% are
-- sentences like "owls turn their heads far around"), so decaying it would decay nothing. The
-- competency code (G5-M-2) is the real topic axis: ~144 elementary + JHS codes.
CREATE TABLE IF NOT EXISTS competency_seen (
  competency TEXT PRIMARY KEY,           -- curriculum tag code, e.g. G5-M-2 ('off' rows are bookkeeping only: untagged cards never decay as a group)
  last_seen  INTEGER NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1
);
-- Read-time weight (computed in TS, documented here):
--   w = base(card)
--       * curriculum_boost(competency, grade, quarter_now)   -- heaviest lever
--       * seen_decay(times, last_seen)                        -- e.g. 0.5^times, recovering with age
--   seen never reaches 0: a card seen 5x is unlikely, not impossible.
