# Curated real-game pitch stories

These small Arrow IPC files contain MLB game-feed pitch telemetry. Normal
serving and static builds read these checked-in files; they do not call the
network. To refresh them from the same public feeds, run
`python3 -m ingestion.scenario_data` explicitly.

The same files also back `GET /pitches/sample` and `python3 -m ingestion.worker
--dry-run`: `ingestion.scenarios.real_pitches()` returns every pitch here once
(the Ohtani slices repeat pitches from the full game), in game order. Ten
slices across thirteen games and thirteen game dates, from the 2024 regular
season and World Series to the 2025 and 2026 seasons; the `season-sweep` slice
carries one game per period across all three seasons.

| Scenario | Source game | Selected pitches | Story reference |
|---|---|---:|---|
| `twenty-run-night` | Dodgers at Marlins, 2024-09-19, game 746011 | All 370 tracked pitches | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `ohtani-50-50` | Same game | All 22 pitches in Shohei Ohtani's plate appearances | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `ohtani-50th-home-run` | Same game | Four pitches from the top of the seventh, Ohtani's 50th home-run at-bat | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `freeman-walk-off` | Yankees at Dodgers, 2024 World Series Game 1, 2024-10-25, game 775300 | All 13 pitches in Freddie Freeman's plate appearances | [Freeman's World Series walk-off grand slam](https://www.mlb.com/news/freddie-freeman-walk-off-grand-slam-world-series-game-1-2024) |
| `snell-no-hitter` | Giants at Reds, 2024-08-02, game 746679 | All 114 pitches thrown by Blake Snell | [Snell's no-hitter](https://www.mlb.com/news/blake-snell-throws-no-hitter-for-giants-vs-reds) |
| `cardinals-dodgers-opener` | Cardinals at Dodgers, 2024-03-28, game 746165 | All 259 tracked pitches | [Opening Day at Dodger Stadium](https://www.mlb.com/gameday/cardinals-vs-dodgers/2024/03/28/746165/final) |
| `tigers-astros-june` | Tigers at Astros, 2024-06-15, game 746381 | All 357 tracked pitches | [Tigers 13, Astros 5](https://www.mlb.com/gameday/tigers-vs-astros/2024/06/15/746381/final) |
| `yankees-athletics-2025` | Yankees at Athletics, 2025-05-10, game 777972 | All 323 tracked pitches | [Athletics 11, Yankees 7](https://www.mlb.com/gameday/yankees-vs-athletics/2025/05/10/777972/final) |
| `twins-blue-jays-2026` | Twins at Blue Jays, 2026-04-10, game 822829 | All 311 tracked pitches | [Blue Jays 10, Twins 4](https://www.mlb.com/gameday/twins-vs-blue-jays/2026/04/10/822829/final) |
| `season-sweep` | Six games: Twins at Orioles 2024-04-15 (747053), Rays at Yankees 2024-07-20 (745720), Reds at Orioles 2025-04-20 (778250), Brewers at Reds 2025-08-15 (776740), Phillies at Pirates 2026-05-15 (823384), Phillies at Mets 2026-09-20 (823570) | All 2,040 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |

## Source and field mapping

Each source is the corresponding MLB Stats API live game feed at
`https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live`. The importer in
`ingestion/scenario_data.py` preserves the tracked pitch measurements and maps
the feed's `playId` to `pitch_id`, and `coordinates` to `worker.SCHEMA`: `x0/y0/z0`, `vX0/vY0/vZ0`,
`aX/aY/aZ`, and plate crossing `pX/pZ`. It also maps `startSpeed`, `spinRate`,
pitch type, batter/pitcher ids, and strike-zone bounds. Swing and whiff flags
come from the source event description. Batter and pitcher hand, the count
before each pitch, at-bat number, and pitch number fill the plate-appearance
context columns. The feed's `pitchData.extension` (feet from the rubber to
the release point) fills `extension`, and `matchup.pitcher.fullName` /
`matchup.batter.fullName` fill the nullable string columns `pitcher_name` and
`batter_name` (slice files only, not `fct_pitches`). `x0/y0/z0` are measured
at the 50 ft plane, not at release; `extension` lets clients back-extrapolate
to the release plane. Every checked-in slice now carries `extension`,
`pitcher_name` and `batter_name`; `ingestion.scenarios` still fills those
columns with NULL on load for slices written before the columns existed.
Refreshing needs network access to statsapi.mlb.com
(`python -m ingestion.scenario_data`). A refresh also verifies the corpus
invariant that a pitch's recorded `plate_x`/`plate_z` is where its own
9-parameter fit crosses the plate (`ingestion/tests/test_scenarios.py`); the
2024 Seoul Series opener was left out for failing it by up to 0.04 ft.
Pitches the feed lists without Statcast tracking coordinates are skipped with
a count on stderr rather than failing the whole game. Scenario selection is
performed on the original game id, batter or pitcher, inning, and play result
as shown in the table.

The story write-ups are linked separately from the pitch source so users can
check the game context. All game-feed data remains attributed to MLB Advanced
Media; refresh or redistribution is subject to MLB's published terms.
