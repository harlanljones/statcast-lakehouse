-- Load bronze -> curated fact for one day. Run after each ingestion job.
-- A MERGE (not UPDATE) makes reruns idempotent.
MERGE `statcast_analytics.fct_pitches` f
USING (
  SELECT
    pitch_id, game_id, game_date, pitcher_id, batter_id, pitch_type,
    release_speed, release_spin_rate,
    x0, y0, z0, vx0, vy0, vz0, ax, ay, az,
    plate_x, plate_z, sz_top, sz_bot, is_swing, is_whiff,
    -- TDD §3.3 spatial index; GIS on the ingest transform, not at query time.
    ST_GEOGPOINT(plate_x, plate_z) AS plate_location
  FROM `statcast_analytics.bronze_pitches`
  WHERE DATE(ingestion_time) = @target_date
    AND pitch_id IS NOT NULL
) b
ON f.pitch_id = b.pitch_id
WHEN NOT MATCHED THEN
  INSERT ROW
