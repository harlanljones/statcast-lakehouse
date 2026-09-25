-- Champion vs challengers (XGBoost 2.1; plate-appearance context) on the same
-- held-out day. Each ML.EVALUATE scans exactly one game_date partition. The
-- context model only scores swings with context, so check its row coverage
-- before comparing AUCs.
SELECT 'model_pitch_whiff' AS model, roc_auc, log_loss, accuracy, precision, recall, f1_score
FROM ML.EVALUATE(
  MODEL `statcast_analytics.model_pitch_whiff`,
  (
    SELECT
      pitch_type,
      release_speed,
      release_spin_rate,
      vx0, vy0, vz0,
      ax, ay, az,
      plate_x, plate_z,
      is_whiff
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date = @target_date
      AND is_swing = 1
  )
)
UNION ALL
SELECT 'model_pitch_whiff_xgb21' AS model, roc_auc, log_loss, accuracy, precision, recall, f1_score
FROM ML.EVALUATE(
  MODEL `statcast_analytics.model_pitch_whiff_xgb21`,
  (
    SELECT
      pitch_type,
      release_speed,
      release_spin_rate,
      vx0, vy0, vz0,
      ax, ay, az,
      plate_x, plate_z,
      is_whiff
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date = @target_date
      AND is_swing = 1
  )
)
UNION ALL
SELECT 'model_pitch_whiff_ctx' AS model, roc_auc, log_loss, accuracy, precision, recall, f1_score
FROM ML.EVALUATE(
  MODEL `statcast_analytics.model_pitch_whiff_ctx`,
  (
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
      WHERE game_date = @target_date
      WINDOW
        pa AS (PARTITION BY game_date, game_id, at_bat_number ORDER BY pitch_number),
        outing AS (PARTITION BY game_date, game_id, pitcher_id, pitch_type)
    )
    WHERE is_swing = 1
      AND at_bat_number IS NOT NULL
  )
)
ORDER BY roc_auc DESC;
