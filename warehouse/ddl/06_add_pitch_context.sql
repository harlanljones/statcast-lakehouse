-- Migration for tables created before the plate-appearance context columns.
-- New projects get them from 01/02; this is a no-op there. ALTER only
-- touches metadata (no scan), and existing rows read the new columns as NULL
-- until a backfill re-curates those days.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS stand STRING,
  ADD COLUMN IF NOT EXISTS p_throws STRING,
  ADD COLUMN IF NOT EXISTS balls INT64,
  ADD COLUMN IF NOT EXISTS strikes INT64,
  ADD COLUMN IF NOT EXISTS at_bat_number INT64,
  ADD COLUMN IF NOT EXISTS pitch_number INT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS stand STRING,
  ADD COLUMN IF NOT EXISTS p_throws STRING,
  ADD COLUMN IF NOT EXISTS balls INT64,
  ADD COLUMN IF NOT EXISTS strikes INT64,
  ADD COLUMN IF NOT EXISTS at_bat_number INT64,
  ADD COLUMN IF NOT EXISTS pitch_number INT64;
