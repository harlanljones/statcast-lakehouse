# Curated real-game pitch stories

These small Arrow IPC files contain MLB game-feed pitch telemetry. Normal
serving and static builds read these checked-in files; they do not call the
network. To refresh them from the same public feeds, run
`python3 -m ingestion.scenario_data` explicitly.

The same files also back `GET /pitches/sample` and `python3 -m ingestion.worker
--dry-run`: `ingestion.scenarios.real_pitches()` returns every pitch here once
(the Ohtani slices repeat pitches from the full game), in game order. Seventeen
slices across sixty-one games and sixty-one game dates (18,722 pitches), from the
2024 regular season and World Series to the 2025 and 2026 seasons. The
`season-sweep` slice carries one game per period across all three seasons,
`strikeout-nights` the six games with 20+ combined strikeouts (132 in all),
`extra-innings` the six games that ran past nine innings (65 innings in all),
`power-nights` the six games with 4+ combined home runs (32 in all),
`walk-off-wins` the six games decided by the final swing, `one-run-slugfests` the
six one-run games with 104 runs in all, `pitchers-duels` the six games with three
runs or fewer (eight in all), and `multi-homer-nights` the six games with a
multi-homer hitter (34 home runs in all).

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
| `multi-homer-nights` | Six games in which a hitter homered at least twice, one per date: Giants at Rays 2024-04-14 (745113, René Pinto 2), Athletics at Phillies 2024-07-14 (745551, Lawrence Butler 3, Brent Rooker 2, Seth Brown 2), Giants at Yankees 2025-04-13 (778339, Jung Hoo Lee 2), Mariners at Cubs 2025-06-22 (777403, three hitters with 2 each), Marlins at Orioles 2025-07-13 (777129, Kyle Stowers 3), Rockies at Phillies 2026-05-10 (823463, Kyle Schwarber 2) | All 1,731 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `pitchers-duels` | Six games with three runs or fewer, one per date: Brewers at Cardinals 2024-04-21 (745192, 2-0), Marlins at Tigers 2024-05-15 (746472, 2-0), White Sox at Braves 2025-08-20 (776669, 0-1), Pirates at Diamondbacks 2026-05-06 (825091, 1-0), Giants at Brewers 2026-06-03 (823780, 1-0), Giants at Guardians 2026-08-19 (824394, 1-0) | All 1,532 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `one-run-slugfests` | Six games decided by one run with both teams at 6+ runs, one per date: Cubs at Pirates 2024-05-11 (745505, 9-10), Dodgers at Astros 2024-07-27 (746362, 6-7), Rays at Dodgers 2024-08-24 (746108, 9-8 in 10), Nationals at Rockies 2025-04-19 (778247, 12-11), Athletics at Blue Jays 2025-05-31 (777701, 7-8), Phillies at Brewers 2026-06-13 (823776, 9-8) | All 1,965 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `walk-off-wins` | Six games decided by the final swing, one per date, all in extra innings: Dodgers at Tigers 2024-07-13 (746447, 10 inn, HR by Gio Urshela), Blue Jays at Braves 2024-09-08 (747072, 11, FC by Sean Murphy), Reds at Cardinals 2025-06-21 (777415, 11, single by Yohel Pozo), Tigers at Marlins 2025-09-13 (776347, 11, HR by Troy Johnston), Cardinals at Reds 2026-05-23 (824516, 11, FC by Blake Dunn), Giants at Cubs 2026-06-06 (824669, 10, single by Michael Busch) | All 2,010 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `power-nights` | Six games with 4+ combined home runs, one per date: Giants at Cardinals 2024-06-22 (745163, 4 HR), Reds at Marlins 2024-08-05 (746038, 5), Nationals at Orioles 2025-05-18 (777873, 8), Guardians at Athletics 2026-05-02 (825014, 5), Reds at Pirates 2026-06-27 (823364, 4), Cardinals at Cubs 2026-08-15 (824644, 6) | All 1,792 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `extra-innings` | Six games that went past nine innings, one per date: Mets at Rays 2024-05-05 (745103, 10 inn), Guardians at Yankees 2024-08-20 (745707, 12), Athletics at Mariners 2024-09-28 (745203, 10), Royals at Cardinals 2025-06-05 (777642, 10), Diamondbacks at Pirates 2025-07-25 (777014, 11), Orioles at Royals 2026-04-20 (824125, 12) | All 2,143 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `strikeout-nights` | Six games, one per date: Rays at Rockies 2024-04-05 (746576, 22 K), Rays at Orioles 2024-06-01 (747029, 20 K), Twins at Rays 2024-09-05 (745042, 24 K), Astros at Twins 2025-04-05 (778440, 23 K), Pirates at Reds 2025-09-25 (776190, 22 K), Twins at Yankees 2026-07-05 (823525, 21 K) | All 1,739 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `season-sweep` | Twelve games, one per period: Twins at Orioles 2024-04-15 (747053), Padres at Braves 2024-05-20 (747119), Rays at Yankees 2024-07-20 (745720), Rangers at Yankees 2024-08-10 (745712), Reds at Orioles 2025-04-20 (778250), Blue Jays at Phillies 2025-06-15 (777499), Brewers at Reds 2025-08-15 (776740), White Sox at Tigers 2025-09-05 (776452), Phillies at Pirates 2026-05-15 (823384), Padres at Rangers 2026-06-20 (822885), Red Sox at Marlins 2026-08-25 (823826), Phillies at Mets 2026-09-20 (823570) | All 4,063 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |

## Source and field mapping

Each source is the corresponding MLB Stats API live game feed at
`https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live`. The importer in
`ingestion/scenario_data.py` preserves the tracked pitch measurements and maps
the feed's `playId` to `pitch_id`, and `coordinates` to `worker.SCHEMA`: `x0/y0/z0`, `vX0/vY0/vZ0`,
`aX/aY/aZ`, and plate crossing `pX/pZ`. It also maps `startSpeed`, `spinRate`,
pitch type, batter/pitcher ids, and strike-zone bounds. Swing and whiff flags
come from the source event description. Batter and pitcher hand, the count
before each pitch, at-bat number, and pitch number fill the plate-appearance
context columns. The pitch event that was put in play carries the feed's
`hitData`, which fills the contact columns `launch_speed` (mph), `launch_angle`
(degrees), `hit_distance` (projected feet) and `bb_type` (fly_ball,
line_drive, ground_ball, popup, ...); all four are NULL on every other pitch. The feed's `pitchData.extension` (feet from the rubber to
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
