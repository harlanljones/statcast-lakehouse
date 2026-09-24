-- One-off zero-shot baseline: TabFM (BigQuery AI.EVALUATE, Preview since
-- 2026-08-31) on the champion's 11 features (TabFM caps inputs at 20).
-- Run manually, once, before TabFM moves to token pricing on 2026-10-30.
-- Never schedule it: the $4/mo budget guard has no headroom for it.
-- Context is the 7 days before the held-out day (no leakage), capped at a
-- deterministic 10,000 swings. AI.EVALUATE reports precision/recall/F1 but may
-- not report ROC AUC, so compare on those against compare_whiff_models.sql.
DECLARE context_start DATE DEFAULT DATE_SUB(@target_date, INTERVAL 7 DAY);

CREATE TEMP TABLE tabfm_context AS
SELECT
  pitch_type,
  release_speed,
  release_spin_rate,
  vx0, vy0, vz0,
  ax, ay, az,
  plate_x, plate_z,
  is_whiff
FROM `statcast_analytics.fct_pitches`
WHERE game_date >= context_start
  AND game_date < @target_date
  AND is_swing = 1
ORDER BY FARM_FINGERPRINT(pitch_id)
LIMIT 10000;

CREATE TEMP TABLE tabfm_target AS
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
  AND is_swing = 1;

SELECT *
FROM AI.EVALUATE(
  TABLE tabfm_context,
  TABLE tabfm_target,
  label_col => 'is_whiff'
);
