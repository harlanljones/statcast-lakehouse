-- Migration for tables created before the batted-ball contact columns.
-- New projects get them from 01/02; this is a no-op there. ALTER only touches
-- metadata (no scan), and existing rows read the new columns as NULL until a
-- backfill re-curates those days. launch_speed/launch_angle/hit_distance are
-- MLB's measured exit velocity (mph), launch angle (degrees) and projected
-- distance (feet); bb_type is the batted-ball class (fly_ball, line_drive,
-- ground_ball, popup). All four are NULL unless the pitch was put in play.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS launch_speed FLOAT64,
  ADD COLUMN IF NOT EXISTS launch_angle FLOAT64,
  ADD COLUMN IF NOT EXISTS hit_distance FLOAT64,
  ADD COLUMN IF NOT EXISTS bb_type STRING;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS launch_speed FLOAT64,
  ADD COLUMN IF NOT EXISTS launch_angle FLOAT64,
  ADD COLUMN IF NOT EXISTS hit_distance FLOAT64,
  ADD COLUMN IF NOT EXISTS bb_type STRING;
