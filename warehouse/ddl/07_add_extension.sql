-- Migration for tables created before the release-extension column.
-- New projects get it from 01/02; this is a no-op there. ALTER only touches
-- metadata (no scan), and existing rows read extension as NULL until a
-- backfill re-curates those days. extension is MLB's measured distance in
-- feet from the rubber to the release point; x0/y0/z0 stay at the 50 ft plane.
ALTER TABLE `statcast_analytics.bronze_pitches`
  ADD COLUMN IF NOT EXISTS extension FLOAT64;

ALTER TABLE `statcast_analytics.fct_pitches`
  ADD COLUMN IF NOT EXISTS extension FLOAT64;
