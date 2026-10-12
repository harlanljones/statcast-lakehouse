-- Migration for tables created before the pitch-result column. New projects get
-- it from 01/02; this is a no-op there. ALTER only touches metadata (no scan),
-- and existing rows read the new column as NULL until a backfill re-curates
-- those days. pitch_result is the pitch's outcome as one canonical code from
-- Savant's vocabulary (mlb_client.PITCH_RESULTS); the game feed's prose
-- descriptions are mapped into it. It cannot be recovered from is_swing/is_whiff:
-- a called strike and a ball both carry (0, 0), which is about half the corpus.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS pitch_result STRING;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS pitch_result STRING;
