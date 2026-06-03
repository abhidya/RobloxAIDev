---
name: asset-driven-game-design
description: >-
  Turn a one-line game idea into a playable Roblox game whose world is built
  from real Creator Store assets — not hand-rolled parts. Use when the user asks
  to "build a game", "make a prop hunt / obby / tycoon / sim", "fill a map with
  assets", or wants AI to storyboard and assemble a Roblox experience. Fans out
  parallel agents that explore, rank, curate, inspect, and review real assets,
  then bends the storyboard to what is buildable and assembles it in Studio.
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
  triggers) — the stage, not the props.

Everything a player looks at or hides as is a **searched, curated, inspected,
placed asset**.

## Two decoupled MCP servers you orchestrate

| Server | Role | Key tools |
|--------|------|-----------|
| **asset-search-mcp** (this repo, standalone, search-only) | discover + curate + remember | `search_assets`, `curate_assets`, `review_asset`, `get_reviews`, `commit_palette`, `get_palette` |
| **StudioMCP** (official, bundled in Roblox Studio) | build + measure | `insert_from_creator_store`, `run_code`/`execute_luau`, playtest tools |

`asset-search-mcp` is the advantage the official MCP lacks: ranked, multi-category
candidate lists with metadata, **cached and single-flighted** so parallel agents
are cheap, plus curation, a shared review cache, and a committed palette. It is
deliberately decoupled from Studio — geometric measurement (real size,
orientation) is done through StudioMCP, because that requires loading the asset.

## The two tiers of metadata

| Tier | Source | Cost | Examples |
|------|--------|------|----------|
| **Catalog** | `asset-search-mcp` (Toolbox API) | cheap, network | votes, creator, verified, script/mesh counts, triangles, category |
| **Geometric** | `StudioMCP` (load + measure in Studio) | expensive | bounding-box size (studs), orientation, anchored?, missing textures, issues |

Size/scale/orientation are **not** in the catalog. Search + curate cheaply to a
shortlist, then measure only the shortlist in Studio before placing.

## Workflow

### 1. Storyboard into slots
From the prompt, write a short brief and break the world into **themed areas**,
each into **asset slots**. A slot is one concrete thing to find.

```
areas:
  medieval_market: [ market_stall, barrel, crate, hay_bale, basket ]
  sci_fi_lab:      [ console, storage_crate, canister, robot, monitor ]
  cozy_cabin:      [ fireplace, bookshelf, wooden_chair, lamp, log ]
ambience: [ ambient_loop, footstep_sfx ]
```

### 2. Fan out — parallel agents that EXPLORE well
Spawn agents in parallel (Agent tool, multiple in one message), one per slot or
slot-group. Each agent must explore broadly, not grab the first hit:

1. `search_assets(query="<slot> <theme>", extensive=true, max_results=12)` —
   `extensive` expands the query into variants (prop/pack/low poly/realistic/
   model) and merges them, so you discover assets a single shallow query misses.
2. Or `curate_assets(slots=[{slot, query}, ...], per_slot=5, extensive=true)` to
   get a diversity-capped shortlist per slot in one call (no single creator's
   pack dominating).
3. **Inspect the shortlist in Studio** via StudioMCP: load each candidate
   (`InsertService:LoadAsset`), read `GetBoundingBox()` for size/orientation,
   count parts/scripts, check `Anchored`, then `:Destroy()`.
4. **Reject** disqualifying issues: oversized/tiny scale, unexpected
   `Script`/`LocalScript`, no BaseParts, absurd footprint.
5. `review_asset(asset_id, verdict, slot, notes)` — persist the verdict so other
   agents reuse it instead of re-vetting (the cache is shared across agents).
6. Pick the best survivor and `commit_palette(project, slot, asset_id, name)`.

Because search results, reviews, and the palette are cached server-side,
parallel agents share each other's work: the cache fans their effort together
instead of duplicating searches and inspections.

### 3. Fan in — let assets reshape the design
Read the committed palette (`get_palette`). **Bend the storyboard to what is
buildable.** If no good "crypt" exists but "mausoleum" assets are excellent,
rename the area. The design serves the assets, not the other way around.

### 4. Build in Studio (StudioMCP)
1. Build the **stage** with `execute_luau`: flat floors per area, invisible
   walls, spawn pads, zone trigger parts (CanCollide off, Transparency 1).
2. For each committed slot, insert the asset **by id** and seat it on the floor
   using its measured bounding box: `PivotTo(CFrame.new(x, floorY + size.Y/2, z))`.
   Scale only if the measured size is wrong.
3. Scatter prop instances with small random rotation/position jitter; `:Clone()`
   the inserted asset for repeats instead of re-inserting.

### 5. Wire game logic + playtest
Copy the hand-written game logic (e.g. `examples/prop-hunt`), point it at the
asset-built world, then playtest with StudioMCP and confirm the loop runs with
no asset-load errors. Fix placement and re-run.

## Placement math

After measuring `size = boundingBox.ExtentsSize`:

- **Sit on floor:** `y = floorY + size.Y/2`.
- **Scale guard:** if `size.Magnitude > 200` or `< 0.5`, rescale via
  `model:ScaleTo(target / size.Magnitude)`.
- **Face the path:** most Creator Store props face +Z; rotate to suit.

## Prop-hunt recipe (the validation gate)

A prop hunt is the gate that proves the whole pipeline end to end:

1. 3 contrasting themes so areas look different (medieval market, sci-fi lab,
   cozy cabin).
2. ~6 set pieces + ~10 hideable props per area, all from search + curation.
3. Hideable props must be **single-model, 1–8 studs, anchored-capable,
   script-free** — enforce in the inspect/reject step (these become disguises).
4. Register every placed prop Model (with a `PrimaryPart`) into
   `Workspace.HideableProps`, which the round logic reads.
5. Round loop: timer, assign seekers, hiders disguise as a nearby prop, seekers
   tag, scoring, repeat.

## Efficiency rules

- Parallelize slot agents; the shared search/review/palette cache makes it cheap.
- Use `extensive=true` for exploration, `verified_only=true` for hideable props.
- Insert each asset once, then `:Clone()` for repeats.
- Reuse committed palette ids across rebuilds so you don't re-search.

## Definition of done

- 3+ visually distinct areas, each built from real assets (zero placeholder
  parts for props).
- Every placed prop was inspected (known size, no rejected issues) and the best
  pick committed to the palette.
- A `HideableProps` folder populated with valid disguise models.
- Round loop runs start→finish in playtest with no asset-load errors.
