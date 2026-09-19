-- Evaluate the xWhiff model (TDD §3.4, ROADMAP Sprint 13).
-- Evaluates ROC AUC, accuracy, precision, recall, f1_score, and log_loss
-- against a held-out evaluation window while strictly enforcing require_partition_filter.
SELECT
  roc_auc,
  accuracy,
  precision,
  recall,
  f1_score,
  log_loss
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
);
