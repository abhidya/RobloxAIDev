# Playable Space Review

## 2026-06-03 Visual QA Pass

Verdict: **not signed off**.

This review uses the repo-local `roblox-playable-space-review` gate. Console
phase logs and aerial screenshots are not sufficient evidence for a polished
Roblox game.

## Screenshots Captured

| Area/state | Screenshot id | Verdict |
| --- | --- | --- |
| Lobby/spawn player-height view | `qa_lobby_spawn_player_view_retry` | Fail |
| Medieval Market player-height view | `qa_medieval_market_player_view_retry` | Fail |
| Sci-Fi Lab player-height view | `qa_scifi_lab_player_view_retry` | Fail |
| Cozy Cabin player-height view | `qa_cozy_cabin_player_view_retry` | Fail |
| Play-mode HUD/disguise prompt | `qa_playmode_hud_disguise_prompt` | Partial pass |
| Lobby queue HUD before sign fix | `qa_lobby_queue_medieval_room_flow` | Partial pass |
| Lobby queue HUD after sign fix | `qa_lobby_queue_medieval_after_sign_fix` | Partial pass |

## Findings

### P1 - Lobby Start Flow Is Functional But Not Visually Signed Off

Evidence:

- `qa_lobby_spawn_player_view_retry`
- `qa_lobby_spawn_after_console_move`
- `qa_lobby_queue_medieval_room_flow`
- `qa_lobby_queue_medieval_after_sign_fix`

Progress:

- The visible `Workspace.Stage.SpawnLocation` was hidden, and the camera-filling
  sci-fi console that blocked spawn was moved out of the direct spawn sightline.
- A lobby floor, three room pads, queue prompts, guide NPC, upgrade NPC, and
  portal labels now exist in `Workspace.VisualPolish.Lobby`.
- Rojo source now binds each room portal to queue/session logic.
- Play-mode queue HUD shows room name, queue count, min/max player count, phase,
  role, and score.
- `qa_lobby_queue_medieval_room_flow` caught an oversized portal sign/pad issue.
  `qa_lobby_queue_medieval_after_sign_fix` recaptured the same flow after the
  sign was reduced, lifted, and pushed forward.

Remaining issues:

- The lobby/portal view still shows off-theme room assets and sparse flat space
  immediately beyond the pads.
- Queue signage and room entrances need stronger spatial framing so each portal
  clearly leads to an isolated themed room rather than a shared flat plaza.

Required fix:

- Build clearer portal archways or room teleport framing.
- Reduce sightline bleed from adjacent rooms at player height.
- Recapture fresh spawn, each portal, and queued HUD states.

### P1 - Playable Rooms Are Too Sparse

Evidence:

- `qa_medieval_market_player_view_retry`
- `qa_scifi_lab_player_view_retry`
- `qa_cozy_cabin_player_view_retry`
- `qa_playmode_hud_disguise_prompt`

Issues:

- Large flat spaces dominate player-height views.
- Prop hunt cover density is too low for convincing hide-and-seek gameplay.
- Several hideable props are isolated rather than arranged into believable cover
  clusters, market lanes, lab bays, or cabin campsite pockets.

Required fix:

- Recluster existing inspected assets into denser lanes and pockets.
- Add more asset-backed cover and set dressing per quadrant.
- Recapture each room from player level after changes.

### P1 - Theme Boundaries Bleed

Evidence:

- Medieval view includes sci-fi-looking crates/portal silhouettes.
- Sci-Fi view includes strong grass/tree/cabin bleed at the edge.
- Cozy Cabin view includes sci-fi assets nearby.

Required fix:

- Separate rooms visually with distance, walls, terrain bands, lighting, or
  themed entrances.
- Make each player-height view read as one theme without needing an aerial map.

### P2 - UI/HUD Is Readable But Needs Game-Flow Context

Evidence: `qa_playmode_hud_disguise_prompt`.

Passes:

- Phase, role, score, and disguise prompt are readable.
- Prompt appears in context near `Barrel_M_1`.

Risks:

- HUD does not yet explain room queue state, room name, player count, or return
  flow.
- The visible room behind the HUD still looks sparse.

Required fix:

- Add lobby/queue/session UI states once room matchmaking is implemented.
- Keep current phase/role/score readability.

## Fixes Applied In This Pass

- Added room-aware source config for Medieval Market, Sci-Fi Lab, and Cozy Cabin.
- Replaced the global all-player round loop with per-room queue workers:
  `Queue -> Intermission -> Hiding -> Hunting -> RoundEnd -> Lobby`.
- Added Roblox `Teams` assignment for Lobby, Hiders, and Seekers.
- Bound room portal prompts and portal-pad proximity queueing.
- Added lobby/queue HUD labels for room name, queue count, min/max players, role,
  score, and current phase.
- Validated a one-window fast smoke by temporarily enabling source-level debug:
  player queued, entered Medieval Market, became Hider, survived, scored 10, and
  returned to Lobby. Production debug flags were restored afterward.
- Reduced/lifted lobby portal signs and toned down portal pads after
  `qa_lobby_queue_medieval_room_flow` showed camera occlusion.

## New Validation Evidence

- `rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx` passed
  after room/session source changes.
- Studio console during fast local smoke showed:
  `Medieval Market -> Queue -> Intermission -> Hiding -> Hunting -> RoundEnd`.
- `qa_lobby_queue_medieval_after_sign_fix` confirms the lobby queue HUD is
  readable and the previous giant foreground sign no longer blocks the view.

## Signoff Requirements Before Claiming Done

- At least one polished lobby screenshot from spawn.
- Player-height quadrant screenshots for every playable room.
- Before/after screenshot ids for every P1 fix.
- Live UI screenshots for lobby, queueing, active round, disguise prompt, and
  round end.
- No remaining P1 visual density, orientation, scale, navigation, or UI/UX
  issues.
