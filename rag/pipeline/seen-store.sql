-- Feed "seen" store: a weight-reduction memory, not a blocklist. Persistent across restarts.
-- Lives in the existing expo-sqlite db (packages/mobile/src/db/index.ts) beside settings/notes.
CREATE TABLE IF NOT EXISTS card_seen (
  card_id    TEXT PRIMARY KEY,           -- ffct-NNNNN
  first_seen INTEGER NOT NULL,           -- epoch ms
  last_seen  INTEGER NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS topic_seen (
  topic      TEXT PRIMARY KEY,           -- card.topic (normalised)
  last_seen  INTEGER NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1
);
-- Read-time weight (computed in TS, documented here):
--   w = base(card)
--       * curriculum_boost(competency, grade, quarter_now)   -- heaviest lever
--       * seen_decay(times, last_seen)                        -- e.g. 0.5^times, recovering with age
--   seen never reaches 0: a card seen 5x is unlikely, not impossible.
