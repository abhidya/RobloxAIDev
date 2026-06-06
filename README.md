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
  planning for parallel `.rbxm` work packets, plus playable-space screenshot
  review gating and a batch Studio visual-gate contract. Decoupled from the
  Roblox Studio MCP. See
  [`asset-search-mcp/README.md`](asset-search-mcp/README.md).
- **`asset-brain/v1/`** — the merged cross-project asset brain. It folds
  metadata from the shared local MCP brain, EggBreakers, GroanTubeHero, and
  prior RobloxAIGameDev copies into one repo-visible snapshot. Regenerate it with
  `node scripts/merge_asset_brain_sources.mjs`.
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
cd asset-search-mcp && npm ci && npm test
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

## Local verification

The repo-side gate can be checked without opening Studio:

```bash
cd asset-search-mcp
npm ci
npm run demo:offline
npm test
npm run seed:prop-hunt-place1
npm run gate:prop-hunt
```

`npm run demo:offline` summarizes the checked-in `Place1.rbxl` audit fixture and
Rojo room config so reviewers can see the prop-hunt shape without Studio.
Studio is still required for live Creator Store insertion, geometry inspection,
player-height screenshots, and final playable-space signoff.

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
3. Walk onto a room portal to queue. While queued, use the HUD **Leave Queue**
   button or press **Q** to leave before the session starts.
4. In each client: walk near a prop and press **E** to disguise as it; seekers
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
Use `plan_coordinator_merge` or
`node asset-search-mcp/scripts/run-headless-coordinator.mjs` to run the same
merge contract through either the proven `lune` adapter or a configured
`rbx_dom` command.

For non-Prop-Hunt games, pass an assembly profile instead of accepting the
default room target. For GroanTubeHero / WorldV2 concert-defense arenas:

```json
{
  "project": "groan-tube-hero",
  "target_place": "GroanTubeHero.rbxl",
  "themes": ["volcano concert arena", "brainrot monster horde"],
  "assembly_profile": "concert_defense",
  "format": "json"
}
```

This emits WorldV2-oriented packets under `Workspace.GTH_WorldV2` and a Studio
gate that first confirms the active Studio instance is the target place.

For visual signoff, call `plan_playable_space_review`, capture the returned
Studio screenshot queue, log findings/fixes, then run
`validate_playable_space_review`. Missing player-height quadrants or unresolved
major/blocker issues mean the map is not signed off.

For lower-churn Studio proof, call `plan_batch_visual_gate` instead. It wraps a
playable-space plan with active-place preflight, deterministic camera moves,
`screen_capture` requests, screenshot collation paths, and a report template.
Run the resulting packet through a StudioMCP adapter, then call
`validate_batch_visual_gate` on the collated report. See
[`docs/batch-studio-visual-gate.md`](docs/batch-studio-visual-gate.md) and
[`docs/cross-project-asset-brain.md`](docs/cross-project-asset-brain.md).

For direct model acquisition before Studio insertion, call `plan_asset_delivery`
or run `node asset-search-mcp/scripts/run-asset-delivery.mjs --asset-id <id>`.
The adapter reads `ROBLOX_OPEN_CLOUD_API_KEY` or
`ROBLOX_OPEN_CLOUD_ACCESS_TOKEN`, writes bytes only under quarantine, and emits
a redacted receipt for `validate_asset_delivery_receipt`.

For the larger AI game-dev process, use
[`CONTEXT.md`](CONTEXT.md),
[`docs/roblox-ai-game-dev-architecture.md`](docs/roblox-ai-game-dev-architecture.md),
and [`prompts/`](prompts/) as the operator surface. The architecture keeps
Studio as the gated validator, compares Lune, rbx-dom, Rojo, Docker-wrapped
Studio, direct asset parsing, and Studio-first alternatives, and defines prompt
lanes for asset brain, curation, headless fragments, merge coordination,
gameplay implementation, visual proof, and release verification.

To start a new game skeleton with those gates already wired, use
`plan_project_template` or:

```bash
node asset-search-mcp/scripts/generate-project-template.mjs \
  --project dino-dash \
  --game "Dino Dash" \
  --theme "nursery grove" \
  --json
```

To refresh the local proof bundle for those claims:

```bash
node scripts/run_ai_game_dev_pocs.mjs
npm --prefix asset-search-mcp test
```

The POC runner writes a small metadata report to
[`docs/poc-results/ai-game-dev-poc-latest.json`](docs/poc-results/ai-game-dev-poc-latest.json)
and keeps generated Roblox binaries under ignored scratch paths.

Reusable game code now lives in
[`packages/roblox-game-kit`](packages/roblox-game-kit). Refresh the three-game
source inventory with:

```bash
node scripts/inventory_reusable_game_libraries.mjs
npm --prefix asset-search-mcp run test:game-kit
```

See [`docs/reusable-roblox-game-kit.md`](docs/reusable-roblox-game-kit.md) for
the cleanup plan, fallback classifications, module family map, and migration
order.

The top-level end-to-end game design loop is now a custom MCP contract:
`plan_ai_game_dev_loop` plans the asset-brain, GameKit, parser/writer,
headless-merge, world asset-family sweep, gated-Studio, and release-verification
phases, while
`validate_ai_game_dev_loop` validates the final proof bundle. See
[`docs/e2e-roblox-ai-game-design-loop.md`](docs/e2e-roblox-ai-game-design-loop.md).
The Studio batch wrappers have mock transports at
`asset-search-mcp/scripts/run-studio-world-asset-family-sweep.mjs` and
`asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs`; they consume
`plan_world_asset_family_sweep` / `plan_batch_visual_gate` packets and emit the
same collated proof bundles the future live Studio MCP adapter must emit.

If StudioMCP reports a different place than the one you opened, do not capture
screenshots. See
[`docs/studio-mcp-troubleshooting.md`](docs/studio-mcp-troubleshooting.md) for
the active-place recovery checklist.

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
