-- Small independent metadata dimension; never add context to every pitch.
-- Seed from serving/pitcher_storylines.json. `python -m serving.storylines`
-- emits the same catalog as newline-delimited JSON for a BQ batch load.
-- Use WRITE_TRUNCATE for a complete, repeatable catalog refresh.
CREATE TABLE IF NOT EXISTS `statcast_analytics.dim_player_storylines` (
  storyline_id STRING NOT NULL,
  player_id INT64 NOT NULL,
  player_name STRING NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  event_date DATE NOT NULL,
  storyline_type STRING NOT NULL,
  title STRING NOT NULL,
  summary STRING NOT NULL,
  source_url STRING NOT NULL
)
CLUSTER BY player_id
OPTIONS (
  description = "Retrospective pitcher context: inclusive comparison windows and exact event dates; not model features"
);

-- For pitch cross-references ALWAYS filter the fact partition explicitly:
-- SELECT p.*, s.storyline_id, s.title
-- FROM `statcast_analytics.fct_pitches` AS p
-- LEFT JOIN `statcast_analytics.dim_player_storylines` AS s
--   ON p.pitcher_id = s.player_id
--  AND p.game_date BETWEEN s.start_date AND s.end_date
-- WHERE p.game_date = @target_date;
-- Multiple events can match one pitch; aggregate pitches before this join
-- when calculating pitch-count or rate metrics to avoid fanout inflation.
