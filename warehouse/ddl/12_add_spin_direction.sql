-- Migration for tables created before the spin-direction column. New projects get
-- it from 01/02; this is a no-op there. ALTER only touches metadata (no scan), and
-- existing rows read the new column as NULL until a backfill re-curates those days.
-- spin_direction is MLB pitchData.breaks.spinDirection: the direction the spin
-- axis points, in degrees, stored verbatim. It is 100% present on tracked pitches.
-- It is deliberately NOT interpreted here: its relation to the induced break is not
-- a fixed offset (over eight games and 2,382 pitches the gap has a median of -99.8
-- degrees and only 35% of pitches fall within 10 of 180).
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS spin_direction FLOAT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS spin_direction FLOAT64;
