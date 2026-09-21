-- Train the xWhiff model (TDD §3.4). BOOSTED_TREE_CLASSIFIER runs inside
-- BigQuery quota; on swings only (whiff undefined on takes).
CREATE OR REPLACE MODEL `statcast_analytics.model_pitch_whiff`
OPTIONS (
  model_type = 'BOOSTED_TREE_CLASSIFIER',
  input_label_cols = ['is_whiff'],
  max_iterations = 40,
  learn_rate = 0.1,
  early_stop = TRUE,
  subsample = 0.8
) AS
SELECT
  pitch_type,
  release_speed,
  release_spin_rate,
  vx0, vy0, vz0,
  ax, ay, az,
  plate_x, plate_z,
  is_whiff
FROM `statcast_analytics.fct_pitches`
-- Fixed start, not a rolling window: the loaded seasons begin in 2024, and a
-- relative window (CURRENT_DATE - 1 year) would exclude them. Still prunes by partition.
WHERE game_date >= '2024-01-01'
  AND is_swing = 1;
