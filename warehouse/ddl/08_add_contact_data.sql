-- Migration for tables created before the batted-ball contact columns.
-- New projects get them from 01/02; this is a no-op there. ALTER only touches
-- metadata (no scan), and existing rows read the new columns as NULL until a
-- backfill re-curates those days. launch_speed/launch_angle/hit_distance are
-- MLB's measured exit velocity (mph), launch angle (degrees) and projected
-- distance (feet); bb_type is the batted-ball class (fly_ball, line_drive,
-- ground_ball, popup). hc_x/hc_y are Savant's hit-chart coordinates (a 250x250
-- image space with home plate near (125, 205)). All six are NULL unless the
-- pitch was put in play.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS launch_speed FLOAT64,
  ADD COLUMN IF NOT EXISTS launch_angle FLOAT64,
  ADD COLUMN IF NOT EXISTS hit_distance FLOAT64,
  ADD COLUMN IF NOT EXISTS bb_type STRING,
  ADD COLUMN IF NOT EXISTS hc_x FLOAT64,
  ADD COLUMN IF NOT EXISTS hc_y FLOAT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS launch_speed FLOAT64,
  ADD COLUMN IF NOT EXISTS launch_angle FLOAT64,
  ADD COLUMN IF NOT EXISTS hit_distance FLOAT64,
  ADD COLUMN IF NOT EXISTS bb_type STRING,
  ADD COLUMN IF NOT EXISTS hc_x FLOAT64,
  ADD COLUMN IF NOT EXISTS hc_y FLOAT64;
