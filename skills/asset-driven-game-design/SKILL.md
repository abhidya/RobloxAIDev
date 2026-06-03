---
name: asset-driven-game-design
description: >-
  Turn a one-line game idea into a playable Roblox game whose world is built
  from real Creator Store assets — not hand-rolled parts. Use when the user asks
  to "build a game", "make a prop hunt / obby / tycoon / sim", "fill a map with
  assets", or wants AI to storyboard and assemble a Roblox experience with a
  lobby, NPCs, portals, upgrades, matchmaking, teams, and themed room sessions.
  Fans out parallel agents that explore, rank, curate, inspect, and review real
  assets, then bends the storyboard to what is buildable and assembles it in
  Studio.
---

# Asset-Driven Game Design

Build Roblox games where **the world is assembled from real Creator Store
assets**, discovered by ranked search, curated for diversity, and measured
before placement — never hand-modeled with `Instance.new("Part")` boxes.

## Golden rule: don't hand-roll the world

If you catch yourself writing `Instance.new("Part")` to represent a barrel, a
tree, a desk, or any *thing in the world*, STOP. Things in the world come from
the Creator Store via search. You only hand-write:

- **Game logic** (round system, scoring, state machine) — code, not content.
- **Structural geometry** (flat floors, invisible walls, spawn pads, zone
  triggers, queue pads, teleport volumes) — the stage, not the props.

Everything a player looks at or hides as is a **searched, curated, inspected,
placed asset**.

## Two decoupled MCP servers you orchestrate

| Server | Role | Key tools |
|--------|------|-----------|
| **asset-search-mcp** (this repo, standalone, search-only) | discover + curate + **shared memory** | `plan_game_asset_coverage`, `search_assets`, `curate_assets`, `claim_assets`, `reject_asset`, `review_asset`, `get_reviews`, `record_inspection`, `record_inspections`, `get_inspection`, `commit_palette`, `get_palette`, `validate_prop_hunt_gate` |
| **StudioMCP** (official, bundled in Roblox Studio) | build + measure | `insert_from_creator_store`, `run_code`/`execute_luau`, playtest tools |

`asset-search-mcp` is the advantage the official MCP lacks: ranked, multi-category
candidate lists with metadata, **cached and single-flighted** so parallel agents
are cheap, plus curation, a shared review cache, and a committed palette. It is
deliberately decoupled from Studio — geometric measurement (real size,
orientation) is done through StudioMCP, because that requires loading the asset.
After measurement, record those facts back into `asset-search-mcp` with
`record_inspection` or batched `record_inspections` so other agents can reuse the
evidence and the Prop Hunt gate can fail before a live build.

## Claude-history operating rules

This repo exists partly to bottle hard-won lessons from prior Roblox MCP work:

- Keep search/discovery separate from Studio build/measurement.
- Treat Studio actions as serial and leader-owned; do not trust subagent claims
  that a live Studio test passed.
- Insert Creator Store assets in edit mode, not play mode.
- Use asset names or snapshot diffs to locate inserted models.
- Persist measured facts, rejections, claims, and palette choices so parallel
  agents do not redo the same fragile work.

## The two tiers of metadata

| Tier | Source | Cost | Examples |
|------|--------|------|----------|
| **Catalog** | `asset-search-mcp` (Toolbox API) | cheap, network | votes, creator, verified, script/mesh counts, triangles, category |
| **Geometric** | `StudioMCP` (load + measure in Studio) | expensive | bounding-box size (studs), orientation, anchored?, missing textures, issues |

Size/scale/orientation are **not** in the catalog. Search + curate cheaply to a
shortlist, then measure only the shortlist in Studio before placing.

## Generic Roblox game shell

Do not treat a Roblox game as "three worlds on a baseplate." Build the reusable
shell first, then plug asset-built rooms into it.

Required shell elements:

- **Lobby spawn**: players start at a `SpawnLocation` in a social lobby.
- **NPCs**: guide, upgrades, cosmetics, and room hosts use ProximityPrompt or
  ClickDetector; the visible NPCs come from searched assets.
- **Portals/queues**: each room has a portal or queue pad with min players, max
  players, fill timer, status display, and leave behavior.
- **Room sessions**: a session owns its players, team assignment, room spawns,
  phase state, scoring, and return-to-lobby teleport.
- **Teams**: assign seekers/hiders or game-specific teams per session, not
  globally across all players in the server.
- **Upgrades/cosmetics**: buy or preview in the lobby; avoid gameplay advantage
  claims unless implemented and tested.
- **Expandable rooms**: underwater, space station, haunted mansion, jungle
  temple, or any new theme starts as asset coverage, not a hard-coded idea.

Each room config should have at least:

```
id, display_name, theme, min_players, max_players, fill_seconds,
teams, lobby_portal, room_spawn_folder, hideable_folder, palette_project
```

## Room dreaming from assets

Before searching individual props, call:

```
plan_game_asset_coverage(game="party prop hunt", themes=["underwater reef","space station"])
```

This returns search slots for the persistent lobby plus each candidate room:
arena shell, portal, NPC host, setpiece anchor, hideable prop pack, small props,
avatar/form, and ambience. Feed those slots into `curate_assets`. If the search
finds a strong "coral reef + fish morph + sea cave" pack, make an underwater
room where players are fish and hide as coral. If it finds a stronger space
station pack than an exact "social deduction ship" pack, bend the room toward
the asset reality.

## Workflow

### 1. Coverage first: shell + rooms
From the prompt, write a short brief and call `plan_game_asset_coverage` to cover
the Roblox shell and expandable room packs. Then break the chosen game into
**lobby slots** and **room slots**. A slot is one concrete thing to find.

```
lobby:
  [ spawn_plaza, room_queue_portal, guide_npc, upgrade_shop, leaderboard ]
rooms:
  underwater_reef: [ coral_cave, coral_props, fish_morph, reef_ambience ]
  space_station:   [ reactor_room, crate_props, astronaut_morph, alarm_loop ]
  cozy_cabin:      [ fireplace, bookshelf, chair_props, cabin_host ]
```

### 2. Fan out — parallel agents that don't collide
Spawn agents in parallel (Agent tool, multiple in one message), one per world or
slot-group. The `asset-search-mcp` is a **shared brain**: searches are cached,
rejections and claims are visible to everyone, so agents never re-find,
re-preview, or re-reject the same item. Each agent runs this loop:

1. `curate_assets(slots=[{slot, query, exclude_terms}], per_slot=5, extensive=true)`
   — one call returns a diversity-capped shortlist per slot. It **auto-excludes**
   assets other agents already rejected or claimed, applies `exclude_terms` to
   drop off-theme names (e.g. `["palm","tropical","sci-fi"]` in a medieval world),
   and never suggests one asset for two slots.
2. `claim_assets(project, slot, asset_ids, reviewer)` on the shortlist **before
   inspecting** — this reserves them so peers' curate calls skip them. No two
   agents preview the same asset.
3. **Inspect the shortlist in Studio** via StudioMCP: load each (`GetObjects` /
   `LoadAsset`), read `GetBoundingBox()` for size/orientation, count parts/scripts,
   check anchored and PrimaryPart readiness, then destroy. Immediately call
   `record_inspection(asset_id, slot, size_studs, has_scripts, script_count,
   base_part_count, anchored_capable, primary_part, issues)`.
4. `reject_asset(asset_id, reason)` for anything disqualified (oversized/tiny,
   stray scripts, no BaseParts, untextured, off-theme). The veto is **shared** —
   it vanishes from every other agent's results immediately.
5. Pick the best survivor and `commit_palette(project, slot, asset_id, name)`
   (which also claims it). Use `get_reviews(asset_id)` anytime to see prior
   verdicts before spending an inspection.

Because curate/claim/reject all read and write one shared store, the agents fan
their effort together instead of duplicating it — the more agents, the less
redundant work, not more.

### 3. Fan in — let assets reshape the design
Read the committed palette (`get_palette`). **Bend the storyboard to what is
buildable.** If no good "crypt" exists but "mausoleum" assets are excellent,
rename the area. The design serves the assets, not the other way around.

Room approval rule: a room is buildable only when the asset set covers a readable
arena, enough hideables/interactive props, a portal/lobby affordance, and at
least one role/form/NPC/ambience cue that makes the theme legible.

### 4. Build in Studio (StudioMCP)
0. Run `validate_prop_hunt_gate(project="prophunt")`. Do not start the live
   Studio build until the asset palette passes the repo-side gate, or until the
   failure is explicitly documented as the current blocker. From a shell, the
   same check is `cd asset-search-mcp && npm run gate:prop-hunt`. If the local
   asset-brain store is empty for the shipped `Place1.rbxl`, seed the recovered
   Studio audit first with `npm run seed:prop-hunt-place1`.
1. Build the **stage** with `execute_luau`: lobby SpawnLocation, structural
   floors, invisible walls, queue pads, portals, room spawn folders, and zone
   trigger parts (CanCollide off, Transparency 1).
2. For each committed slot, insert the asset **by id** and seat it on the floor
   using its measured bounding box: `PivotTo(CFrame.new(x, floorY + size.Y/2, z))`.
   Scale only if the measured size is wrong.
3. Scatter prop instances with small random rotation/position jitter; `:Clone()`
   the inserted asset for repeats instead of re-inserting.
4. Register room metadata in code: portal id, min/max players, teams, spawn
   folder, hideable folder, and palette project.

### 5. Wire game logic + playtest
Wire lobby/session logic before declaring the game playable:

1. Players spawn in lobby.
2. Portal/NPC interaction joins a room queue.
3. Queue fills until `min_players` or timer, caps at `max_players`, then creates
   a session.
4. Session assigns teams, teleports only queued players into the room, runs the
   game loop, scores, cleans disguises/effects, and returns players to lobby.
5. Playtest with StudioMCP and confirm no asset-load errors, no global-round
   leakage, and clean return-to-lobby behavior.

## Placement math

After measuring `size = boundingBox.ExtentsSize`:

- **Sit on floor:** `y = floorY + size.Y/2`.
- **Scale guard:** if `size.Magnitude > 200` or `< 0.5`, rescale via
  `model:ScaleTo(target / size.Magnitude)`.
- **Face the path:** most Creator Store props face +Z; rotate to suit.

## Prop-hunt recipe (the validation gate)

A prop hunt is the gate that proves the whole pipeline end to end:

1. A playable lobby plus at least one capacity-limited Prop Hunt room. The
   shipped gate uses 3 contrasting room themes (medieval market, sci-fi lab,
   cozy cabin); future gates can add underwater reef, space station, or other
   asset-supported rooms.
2. Palette slots named as `area.hideable.name` or `area.setpiece.name`; the
   default repo gate expects 20+ hideables and 4+ set pieces across 3 areas.
   For a stricter production pass, raise this to ~6 set pieces + ~10 hideable
   props per area.
3. Hideable props must be **single-model, 1–8 studs, anchored-capable,
   PrimaryPart-ready, script-free** — enforce in the inspect/reject step and
   record via `record_inspection` (these become disguises).
4. Register every placed prop Model (with a `PrimaryPart`) into
   `Workspace.HideableProps`, which the round logic reads.
5. Room loop: queue, teleport, timer, assign seekers, hiders disguise as a
   nearby prop, seekers tag, scoring, return to lobby, repeat.

## Efficiency rules

- Parallelize slot agents; the shared search/review/palette cache makes it cheap.
- Use `extensive=true` for exploration, `verified_only=true` for hideable props.
- Insert each asset once, then `:Clone()` for repeats.
- Reuse committed palette ids across rebuilds so you don't re-search.

## Definition of done

- Players spawn into a lobby with asset-backed NPCs, portals/queues, and upgrade
  or cosmetic affordances.
- At least one capacity-limited room session works end to end; production gates
  should support multiple room definitions even if only one room is active.
- 3+ visually distinct room themes or one polished room plus asset coverage for
  the next rooms, each built from real assets (zero placeholder parts for props).
- Every placed prop was inspected (known size, no rejected issues) and the best
  pick committed to the palette.
- Room-scoped hideable folders are populated with valid disguise models.
- Matchmaking, team assignment, teleport-in, round loop, scoring, and
  return-to-lobby run start→finish in playtest with no asset-load errors.
- Run the repo-local `roblox-playable-space-review` signoff skill before final
  delivery. Aerial screenshots and console logs are not enough; playable areas
  must pass player-height quadrant review for theme, density, orientation,
  scale, navigation, and UI/UX.
