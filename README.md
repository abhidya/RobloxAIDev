# RobloxAIDev

Asset-driven Roblox game generation: turn a one-line game idea into a playable
game whose world is **assembled from real Creator Store assets**, not hand-rolled
parts. Parallel agents explore, rank, curate, inspect, and review assets; the
storyboard bends to what's buildable; then it's assembled in Studio. **Prop hunt
is the validation gate** that proves the pipeline end to end.

## Pieces

- **`asset-search-mcp/`** — a standalone, search-only MCP (Node): ranked Creator
  Store discovery, search caching + single-flight, extensive query expansion,
  per-slot curation, a shared review cache, Studio inspection memory, a committed
  palette, the repo-side Prop Hunt asset gate, and headless fragment assembly
  planning for parallel `.rbxm` work packets. Decoupled from the Roblox Studio
  MCP. See [`asset-search-mcp/README.md`](asset-search-mcp/README.md).
- **`skills/asset-driven-game-design/`** — the Claude skill that orchestrates the
  two MCPs (this search MCP for discovery, the official StudioMCP for building +
  geometric measurement) using a parallel fan-out / fan-in workflow.
- **`Place1.rbxl`** — the Studio place used as the build target / validation gate.

The Roblox Studio Rust MCP lives in its own repo and is intentionally **not**
tracked here (see `.gitignore`); it's referenced as the build/measure server.

## Architecture in one line

> Official StudioMCP builds + measures in Studio · `asset-search-mcp` finds,
> ranks, curates, and remembers assets · the skill orchestrates both · parallel
> agents share one cache so exploration is broad but cheap.

## Quick start (on your Mac)

```bash
# 1. The search MCP
cd asset-search-mcp && npm install && npm test
claude mcp add --transport stdio asset-search -- node "$(pwd)/src/index.js"

# 2. Make the skill available
mkdir -p ~/.claude/skills
cp -R "$(pwd)/../skills/asset-driven-game-design" ~/.claude/skills/

# 3. Open Roblox Studio (official StudioMCP live), then in Claude Code:
#    /asset-driven-game-design build a 3-theme prop hunt
#      (medieval market, sci-fi lab, cozy cabin)

# Optional source sync for the Prop Hunt logic
rojo serve --address 127.0.0.1 --port 34872
```

## Play the prop hunt (the validation gate)

`Place1.rbxl` contains a 3-theme prop hunt assembled entirely from real Creator
Store assets by the skill: **20 hideable props + 4 set pieces** across a Medieval
Market, a Sci-Fi Lab, and a Cozy Cabin, plus the round logic in
ServerScriptService / ReplicatedStorage / StarterPlayerScripts.

The game logic is now source-controlled through Rojo:

- `default.project.json`
- `src/server/init.server.luau`
- `src/shared/Config.luau`
- `src/shared/Remotes.luau`
- `src/client/init.client.luau`

Prop hunt needs **2+ players**, so to actually play a round:

1. Open `Place1.rbxl` in Studio.
2. In the **Test** tab, set **Clients** to 2 and **Server**, then click **Start**
   (Local Server). Two windows spawn.
3. In each client: walk near a prop and press **E** to disguise as it; seekers
   tag hiders. The HUD shows the current phase.

To **solo-test the loop** instead, set `Config.DEBUG_SOLO = true` in
`ReplicatedStorage.PropHunt.Config`, then press **Play**. For a very fast smoke
run, also set `Config.DEBUG_FAST_TIMINGS = true` — the loop cycles
Intermission → Hiding → Hunting → RoundEnd in seconds (watch the Output for
`[PropHunt] phase -> ...`). Keep both flags `false` for normal play.

Rebuild or extend the world anytime with the skill (Studio open, both MCPs
connected):

```
/asset-driven-game-design build a 3-theme prop hunt
  (medieval market, sci-fi lab, cozy cabin)
```

Before spending a live Studio pass, use the MCP's repo-side gate:

1. Commit selected slots with names like `medieval_market.hideable.barrel` or
   `sci_fi_lab.setpiece.console_bank`.
2. Measure the shortlist in StudioMCP and store those facts with
   `record_inspection`.
3. Run `validate_prop_hunt_gate(project: "prophunt")`.

The default gate expects 3 areas, 20 hideable props, 4 set pieces, and inspected
hideables that are script-free, anchored-capable, PrimaryPart-ready, and 1-8
studs. The same check is available from the shell with
`cd asset-search-mcp && npm run gate:prop-hunt`. If the local asset-brain store
is empty, seed it from the audited `Place1.rbxl` fixture first with
`npm run seed:prop-hunt-place1`. See
[`docs/prop-hunt-gate.md`](docs/prop-hunt-gate.md).

For parallel headless assembly, call `plan_headless_assembly` to generate lobby
and room fragment packets, then reject every fragment manifest that fails
`validate_fragment_manifest` before merge. This keeps referent remapping,
`UniqueId`/`HistoryId` stripping, parent assignment, and risky script screening
owned by the coordinator instead of scattered across agents.

For the next parallelization step, see
[`docs/headless-roblox-file-pipeline.md`](docs/headless-roblox-file-pipeline.md):
it documents the no-Studio `.rbxl`/`.rbxm` mutation POC, referent-safe fragment
merge contract, Creator Store search/download path, pricing/licensing notes, and
Open Cloud publish flow.

## Checking work in

This repo is pushed from your Mac (the build sandbox has no push credentials).
The nested Studio Rust MCP is gitignored, so it won't be committed as a subrepo:

```bash
git add .gitignore README.md asset-search-mcp skills
git commit -m "Add standalone asset-search MCP + asset-driven skill"
git push origin main
```
