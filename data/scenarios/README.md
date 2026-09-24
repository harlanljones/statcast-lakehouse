# Curated real-game pitch stories

These small Arrow IPC files contain MLB game-feed pitch telemetry. Normal
serving and static builds read these checked-in files; they do not call the
network. To refresh them from the same public feeds, run
`python3 -m ingestion.scenario_data` explicitly.

The same files also back `GET /pitches/sample` and `python3 -m ingestion.worker
--dry-run`: `ingestion.scenarios.real_pitches()` returns every pitch here once
(the Ohtani slices repeat pitches from the full game), in game order.

| Scenario | Source game | Selected pitches | Story reference |
|---|---|---:|---|
| `twenty-run-night` | Dodgers at Marlins, 2024-09-19, game 746011 | All 370 tracked pitches | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `ohtani-50-50` | Same game | All 22 pitches in Shohei Ohtani's plate appearances | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `ohtani-50th-home-run` | Same game | Four pitches from the top of the seventh, Ohtani's 50th home-run at-bat | [Ohtani's 50/50 game](https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day) |
| `freeman-walk-off` | Yankees at Dodgers, 2024 World Series Game 1, 2024-10-25, game 775300 | All 13 pitches in Freddie Freeman's plate appearances | [Freeman's World Series walk-off grand slam](https://www.mlb.com/news/freddie-freeman-walk-off-grand-slam-world-series-game-1-2024) |
| `snell-no-hitter` | Giants at Reds, 2024-08-02, game 746679 | All 114 pitches thrown by Blake Snell | [Snell's no-hitter](https://www.mlb.com/news/blake-snell-throws-no-hitter-for-giants-vs-reds) |

## Source and field mapping

Each source is the corresponding MLB Stats API live game feed at
`https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live`. The importer in
`ingestion/scenario_data.py` preserves the tracked pitch measurements and maps
the feed's `playId` to `pitch_id`, and `coordinates` to `worker.SCHEMA`: `x0/y0/z0`, `vX0/vY0/vZ0`,
`aX/aY/aZ`, and plate crossing `pX/pZ`. It also maps `startSpeed`, `spinRate`,
pitch type, batter/pitcher ids, and strike-zone bounds. Swing and whiff flags
come from the source event description. Batter and pitcher hand, the count
before each pitch, at-bat number, and pitch number fill the plate-appearance
context columns. The checked-in files predate those columns, so they hold
nulls there until the next refresh. Scenario selection is performed on
the original game id, batter or pitcher, inning, and play result as shown in
the table.

The story write-ups are linked separately from the pitch source so users can
check the game context. All game-feed data remains attributed to MLB Advanced
Media; refresh or redistribution is subject to MLB's published terms.
