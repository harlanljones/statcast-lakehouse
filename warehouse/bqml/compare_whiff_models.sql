-- Champion vs XGBoost 2.1 challenger on the same held-out day. Each
-- ML.EVALUATE scans exactly one game_date partition of swings.
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
ORDER BY roc_auc DESC;
