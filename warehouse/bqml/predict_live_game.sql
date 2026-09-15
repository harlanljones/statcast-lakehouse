-- Single-day batch inference. Cost: scans exactly one game_date partition.
SELECT
  f.pitch_id,
  f.pitcher_id,
  f.pitch_type,
  f.release_speed,
  p.prob AS xwhiff
FROM `statcast_analytics.fct_pitches` f,
ML.PREDICT(
  MODEL `statcast_analytics.model_pitch_whiff`,
  (
    SELECT * EXCEPT (is_whiff, game_date, game_id, pitcher_id, batter_id, pitch_id)
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date = @target_date AND is_swing = 1
  )
) p
WHERE f.game_date = @target_date
  AND f.is_swing = 1
  AND f.pitch_id = p.pitch_id
