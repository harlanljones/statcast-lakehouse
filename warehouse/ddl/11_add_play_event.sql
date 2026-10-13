-- Migration for tables created before the plate-appearance outcome column. New
-- projects get it from 01/02; this is a no-op there. ALTER only touches metadata
-- (no scan), and existing rows read the new column as NULL until a backfill
-- re-curates those days. play_event is the outcome of the plate appearance the
-- pitch belongs to ("Strikeout", "Single", "Home Run", ...), repeated on every
-- pitch of that appearance exactly as Savant's CSV does. Distinct from
-- pitch_result, which is what the pitch itself did.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS play_event STRING;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS play_event STRING;
