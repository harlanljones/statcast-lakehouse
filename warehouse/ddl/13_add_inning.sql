-- Migration for tables created before the inning column. New projects get it from
-- 01/02; this is a no-op there. ALTER only touches metadata (no scan), and existing
-- rows read the new column as NULL until a backfill re-curates those days. inning is
-- the inning the play belongs to, 1-based with extras included. It is 100% present
-- in the feed and cannot be derived from the stored count fields. Only the integer is
-- carried: the feed spells the half "top"/"bottom" and Savant's CSV "Top"/"Bot", so a
-- half column would need canonicalising before it could be consumed.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS inning INT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS inning INT64;
