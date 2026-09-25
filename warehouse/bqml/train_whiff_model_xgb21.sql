-- Challenger xWhiff model trained on XGBoost 2.1 (BigQuery GA 2026-08-27,
-- XGBOOST_VERSION option). Same features, label, and training window as
-- train_whiff_model.sql so compare_whiff_models.sql isolates the library
-- change. Promote by copying XGBOOST_VERSION into train_whiff_model.sql only
-- if it beats the champion's roc_auc on the held-out day.
CREATE OR REPLACE MODEL `statcast_analytics.model_pitch_whiff_xgb21`
OPTIONS (
  model_type = 'BOOSTED_TREE_CLASSIFIER',
  xgboost_version = '2.1',
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
WHERE game_date >= '2024-01-01'
  AND is_swing = 1;
