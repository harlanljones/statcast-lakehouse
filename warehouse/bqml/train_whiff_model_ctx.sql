-- Challenger xWhiff model with plate-appearance context (count, handedness)
-- and setup-pitch features, after Takamido & Nakamoto (arXiv:2606.17345) and
-- Lee & Ko (arXiv:2609.03810): the previous pitch in the at-bat and where a
-- pitch sits within the pitcher's own pitch type carry signal that
-- single-pitch features miss.
-- The game_date filter sits on the fct scan itself, so partitions still prune.
-- LAG runs over every pitch (takes included) before the outer query keeps
-- swings. Rows curated before 06_add_pitch_context.sql have NULL
-- context and are excluded.
CREATE OR REPLACE MODEL `statcast_analytics.model_pitch_whiff_ctx`
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
  stand, p_throws, balls, strikes, pitch_number,
  prev_pitch_type, prev_speed_diff, prev_plate_dx, prev_plate_dz,
  speed_vs_outing, ax_vs_outing, az_vs_outing,
  is_whiff
FROM (
  SELECT
    *,
    LAG(pitch_type) OVER pa AS prev_pitch_type,
    release_speed - LAG(release_speed) OVER pa AS prev_speed_diff,
    plate_x - LAG(plate_x) OVER pa AS prev_plate_dx,
    plate_z - LAG(plate_z) OVER pa AS prev_plate_dz,
    release_speed - AVG(release_speed) OVER outing AS speed_vs_outing,
    ax - AVG(ax) OVER outing AS ax_vs_outing,
    az - AVG(az) OVER outing AS az_vs_outing
  FROM `statcast_analytics.fct_pitches`
  WHERE game_date >= '2024-01-01'
  WINDOW
    pa AS (PARTITION BY game_date, game_id, at_bat_number ORDER BY pitch_number),
    outing AS (PARTITION BY game_date, game_id, pitcher_id, pitch_type)
)
WHERE is_swing = 1
  AND at_bat_number IS NOT NULL;
