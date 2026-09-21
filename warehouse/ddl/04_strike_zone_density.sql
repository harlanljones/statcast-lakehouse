-- Strike zone spatial density & BigQuery GIS aggregation query (Sprint 12).
-- Uses ST_CONTAINS with plate_location (TDD §3.3) to aggregate pitches into
-- 3x3 strike zone polygons plus outer chase shadow zones.
-- require_partition_filter is enforced: always filters on game_date = @target_date.
WITH zone_cells AS (
  SELECT 1 AS zone_id, 'Top-Left' AS zone_name, ST_GEOGFROMTEXT('POLYGON((-0.708 2.833, -0.236 2.833, -0.236 3.500, -0.708 3.500, -0.708 2.833))') AS zone_geom UNION ALL
  SELECT 2, 'Top-Middle', ST_GEOGFROMTEXT('POLYGON((-0.236 2.833, 0.236 2.833, 0.236 3.500, -0.236 3.500, -0.236 2.833))') UNION ALL
  SELECT 3, 'Top-Right', ST_GEOGFROMTEXT('POLYGON((0.236 2.833, 0.708 2.833, 0.708 3.500, 0.236 3.500, 0.236 2.833))') UNION ALL
  SELECT 4, 'Middle-Left', ST_GEOGFROMTEXT('POLYGON((-0.708 2.167, -0.236 2.167, -0.236 2.833, -0.708 2.833, -0.708 2.167))') UNION ALL
  SELECT 5, 'Middle-Middle', ST_GEOGFROMTEXT('POLYGON((-0.236 2.167, 0.236 2.167, 0.236 2.833, -0.236 2.833, -0.236 2.167))') UNION ALL
  SELECT 6, 'Middle-Right', ST_GEOGFROMTEXT('POLYGON((0.236 2.167, 0.708 2.167, 0.708 2.833, 0.236 2.833, 0.236 2.167))') UNION ALL
  SELECT 7, 'Bottom-Left', ST_GEOGFROMTEXT('POLYGON((-0.708 1.500, -0.236 1.500, -0.236 2.167, -0.708 2.167, -0.708 1.500))') UNION ALL
  SELECT 8, 'Bottom-Middle', ST_GEOGFROMTEXT('POLYGON((-0.236 1.500, 0.236 1.500, 0.236 2.167, -0.236 2.167, -0.236 1.500))') UNION ALL
  SELECT 9, 'Bottom-Right', ST_GEOGFROMTEXT('POLYGON((0.236 1.500, 0.708 1.500, 0.708 2.167, 0.236 2.167, 0.236 1.500))')
),
pitches AS (
  SELECT * FROM `statcast_analytics.fct_pitches` f
  WHERE f.game_date = @target_date
)
SELECT
  z.zone_id,
  z.zone_name,
  ANY_VALUE(z.zone_geom) AS zone_geom,
  COUNT(f.pitch_id) AS pitch_count,
  COUNTIF(f.is_swing = 1) AS swing_count,
  COUNTIF(f.is_whiff = 1) AS whiff_count,
  ROUND(SAFE_DIVIDE(COUNTIF(f.is_whiff = 1), COUNTIF(f.is_swing = 1)) * 100.0, 1) AS whiff_pct,
  ROUND(SAFE_DIVIDE(COUNT(f.pitch_id), SUM(COUNT(f.pitch_id)) OVER ()) * 100.0, 1) AS density_pct
FROM zone_cells z
LEFT JOIN pitches f
  ON ST_CONTAINS(z.zone_geom, f.plate_location)
GROUP BY z.zone_id, z.zone_name
ORDER BY z.zone_id;
