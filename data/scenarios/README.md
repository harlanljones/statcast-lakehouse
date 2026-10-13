# Curated real-game pitch stories

These small Arrow IPC files contain MLB game-feed pitch telemetry. Normal
serving and static builds read these checked-in files; they do not call the
network. To refresh them from the same public feeds, run
`python3 -m ingestion.scenario_data` explicitly.

The same files also back `GET /pitches/sample` and `python3 -m ingestion.worker
--dry-run`: `ingestion.scenarios.real_pitches()` returns every pitch here once
(the Ohtani slices repeat pitches from the full game), in game order. Twenty-nine
slices across one hundred and sixty-one games and game dates (48,373 pitches),
from the 2024 regular season and World Series to the 2025 and 2026 seasons. The
`season-sweep` slice carries one game per period across all three seasons,
`strikeout-nights` the six games with 20+ combined strikeouts (132 in all),
`extra-innings` the six games that ran past nine innings (65 innings in all),
`power-nights` the six games with 4+ combined home runs (32 in all),
`walk-off-wins` the six games decided by the final swing, `one-run-slugfests` the
six one-run games with 104 runs in all, `pitchers-duels` the six games with three
runs or fewer (eight in all), `multi-homer-nights` the six games with a
multi-homer hitter (34 home runs in all), `grand-slams` the six games with a
grand slam (seven in all), `big-innings` the six games turned by a 6+ run
inning (43 runs in those six innings), `strikeout-starts` the six games whose
starter struck out 10+ (75 in all), `comeback-wins` the six games the winner
came back from three or four runs down in regulation, `multi-error-games`
the six games in which a team made three or more errors (24 in all),
`inning-after-inning` the six games in which one team scored in seven or more
different innings (93 runs in all), `called-early` the six games called
before nine innings (five for rain, one for wet grounds), `combined-shutouts`
twelve shutouts, none of them a complete game (five ended 1-0), `blowouts`
twelve games decided by nine runs or more (179 runs in all),
`hundred-pitch-starts` twelve games with a starter past 100 pitches
(105-112 in all), `unclassified-pitches` ten games holding a pitch Statcast
could not classify — which completes the feed's seventeen pitch types — and
`under-a-roof` twelve games at every roofed park in MLB's venue data;
`short-left-lines` twelve games at five of the shortest left-field lines;
`short-centre-fields` twelve games at the seven shortest centre fields;
`deep-centre-fields` twelve games at the six deepest;
`turf-fields` twelve games on artificial turf.

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
| `strikeout-starts` | Six games whose starting pitcher struck out 10+, one per date: Tigers at Reds 2024-07-07 (746691, Tarik Skubal 13), Rays at Astros 2024-08-04 (746356, Spencer Arrighetti 12), Red Sox at Braves 2025-06-01 (777692, Garrett Crochet 12), Reds at Phillies 2025-07-06 (777217, Zack Wheeler 12), Angels at Mariners 2025-09-14 (776317, George Kirby 14), Red Sox at Orioles 2026-09-06 (824794, Payton Tolle 12) | All 1,681 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `turf-fields` | Twelve games on artificial turf, one per date, at five of MLB's six turf venues (Estadio Alfredo Harp Helu in Mexico City is the sixth and the only one that is not roofed; it had no regular-season game on an unused date): Dodgers at Blue Jays 2024-04-27 (744946, Rogers Centre), Rockies at Marlins 2024-04-30 (746073, loanDepot park), Royals at Blue Jays 2024-05-01 (744939, Rogers Centre), Rockies at Marlins 2024-05-02 (746070, loanDepot park), Pirates at Blue Jays 2024-05-31 (744928, Rogers Centre), Orioles at Blue Jays 2024-06-06 (744923, Rogers Centre), Cubs at Rays 2024-06-11 (745077, Tropicana Field), Cubs at Rays 2024-06-12 (745079, Tropicana Field), Mariners at Marlins 2024-06-21 (746052, loanDepot park), Mariners at Marlins 2024-06-23 (746051, loanDepot park), Twins at Diamondbacks 2024-06-27 (747185, Chase Field), Rays at Rangers 2024-07-06 (744995, Globe Life Field) | All 3,502 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `deep-centre-fields` | Twelve games at the six deepest centre fields in MLB's venue data, one per date, among the parks whose centre distance the venue endpoint and the game feed AGREE on (Oriole Park at Camden Yards is excluded: the venue endpoint says 410, the game feed 400): Blue Jays at Tigers 2024-05-26 (746469, Comerica Park 420), Dodgers at Mets 2024-05-28 (745818, Citi Field 408), Cardinals at Astros 2024-06-03 (746382, Minute Maid Park 409), Braves at Red Sox 2024-06-04 (746949, Fenway Park 420), Braves at Red Sox 2024-06-05 (746950, Fenway Park 420), Brewers at Tigers 2024-06-07 (746466, Comerica Park 420), Mariners at Royals 2024-06-08 (746300, Kauffman Stadium 410), Brewers at Tigers 2024-06-09 (746463, Comerica Park 420), Yankees at Red Sox 2024-06-14 (746947, Fenway Park 420), Dodgers at Rockies 2024-06-17 (746543, Coors Field 415), Dodgers at Rockies 2024-06-18 (746542, Coors Field 415), Dodgers at Rockies 2024-06-19 (746538, Coors Field 415) | All 3,598 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `short-centre-fields` | Twelve games at the seven shortest centre fields in MLB's venue data, one per date: Twins at White Sox 2024-04-29 (746804, Rate Field 400), Pirates at Cubs 2024-05-18 (746882, Wrigley Field 400), Pirates at Cubs 2024-05-19 (746880, Wrigley Field 400), Giants at Pirates 2024-05-21 (745503, PNC Park 399), Giants at Pirates 2024-05-22 (745502, PNC Park 399), Giants at Pirates 2024-05-23 (745500, PNC Park 399), Braves at Pirates 2024-05-24 (745501, PNC Park 399), Orioles at White Sox 2024-05-25 (746794, Rate Field 400), Phillies at Giants 2024-05-29 (745333, Oracle Park 391), Yankees at Angels 2024-05-30 (746225, Angel Stadium 396), Athletics at Padres 2024-06-10 (745409, Petco Park 396), Rangers at Dodgers 2024-06-13 (746136, Dodger Stadium 395) | All 3,692 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `short-left-lines` | Twelve games at five of the shortest left-field lines in MLB's venue data, one per date: Rays at Red Sox 2024-05-13 (746961, Fenway Park 310), Rays at Red Sox 2024-05-14 (746962, Fenway Park 310), Rays at Red Sox 2024-05-16 (746959, Fenway Park 310), Mets at Rays 2024-05-03 (745101, Tropicana Field 315), Yankees at Rays 2024-05-10 (745094, Tropicana Field 315), Twins at Astros 2024-06-02 (746383, Minute Maid Park 315), Tigers at Guardians 2024-05-06 (746639, Progressive Field 325), Tigers at Guardians 2024-05-07 (746638, Progressive Field 325), Tigers at Guardians 2024-05-08 (746640, Progressive Field 325), Tigers at Yankees 2024-05-04 (745750, Yankee Stadium 318), Astros at Yankees 2024-05-09 (745748, Yankee Stadium 318), White Sox at Yankees 2024-05-17 (745747, Yankee Stadium 318) | All 3,576 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `under-a-roof` | Twelve games under a roof, one per date, covering all eight roofed parks from MLB's venue data: Dodgers at Blue Jays 2024-04-26 (744949, Rogers Centre), Mariners at Rangers 2024-04-23 (745026, Globe Life Field), Tigers at Rays 2024-04-24 (745099, Tropicana Field), Angels at Rays 2024-04-18 (745104, Tropicana Field), Braves at Diamondbacks 2025-04-27 (778147, Chase Field), Braves at Diamondbacks 2025-04-26 (778162, Chase Field), Reds at Marlins 2025-04-21 (778230, loanDepot park), Padres at Astros 2025-04-18 (778269, Daikin Park), Tigers at Brewers 2025-04-16 (778295, American Family Field), Astros at Mariners 2026-04-11 (823155, T-Mobile Park), Brewers at Marlins 2026-04-18 (823882, loanDepot park), Reds at Marlins 2026-04-09 (823884, loanDepot park) | All 3,494 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `unclassified-pitches` | Ten games each holding one pitch the feed could not classify (UN), one per date: Rockies at Rays 2025-03-28 (778560, Hunter Bigge 79.9), White Sox at Reds 2025-05-14 (777928, Davis Martin 82.4), Blue Jays at Cardinals 2025-06-09 (777581, José Berríos 63.5), Padres at Diamondbacks 2025-08-05 (776852, Yu Darvish 71.3), Pirates at Nationals 2025-09-12 (776351, Brad Lord 76.9), Pirates at Mets 2026-03-26 (823649, Yohan Ramírez 70.1), Angels at Yankees 2026-04-14 (823562, Ryan Zeferjahn 54.8), Tigers at Royals 2026-05-08 (824116, Keider Montero 51.9), Astros at Blue Jays 2026-06-23 (822799, Peter Lambert 55.9), Pirates at Nationals 2026-07-04 (822716, Zack Littell 73.8) | All 3,076 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `hundred-pitch-starts` | Twelve games with a 100+ pitch start, four per season and one per date: Rockies at Phillies 2024-04-16 (745593, Ranger Suarez 112 in a complete-game shutout), Padres at Brewers 2024-04-17 (746005, Michael King 109), White Sox at Phillies 2024-04-20 (745590, Zack Wheeler 106 and Michael Soroka 100), Blue Jays at Royals 2024-04-22 (746319, Brady Singer 107), Giants at Phillies 2025-04-17 (778279, Jordan Hicks 105), Yankees at Guardians 2025-04-22 (778218, Tanner Bibee 106), Phillies at Mets 2025-04-23 (778203, Zack Wheeler 107 in 10 innings), Pirates at Dodgers 2025-04-25 (778176, Paul Skenes 108), Orioles at Guardians 2026-04-16 (824453, Parker Messick 112), Padres at Angels 2026-04-19 (824047, Michael King 105), Dodgers at Giants 2026-04-21 (823236, Landen Roupp 106 and Yoshinobu Yamamoto 101), Marlins at Giants 2026-04-24 (823232, Sandy Alcantara 108) | All 3,450 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `blowouts` | Twelve games decided by 9+ runs, four per season and one per date: White Sox at Royals 2024-04-04 (746327, 1-10), Astros at Royals 2024-04-10 (746323, 2-11), Giants at Rays 2024-04-13 (745110, 11-2), Diamondbacks at Giants 2024-04-19 (745352, 17-1), Cardinals at Red Sox 2025-04-06 (778432, 7-18), Angels at Rays 2025-04-10 (778382, 11-1), Red Sox at Rays 2025-04-14 (778328, 1-16), Athletics at White Sox 2025-04-15 (778309, 12-3), Braves at Diamondbacks 2026-04-02 (825105, 17-2), Guardians at Braves 2026-04-12 (824938, 1-13), Cubs at Phillies 2026-04-15 (823477, 11-2), Braves at Phillies 2026-04-17 (823476, 9-0) | All 3,680 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `combined-shutouts` | Twelve shutouts, four per season and one per date, every one combined: White Sox at Royals 2024-04-06 (746329, 0-3), White Sox at Guardians 2024-04-08 (746654, 0-4), Phillies at Cardinals 2024-04-09 (745195, 0-3), Athletics at Rangers 2024-04-11 (745029, 1-0), Reds at Brewers 2025-04-03 (778468, 0-1), Marlins at Mets 2025-04-07 (778416, 0-2), White Sox at Guardians 2025-04-08 (778402, 0-1), Rockies at Padres 2025-04-12 (778352, 0-2), Tigers at Diamondbacks 2026-04-01 (825106, 0-1), Cubs at Guardians 2026-04-05 (824459, 1-0), Reds at Marlins 2026-04-06 (823886, 2-0), Phillies at Giants 2026-04-07 (823235, 0-6) | All 3,152 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `called-early` | Six games called before nine innings, one per date: Blue Jays at Royals 2024-04-25 (746320, 5 innings, wet grounds), Tigers at Twins 2024-07-04 (745890, 7, rain), Giants at Yankees 2025-04-11 (778370, 6, rain), Cubs at Reds 2025-06-18 (777474, 6, rain), White Sox at Twins 2025-04-24 (778189, 7, rain), Phillies at Orioles 2026-08-02 (824807, 6, rain) | All 1,341 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `inning-after-inning` | Six games in which one team scored in 7+ different innings, one per date: Rockies at Blue Jays 2024-04-12 (744954, 7 innings), Orioles at Yankees 2024-06-20 (745734, 8), Nationals at Angels 2025-06-27 (777331, 7), Orioles at Giants 2025-08-29 (776533, 7), Giants at Rockies 2026-05-31 (824354, 8), Phillies at Royals 2026-07-06 (824089, 8) | All 2,090 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `multi-error-games` | Six regulation games with a team making 3+ errors, one per date: Reds at Phillies 2024-04-02 (745598, 2+3 errors), White Sox at Royals 2024-04-07 (746330, 3), Cardinals at Red Sox 2025-04-04 (778463, 3), Brewers at Rockies 2025-04-09 (778379, 4), Diamondbacks at Mets 2026-04-08 (823646, 3), Cubs at Phillies 2026-04-13 (823481, 3+1) | All 1,866 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `comeback-wins` | Six games the winner trailed by 3-4 runs and won in nine innings, one per date: Angels at Marlins 2024-04-01 (746085, 7-4 from 0-4), Royals at Orioles 2024-04-03 (747059, 4-3), Twins at White Sox 2025-04-01 (778490, 8-3), Braves at Dodgers 2025-04-02 (778472, 6-5), Dodgers at Nationals 2026-04-03 (822758, 13-6), Marlins at Yankees 2026-04-04 (823569, 9-7) | All 1,903 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `big-innings` | Six games with a 6+ run inning, one per date: Yankees at Brewers 2024-04-28 (746001, 7 in the 6th), Padres at Orioles 2024-07-28 (747008, 6 in the 3rd), Braves at Rockies 2024-08-11 (746517, 7 in the 8th), Rockies at Diamondbacks 2025-08-10 (776794, 8 in the 5th), Mariners at Braves 2025-09-07 (776428, 8 in the 3rd), Orioles at Rays 2026-08-16 (822940, 7 in the 6th) | All 2,012 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
| `grand-slams` | Six games featuring a grand slam, one per date: Yankees at Rays 2024-05-12 (745092, Jose Siri), Guardians at Blue Jays 2024-06-16 (744926, Daulton Varsho), Padres at Nationals 2025-07-20 (777077, Xander Bogaerts), Giants at Athletics 2026-05-17 (825006, Harrison Bader), Cubs at Pirates 2026-07-26 (823354, Ryan O'Hearn), Cubs at Mariners 2026-08-23 (823099, Ian Happ and Pedro Ramirez — two in one game) | All 1,906 tracked pitches | [MLB schedule](https://www.mlb.com/schedule) |
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
