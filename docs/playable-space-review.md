# Playable Space Review

## 2026-06-03 Visual QA Pass

Verdict: **not signed off**.

This review uses the repo-local `roblox-playable-space-review` gate. Console
phase logs and aerial screenshots are not sufficient evidence for a polished
Roblox game.

The current MCP-backed minimum gate is:

```text
plan_playable_space_review(project: "prophunt")
validate_playable_space_review(report: ..., plan: ...)
```

The validator must pass before this document can change to `signed off`; it
requires every playable space, player-height quadrant screenshots, required
shot kinds, UI states, and no unresolved major/blocker findings.

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
| Lobby spawn after room isolation | `qa_lobby_spawn_after_room_isolation` | Fail |
| Lobby spawn after wall fix | `qa_lobby_spawn_after_room_wall_fix` | Partial pass |
| Lobby spawn after label cleanup | `qa_lobby_spawn_after_compact_labels` | Partial pass |
| Medieval after room isolation | `qa_medieval_after_room_isolation_density` | Partial pass |
| Medieval after vertical cover | `qa_medieval_after_vertical_cover` | Partial pass |
| Sci-Fi after room isolation | `qa_scifi_after_room_isolation_density` | Partial pass |
| Sci-Fi after vertical cover | `qa_scifi_after_vertical_cover` | Partial pass |
| Cozy Cabin after room isolation | `qa_cabin_after_room_isolation_density` | Partial pass |
| Cozy Cabin after vertical cover | `qa_cabin_after_vertical_cover` | Partial pass |

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
- `qa_lobby_spawn_after_room_isolation` failed because the Sci-Fi room boundary
  crossed the lobby camera path and filled the view with a black wall.
- `qa_lobby_spawn_after_compact_labels` fixed the black-wall blocker and theme
  bleed, but the portal text still appears duplicated and the center composition
  is utilitarian rather than polished.

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

Progress:

- `Workspace.VisualPolish.RoomSignoffPolish` adds visible room shells, taller
  walls, foreground cover, set dressing, and portal facades.
- `qa_medieval_after_vertical_cover` now shows real cover clusters and market
  props, but the cover is still blocky and needs higher-quality asset
  replacement.
- `qa_scifi_after_vertical_cover` now has consoles, glowing cover, and clearer
  lab identity, but some tree bleed remains at the left edge and several cover
  blocks are visually heavy.
- `qa_cabin_after_vertical_cover` is the strongest room pass: cabin, NPCs,
  shrubs, logs, and wooden cover read as a playable camp area, though more
  quadrant coverage is still required.

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

Progress:

- Room boundary walls now block most cross-theme sightlines from player height.
- Lobby portal facades block the direct spawn view into the arenas.

Remaining issue:

- Sci-Fi still shows some tree/cabin bleed over or around the left wall in
  `qa_scifi_after_vertical_cover`.

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
- Added lobby portal facades, compact labels, and a sightline backdrop.
- Added `Workspace.VisualPolish.RoomSignoffPolish` with room boundary shells,
  foreground density, and taller cover clusters.
- Fixed a failed black-wall lobby screenshot by moving room north boundaries
  behind the lobby portal facades.

## New Validation Evidence

- `rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx` passed
  after room/session source changes.
- Studio console during fast local smoke showed:
  `Medieval Market -> Queue -> Intermission -> Hiding -> Hunting -> RoundEnd`.
- `qa_lobby_queue_medieval_after_sign_fix` confirms the lobby queue HUD is
  readable and the previous giant foreground sign no longer blocks the view.
- `qa_lobby_spawn_after_compact_labels` confirms the spawn view no longer shows
  off-theme room assets directly beyond the portals.
- `qa_medieval_after_vertical_cover`, `qa_scifi_after_vertical_cover`, and
  `qa_cabin_after_vertical_cover` confirm every current room has player-height
  cover and themed boundaries after the density pass.

## Current Verdict

Verdict remains **not signed off**.

The project is now much closer to a Roblox-standard playable prototype:
room/session logic works, lobby queue UI works, and all three room views have
some themed cover. It is not yet a final visual signoff because only one
player-height angle per room was recaptured after the vertical-cover pass, lobby
labels still need polish, Sci-Fi still has edge bleed, and the blocky placeholder
cover should be replaced or supplemented with inspected asset-backed props.

## Signoff Requirements Before Claiming Done

- At least one polished lobby screenshot from spawn.
- Player-height quadrant screenshots for every playable room.
- Before/after screenshot ids for every P1 fix.
- Live UI screenshots for lobby, queueing, active round, disguise prompt, and
  round end.
- No remaining P1 visual density, orientation, scale, navigation, or UI/UX
  issues.
