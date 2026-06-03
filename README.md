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
  palette, and the repo-side Prop Hunt asset gate. Decoupled from the Roblox
  Studio MCP. See [`asset-search-mcp/README.md`](asset-search-mcp/README.md).
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
```

## Play the prop hunt (the validation gate)

`Place1.rbxl` contains a 3-theme prop hunt assembled entirely from real Creator
Store assets by the skill: **20 hideable props + 4 set pieces** across a Medieval
Market, a Sci-Fi Lab, and a Cozy Cabin, plus the round logic in
ServerScriptService / ReplicatedStorage / StarterPlayerScripts.

Prop hunt needs **2+ players**, so to actually play a round:

1. Open `Place1.rbxl` in Studio.
2. In the **Test** tab, set **Clients** to 2 and **Server**, then click **Start**
   (Local Server). Two windows spawn.
3. In each client: walk near a prop and press **E** to disguise as it; seekers
   tag hiders. The HUD shows the current phase.

To **solo-test the loop** instead, set `Config.MIN_PLAYERS = 1` in
`ReplicatedStorage.PropHunt.Config` and press **Play** — one round cycles
Intermission → Hiding → Hunting → RoundEnd (watch the Output for
`[PropHunt] phase -> ...`).

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
`cd asset-search-mcp && npm run gate:prop-hunt`. See
[`docs/prop-hunt-gate.md`](docs/prop-hunt-gate.md).

## Checking work in

This repo is pushed from your Mac (the build sandbox has no push credentials).
The nested Studio Rust MCP is gitignored, so it won't be committed as a subrepo:

```bash
git add .gitignore README.md asset-search-mcp skills
git commit -m "Add standalone asset-search MCP + asset-driven skill"
git push origin main
```
