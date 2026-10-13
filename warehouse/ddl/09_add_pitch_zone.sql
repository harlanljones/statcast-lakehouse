-- Migration for tables created before the pitch-zone column. New projects get
-- it from 01/02; this is a no-op there. ALTER only touches metadata (no scan),
-- and existing rows read the new column as NULL until a backfill re-curates
-- those days. zone is MLB's own zone number for the pitch, taken from the feed
-- rather than derived from the plate coordinates: 1-9 are the nine cells of the
-- strike zone, 11-14 the four cells around it. It is present on every tracked
-- pitch.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS zone INT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS zone INT64;
