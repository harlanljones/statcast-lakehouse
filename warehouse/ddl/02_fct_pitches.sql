-- Curated fact table per TDD §3.1. Partitioned by game_date, clustered by
-- pitcher/batter/pitch_type; require_partition_filter keeps every query
-- within the 1 TB/month free-tier scan allowance.
CREATE TABLE IF NOT EXISTS `statcast_analytics.fct_pitches` (
  pitch_id STRING NOT NULL,
  game_id INT64 NOT NULL,
  game_date DATE NOT NULL,
  pitcher_id INT64 NOT NULL,
  batter_id INT64 NOT NULL,
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
  plate_location GEOGRAPHY
)
PARTITION BY game_date
CLUSTER BY pitcher_id, batter_id, pitch_type
OPTIONS (
  require_partition_filter = TRUE,
  partition_expiration_days = 1095,
  description = "Curated Statcast pitch event store with spatial strike zone mapping"
);
