# Studio Validation Log

## 2026-06-03

Goal: use Prop Hunt as the validation gate for MCP and skill development.

What ran:

- `tool_search` exposed Roblox Studio MCP proxy tools.
- `list_roblox_studios` returned one Studio instance: `ef6891c0-745c-4f8e-8b2e-41700290c9e5`.
- `set_active_studio` selected that instance.
- Read-only tree probes (`search_game_tree`) failed with: `Execution is prevented because previously active Studio has disconnected or doesn't have a place opened.`
- Opened repo file `Place1.rbxl` with macOS `open`.
- Retried `list_roblox_studios`, `set_active_studio`, and read-only probes.

Result:

- The Studio proxy still reported that the active Studio had disconnected or did not have a place opened.
- No live Studio game-tree inspection, insertion check, `Workspace.HideableProps` audit, screenshot, or playtest evidence was collected.

Repo-side validation completed instead:

- `npm test` passed in `asset-search-mcp`.
- The test suite now includes offline gate logic, a persisted CLI Prop Hunt gate, and MCP smoke coverage for `validate_prop_hunt_gate`.
- A non-executing `strings` scan of `Place1.rbxl` found Prop Hunt markers, including `HideableProps`, `Intermission`, `Hiding`, `RoundEnd`, `MIN_PLAYERS`, `Medieval Market`, `Sci-Fi Lab`, and `Cozy Cabin`. This supports that the place contains Prop Hunt content, but it is not gameplay evidence.

Next live validation step:

Open `Place1.rbxl` in a Studio session where the Studio MCP proxy can execute Luau, then verify:

- `Workspace.HideableProps` contains valid disguise models.
- Every hideable model has a `PrimaryPart`.
- Inserted assets have no enabled scripts.
- The round loop runs Intermission -> Hiding -> Hunting -> RoundEnd.

## 2026-06-03 Continuation

Goal: retry Studio MCP after Roblox MCP/Studio restart, run Rojo in the `Place1.rbxl` folder, and finish the Prop Hunt validation gate.

What ran:

- `list_roblox_studios` returned one opened Studio instance named `Place1.rbxl`: `533ab0d2-5919-4c10-97df-8e6619b0d4fe`.
- `set_active_studio` selected that instance.
- Read-only live audit returned:
  - `Workspace.HideableProps` exists.
  - 53 hideable children.
  - Prop Hunt exists in `ReplicatedStorage`, `ServerScriptService`, and `StarterPlayerScripts`.
- Detailed hideable audit returned:
  - 53/53 children are valid Models.
  - 53/53 have `PrimaryPart`.
  - 0 scripted hideables.
  - 0 oversized hideables.
  - 0 tiny hideables.
  - Prefix split: `M=20`, `S=17`, `C=16`.
- Rojo source was added at repo root and `rojo serve --address 127.0.0.1 --port 34872` was started.
- Live Studio script audit showed the safer server/config logic was present:
  - `DEBUG_SOLO` in config.
  - role check for hider-only disguise requests.
  - phase logging.
- Solo smoke configuration was applied in Studio only for validation:
  - `DEBUG_SOLO = true`
  - short phase durations.
- `start_stop_play(is_start=true)` started the game.

Result:

- Console showed repeated full round cycles:
  - `[PropHunt] phase -> Intermission`
  - `[PropHunt] phase -> Hiding`
  - `[PropHunt] phase -> Hunting`
  - `[PropHunt] phase -> RoundEnd`
- Live player `blazimann` had `PropHuntHUD` in `PlayerGui`.
- `start_stop_play(is_start=false)` stopped play.
- Production config was restored in Studio:
  - `DEBUG_SOLO = false`
  - `INTERMISSION_TIME = 15`
  - `HIDING_TIME = 30`
  - `HUNTING_TIME = 120`
  - `ROUND_END_TIME = 8`
- Screenshot `prop_hunt_gate_after_rojo` captured the three-area Prop Hunt map.

Repo-side validation:

- `rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx` passed.
- `npm test` passed in `asset-search-mcp`.
- `node --check` passed for MCP source, scripts, and smoke tests.

## 2026-06-03 Full Gameplay Pass

Goal: harden the Rojo-backed game logic to a Roblox-standard playable loop and
make the Prop Hunt gate replayable from MCP state, not just chat evidence.

What changed:

- Server logic now broadcasts score snapshots, remembers current state for late
  joiners, tracks seeker/hider roles, freezes seekers during Hiding, restores
  movement during Hunting, and keeps disguise requests hider-only.
- Client HUD now shows phase countdown, role, score, toasts, and the disguise
  prompt only when the local player is an active hider.
- `Config.DEBUG_FAST_TIMINGS` was added for seconds-long Studio smoke tests
  without changing production phase durations.
- `asset-search-mcp` now includes `scripts/import-prop-hunt-gate.mjs`,
  `fixtures/place1-prop-hunt-gate.json`, `npm run seed:prop-hunt-place1`, and a
  fixture import regression test.

Repo-side validation:

- `rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx` passed.
- `npm run seed:prop-hunt-place1 && npm run gate:prop-hunt` passed:
  3 areas, 20 hideables, 4 set pieces, 24 palette assets.
- `npm test` passed in `asset-search-mcp`, including offline, CLI gate, Place1
  fixture import, and MCP smoke tests.
- `node --check` passed for the new import script, fixture test, MCP source,
  gate CLI, and Prop Hunt gate module.

Studio MCP validation:

- Confirmed Rojo-synced scripts in `ServerScriptService.PropHunt`,
  `ReplicatedStorage.PropHunt.Config`, and `StarterPlayerScripts.PropHunt`.
- Confirmed live place has 53 hideables and three world areas:
  `MedievalMarket`, `SciFiLab`, and `CozyCabin`.
- Temporarily set `DEBUG_SOLO = true` and `DEBUG_FAST_TIMINGS = true`; playtest
  reached repeated Intermission -> Hiding -> Hunting -> RoundEnd loops.
- HUD audit for player `blazimann` showed `PropHuntHUD`, `Hider`, countdown,
  and score labels updating.
- Interaction smoke with longer temporary timing navigated to
  `Workspace.HideableProps.Barrel_M_1`, pressed `E`, and confirmed the server
  attached `Disguise` with primary part `Metal`; HUD toast reported
  `Disguised as Barrel_M_1`.
- Stopped play and restored production config:
  `DEBUG_SOLO = false`, `DEBUG_FAST_TIMINGS = false`,
  `INTERMISSION_TIME = 15`, `HIDING_TIME = 30`,
  `HUNTING_TIME = 120`, `ROUND_END_TIME = 8`.
- Screenshot `prop_hunt_gate_full_gameplay_validation` captured the final
  three-area map.

Remaining stronger validation:

- A true two-client Local Server test was not launched through Studio MCP; the
  code path is built for 2+ players, but release-readiness should still include
  a manual two-client Studio test.

## 2026-06-03 Room Session And Visual Gate Continuation

Goal: restart Rojo after computer restart, reconnect Studio MCP, add
Roblox-standard lobby/room queue flow, and continue visual signoff instead of
accepting console-only validation.

What ran:

- Restarted Rojo from repo root:
  `rojo serve --address 127.0.0.1 --port 34872`.
- Studio MCP saw active Studio instance `Place1.rbxl`
  (`fee61fac-e743-40ee-94d1-bc7d49fb6570`).
- Verified Rojo mounts after reconnect:
  - `ServerScriptService.PropHunt` is a `Script`.
  - `ReplicatedStorage.PropHunt` contains `Config` and `Remotes`.
  - `StarterPlayerScripts.PropHunt` is a `LocalScript`.
- Added room config for Medieval Market, Sci-Fi Lab, and Cozy Cabin, including
  min/max players, portal prompt parts, portal pad parts, room spawns, seeker
  spawns, and lobby return spawn.
- Reworked server flow from one global loop into per-room queue workers:
  `Queue -> Intermission -> Hiding -> Hunting -> RoundEnd -> Lobby`.
- Added Roblox `Teams` for Lobby, Hiders, and Seekers.
- Added portal prompt binding plus proximity-pad queueing so players can walk
  into a room portal to queue.
- Added HUD labels for room name, queue count, min/max players, phase, role,
  and score.

Validation:

- `rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx` passed.
- Play-mode Studio console showed all three room portals binding.
- Production queue smoke walked onto `MedievalPortalPad`; HUD showed
  `Medieval Market`, `Queue 1/8 Min 2`, and `Score 0`.
- Temporary source-level debug smoke (`DEBUG_SOLO = true`,
  `DEBUG_FAST_TIMINGS = true`) completed:
  - `Medieval Market -> Queue`
  - `Medieval Market -> Intermission`
  - `Medieval Market -> Hiding`
  - `Medieval Market -> Hunting`
  - `Medieval Market -> RoundEnd`
  - player returned to Lobby and score increased to `10`.
- Production config was restored to:
  `DEBUG_SOLO = false`, `DEBUG_FAST_TIMINGS = false`.
- Screenshot evidence:
  - `qa_lobby_queue_medieval_room_flow` caught an oversized/cropped portal sign.
  - `qa_lobby_queue_medieval_after_sign_fix` recaptured after shrinking/lifting
    signs and toning down portal pads.

Visual gate status:

- The room/session flow is now functional in a one-window smoke.
- The game is still **not visually signed off**. Current screenshots still show
  sparse flat areas, theme bleed between adjacent rooms, and weak room entrance
  framing. See `docs/playable-space-review.md`.
