---
name: roblox-playable-space-review
description: Review and sign off Roblox playable spaces quadrant by quadrant using Studio screenshots, player-height camera checks, orientation/scale/playability fixes, and UI/UX evidence. Use after building or modifying a Roblox map, lobby, room, prop hunt arena, obby, tycoon, simulator zone, or asset-driven game before claiming it is playable, pretty, polished, or ready.
---

# Roblox Playable Space Review

Use this skill to stop "console green" from becoming a false finish. A Roblox
game is not signed off until every playable area has been inspected from
player-relevant viewpoints, visual defects are fixed or logged, and UI/UX has
been reviewed in play mode.

## Non-negotiables

- No signoff from console logs alone.
- No signoff from one aerial screenshot.
- No signoff when any playable area is sparse, flat, misoriented, blocked,
  illegible, or missing player guidance.
- Screenshots must include player-height views, not only editor-overview views.
- If a screenshot exposes a blocker, fix it and recapture the same view.

## Inputs

Collect or infer:

- Playable spaces: lobby, queues, portals, themed rooms, round arenas, shops,
  tutorial areas, and return-to-lobby paths.
- Bounds for each space from `Workspace` folders, region parts, or model
  bounding boxes.
- Intended player path: spawn -> NPC/portal -> queue -> room -> active round ->
  reward/return.
- Active UI/HUD states: lobby, queueing, round, role/team, interaction prompt,
  error/empty states, and reward/score states.

When `asset-search-mcp` is available, begin with:

```
plan_playable_space_review(project="prophunt")
```

Use the returned capture queue as the minimum screenshot set. After fixes and
recaptures, submit the report to:

```
validate_playable_space_review(report={...}, plan={...})
```

Do not sign off while that validator fails.

## Quadrant Workflow

For each playable space:

1. **Map the bounds** with StudioMCP `execute_luau`: list folders/models,
   bounding boxes, spawn points, portals, NPCs, and hideable/interactable props.
2. **Divide the space** into quadrants or smaller cells. Use NW/NE/SW/SE for
   rectangular spaces; split further when an area is large or has separate rooms.
3. **Capture views** sequentially with StudioMCP `screen_capture`:
   - one overhead orientation shot,
   - one entry-path shot,
   - one player-height shot per quadrant looking toward the center,
   - one reverse shot looking back toward the entry,
   - play-mode HUD screenshots for every major state.
4. **Review each screenshot** with the rubric below.
5. **Fix defects** in Studio/source/asset selection.
6. **Recapture the same view** after fixing.
7. **Log signoff** with screenshot ids, findings, fixes, and remaining risks.

Do not run screenshots in large parallel batches. Studio capture can time out;
capture sequentially and keep camera positions clear of nearby geometry.

## Visual Rubric

Mark each item `pass`, `fix`, or `blocker`.

- **Theme accuracy**: the area reads as its promised theme from player level.
- **Asset density**: no large flat sparse areas unless intentionally used for a
  queue, spawn, or combat lane.
- **Orientation**: assets face useful directions; signs, portals, NPCs, props,
  and setpieces are not sideways, backwards, buried, floating, or clipped.
- **Scale**: props are player-scaled; hideables are believable; setpieces do not
  block core sightlines or camera movement by accident.
- **Navigation**: player can see where to go next; paths have landmarks; portals
  and rooms are discoverable.
- **Collision/playability**: no stuck spots, unwalkable entry points, accidental
  barriers, or camera-filling objects on normal routes.
- **Hide-and-seek quality**: prop hunt rooms have varied cover, plausible
  disguise props, seeker sightlines, hider routes, and no unfair empty fields.
- **Multiplayer flow**: room limits, queues, team states, spawn separation, and
  return-to-lobby are visible or testable.
- **UI/UX**: HUD text is readable, prompts are contextual, role/team/score/timer
  states are clear, and UI does not overlap gameplay.
- **Performance/safety**: excessive part counts, scripts in imported assets,
  unanchored props, and expensive clutter are flagged.

## Fix Guidance

- Sparse area: search/curate additional asset packs; add landmarks, cover,
  route framing, and props that match the theme.
- Bad orientation: rotate/pivot assets toward paths, portals, or focal points;
  assign PrimaryPart before placement where needed.
- Bad scale: measure bounding boxes, rescale only after inspection, and recapture
  near the player for comparison.
- Bad room readability: add asset-backed entrance markers, NPC hosts, signs, and
  lighting/color contrast.
- Bad UI: simplify labels, move HUD away from action, increase contrast, and
  verify at player resolution in play mode.
- Global-round leakage: fix code so room/session state is scoped to queued
  players only.

## Signoff Output

A valid signoff report includes:

- Playable spaces reviewed.
- Screenshot ids per space/quadrant/state.
- Findings ordered by severity with exact locations.
- Fixes applied and recaptured screenshot ids.
- Remaining risks and why they do not block the current milestone.
- Clear verdict: `signed off`, `signed off with risks`, or `not signed off`.

If any P0/P1 visual or playability issue remains, verdict is `not signed off`.
