-- Raw Statcast staging. Partitioned by ingestion time so reprocessing a
-- single day never scans other days (free-tier scan budget protection).
CREATE TABLE IF NOT EXISTS `statcast_analytics.bronze_pitches` (
  pitch_id STRING,
  game_id INT64,
  game_date DATE,
  pitcher_id INT64,
  batter_id INT64,
  pitch_type STRING,
  release_speed FLOAT64,
  release_spin_rate FLOAT64,
  x0 FLOAT64,
  y0 FLOAT64,
  z0 FLOAT64,
  vx0 FLOAT64,
  vy0 FLOAT64,
  vz0 FLOAT64,
  ax FLOAT64,
  ay FLOAT64,
  az FLOAT64,
  plate_x FLOAT64,
  plate_z FLOAT64,
  sz_top FLOAT64,
  sz_bot FLOAT64,
  is_swing INT64,
  is_whiff INT64,
  ingestion_time TIMESTAMP,
  raw JSON
)
PARTITION BY DATE(ingestion_time)
OPTIONS (
  require_partition_filter = TRUE,
  partition_expiration_days = 1095,
  description = "Raw Statcast staging, partitioned by ingestion time"
);
