# asset-search-mcp

A standalone, **search-only** MCP for asset-driven Roblox game design — fully
decoupled from the Roblox Studio MCP. It discovers, ranks, curates, reviews, and
remembers Creator Store assets so an AI can storyboard a game grounded in assets
that actually exist, with parallel agents exploring cheaply.

Building and placing assets, and measuring their real geometry, are the official
**StudioMCP**'s job. This server never touches Studio. The
`asset-driven-game-design` skill orchestrates the two together. For heavier
parallel builds, it also emits a headless fragment plan so agents can produce
`.rbxm` subtrees and manifests that a coordinator can merge safely before the
final Studio visual pass.

## Why it exists

The official Studio MCP can *insert* a Creator Store asset but has no ranked
**discovery**. This server adds exactly that, plus the shared state parallel
agents need:

- **`search_assets`** — ranked, multi-category Toolbox v2 search with vote/creator/
  script/mesh metadata and ids. `extensive=true` expands the query into variants
  for broader exploration.
- **`plan_game_asset_coverage`** — turns a Roblox game idea into search slots for
  lobby spawn, NPCs, portals, upgrade/cosmetic surfaces, and themed room packs.
- **`preprocess_storyboard_asset_cache`** — turns coverage slots into a bounded
  cache-warming/storyboard input plan, optionally running searches before any
  Studio work.
- **`export_asset_brain_snapshot`** — emits a compact GitHub Pages-friendly
  metadata snapshot with palettes, reviews, inspections, visual risk, and capped
  query summaries.
- **Cache + single-flight** — results are cached (24h) and identical concurrent
  searches collapse to one network call, so N parallel agents are cheap.
- **`curate_assets`** — a storyboard's slots → a diversity-capped shortlist per
  slot (no single creator's pack dominating).
- **`review_asset` / `get_reviews`** — persist an agent's keep/reject verdict so
  other agents reuse it instead of re-vetting.
- **`record_inspection` / `record_inspections` / `get_inspection`** — persist StudioMCP-measured
  geometry, safety facts, and player-angle visual risk without coupling this
  server to Studio.
- **`commit_palette` / `get_palette`** — freeze the chosen asset per slot for the
  build phase.
- **`validate_prop_hunt_gate`** — validate the committed Prop Hunt asset palette
  before a live Studio build/playtest.
- **`plan_headless_assembly` / `validate_fragment_manifest`** — define and check
  referent-safe `.rbxm` fragment packets for parallel headless place assembly.
- **`plan_playable_space_review` / `validate_playable_space_review`** — plan
  and enforce the player-height screenshot gate for lobby, rooms, UI states, and
  unresolved visual blockers, including scoped asset-fix passes.

State persists as plain JSON under `~/.roblox-asset-brain/` — no native deps, no
build step.

## Install & run (on your Mac)

```bash
cd asset-search-mcp
npm install
npm test            # offline logic test + live MCP smoke test
```

Register it with Claude Code (alongside the official StudioMCP):

```bash
claude mcp add --transport stdio asset-search -- node "$(pwd)/src/index.js"
claude mcp list     # confirm asset-search + StudioMCP both connected
```

Or run it directly: `node src/index.js` (speaks MCP over stdio).

## Tools

| Tool | Purpose |
|------|---------|
| `plan_game_asset_coverage(game?, themes?, include_defaults?, include_lobby?, max_themes?, format?)` | Generate lobby/session/room asset search coverage before curation. |
| `preprocess_storyboard_asset_cache(project?, game?, themes?, include_defaults?, include_lobby?, max_themes?, max_slots?, warm_search_cache?, per_slot?, verified_only?, extensive?, format?)` | Build storyboard-ready coverage slots, optionally warm ranked search cache, and return Pages-friendly metadata layout. |
| `export_asset_brain_snapshot(project?, include_search_cache?, max_queries?, max_results_per_query?, format?)` | Export small metadata-only snapshot for GitHub Pages or handoff; no binaries/screenshots. |
| `plan_headless_assembly(project?, target_place?, themes?, include_lobby?, max_fragments?, format?)` | Generate parallel headless fragment packets, merge contract, endpoints, Rojo/Lune validation commands, and Studio visual gate. |
| `validate_fragment_manifest(manifest, format?)` | Reject unsafe or under-specified `.rbxm` fragment manifests before coordinator merge. |
| `plan_playable_space_review(project?, review_mode?, spaces?, include_defaults?, format?)` | Generate the required Studio screenshot queue for lobby/room quadrant review and UI states. `review_mode="player_angle"` emits only player-height quadrant shots for scoped asset-fix passes. |
| `validate_playable_space_review(report, plan?, format?)` | Fail visual signoff reports that skip spaces, player-height quadrants, required screenshot kinds, or unresolved major/blocker findings. A supplied custom plan is authoritative; otherwise custom/scoped reports are inferred before the default Prop Hunt plan is used. |
| `search_assets(query, max_results?, categories?, verified_only?, extensive?, exclude_terms?, exclude_rejected?, exclude_claimed?, exclude_ids?)` | Ranked search; auto-hides rejected/claimed; `exclude_terms` drops off-theme names; results annotated with prior verdicts/claims. |
| `curate_assets(slots[], per_slot?, verified_only?, extensive?, exclude_terms?, exclude_claimed?)` | Diverse shortlist per slot; excludes rejected + claimed; no asset suggested for two slots. |
| `claim_assets(project, slot, asset_ids[], reviewer?)` | Reserve assets to a slot so other agents' results hide them — prevents collisions. |
| `reject_asset(asset_id, reason, slot?, reviewer?)` | Shared veto: the asset is auto-excluded from every agent's future results. |
| `review_asset(asset_id, verdict, slot?, rating?, notes?, reviewer?)` | Persist a shared verdict (`reject` auto-excludes). |
| `get_reviews(asset_id)` | Read all verdicts + claim status for an asset. |
| `record_inspection(asset_id, slot?, size_studs?, has_scripts?, script_count?, base_part_count?, anchored_capable?, primary_part?, issues?, visual_risks?, visual_risk_score?, screenshot_verdict?, reviewer?, source?)` | Store the latest StudioMCP-measured and player-angle visual facts for an asset. |
| `record_inspections(inspections[])` | Store many StudioMCP inspection records in one call after a live palette audit. |
| `get_inspection(asset_id)` | Read the latest persisted Studio inspection for an asset. |
| `commit_palette(project, slot, asset_id, name?)` | Freeze a chosen asset per slot (also claims it). |
| `get_palette(project)` | Read the committed palette for the build phase. |
| `validate_prop_hunt_gate(project?, min_areas?, min_hideable_total?, min_setpiece_total?, min_hideable_per_area?, min_setpiece_per_area?, min_hideable_studs?, max_hideable_studs?, require_inspections?, require_primary_part?, format?)` | Check the committed Prop Hunt palette before Studio build. |

### How it prevents multi-agent collisions

Parallel agents share one persistent store. The loop: `curate_assets` (already
filtered) → `claim_assets` the shortlist (peers now skip it) → inspect in Studio
→ `reject_asset` the duds (shared veto) → `commit_palette` the winner. Because
every call reads and writes the same rejection/claim memory, more agents means
*less* redundant searching, previewing, and rejecting — not more.

## Tiers of metadata

| Tier | Source | Examples |
|------|--------|----------|
| Catalog (this server) | Toolbox v2 API | votes, creator, verified, script/mesh counts, triangles |
| Geometric (StudioMCP) | load + measure in Studio | bounding-box size, orientation, anchored?, issues |
| Visual (Studio screenshots) | player-height camera review | floating/buried/misoriented props, sparse lanes, camera occlusion, off-theme or legacy filler |

Catalog search is cheap; narrow to a shortlist here, then measure only the
shortlist in Studio before placing. Store those measured facts with
`record_inspection`. After screenshot review, include `visual_risks`,
`visual_risk_score`, and `screenshot_verdict` so future agents can reject,
replace, or recapture known-bad assets without rediscovering the same problem.

## Game coverage planning

Use `plan_game_asset_coverage` before curation whenever the skill is building or
expanding a Roblox game. It gives the skill generic Roblox coverage instead of a
single arena list:

- lobby spawn/plaza
- NPC guide, room hosts, upgrade shop, cosmetics, leaderboard
- portal and room queue affordances
- themed room shells, setpieces, hideable prop packs, avatar/forms, ambience

Example:

```text
plan_game_asset_coverage(
  game: "party prop hunt",
  themes: ["underwater reef", "space station"],
  include_defaults: true
)
```

Feed the returned slots into `curate_assets(..., extensive=true)`, claim the
shortlists, inspect in Studio, then commit the best assets to the palette.

For cache-first storyboarding, call `preprocess_storyboard_asset_cache` first.
Use `warm_search_cache=true` only when you want the MCP to actually run the
bounded search set; otherwise it returns the slot/cache plan without network
work. Storyboards should reference cached candidates and committed palette
assets, not invented placeholders.

Use `export_asset_brain_snapshot(format="json")` to mirror the current asset
brain into a static metadata tree such as GitHub Pages. Keep only IDs, review
events, inspections, visual verdicts, hashes, paths, and URLs in that mirror.
Do not put `.rbxl`, `.rbxm`, screenshots, meshes, or thumbnails there.

## Headless fragment assembly

Use `plan_headless_assembly` when multiple agents should build room/lobby
subtrees without serializing every mutation through Studio. The tool returns:

- work packets for the lobby and each themed room
- the `.rbxm` model output path and companion manifest path per packet
- Creator Store search/download and Open Cloud publish endpoints to keep outside
  Studio-specific logic
- the coordinator merge steps for remapping referents, stripping/regenerating
  identity fields, resolving parent links, and writing a merged `.rbxl`
- validation commands for Lune, Rojo, the Prop Hunt gate, and the final Studio
  visual review

Every agent fragment must pass `validate_fragment_manifest` before merge. The
manifest contract requires one root model, `target_parent`, `order_key`,
`source_digest`, `asset_ids`, and an identity policy where the coordinator owns
referent remapping and strips or regenerates unique IDs. The validator also
flags risky script loaders such as `require(assetId)`, `InsertService:LoadAsset`,
`loadstring`, and `HttpService` requests.

The research and proof-of-concept backing this flow live in
[`../docs/headless-roblox-file-pipeline.md`](../docs/headless-roblox-file-pipeline.md).

## Playable-space review gate

Use `plan_playable_space_review` after building or changing a map. The default
plan covers the current Prop Hunt gate: lobby, Medieval Market, Sci-Fi Lab, and
Cozy Cabin. It emits a sequential `screen_capture` queue for overhead, entry,
player-height quadrant, reverse, and UI-state shots.

For targeted asset-fix passes, use:

```text
plan_playable_space_review(project: "eggbreakers", review_mode: "player_angle", spaces: [...])
```

That scoped mode emits only player-height quadrant captures and accepts
`verdict: "player_angle_signed_off"`. Use it to verify fixes such as scale,
grounding, orientation, density, and camera occlusion before a later full map
signoff.

After screenshot review and fixes, call `validate_playable_space_review` with a
report containing `spaces_reviewed`, `screenshots`, `findings`, `fixes`, and
`verdict`. The validator fails when any playable space is missing, any quadrant
player-height shot is absent, or a major/blocker finding remains unresolved.
This deliberately prevents console-green or one-screenshot signoff.

When you omit `plan`, the validator infers custom spaces from `spaces_reviewed`
and screenshots when the report is scoped (`review_mode` is set) or belongs to a
non-default project. Plain Prop Hunt reports still use the full default plan.

The same gate is available from the shell for CI or handoff artifacts:

```bash
npm run gate:playable-space -- --file ../docs/reports/prophunt-visual-review.json
node scripts/validate-playable-space-review.mjs --file review.json --json
```

The report file can be either the report object itself or a `{ "report": ...,
"plan": ... }` wrapper. Omitting the plan uses custom `spaces` or
`spaces_reviewed` when present, then defaults to the Prop Hunt capture queue.

## Prop Hunt gate

Prop Hunt is this repo's validation gate. Commit palette slots using explicit
names:

```text
medieval_market.hideable.barrel
medieval_market.setpiece.market_stall
sci_fi_lab.hideable.canister
cozy_cabin.setpiece.fireplace
```

Then record StudioMCP measurements for every committed asset and run
`validate_prop_hunt_gate(project: "prophunt")`. Defaults match the current
`Place1.rbxl` gate: 3 areas, 20 hideables, 4 set pieces, inspected hideables
between 1 and 8 studs, no scripts, anchored-capable, and `primary_part=true`.

The gate intentionally stops at asset readiness. The live Studio pass still must
insert in edit mode, populate `Workspace.HideableProps`, and playtest the round
loop.

You can also run the same check against the persisted asset brain from a shell:

```bash
npm run seed:prop-hunt-place1  # imports the audited Place1.rbxl gate fixture
npm run gate:prop-hunt
node scripts/validate-prop-hunt-gate.mjs --project prophunt --json
```

`fixtures/place1-prop-hunt-gate.json` is a replayable snapshot of the live
StudioMCP audit for `Place1.rbxl`: 20 measured hideables and 4 set pieces across
the three shipped areas. It exists so the repo-side gate can be reproduced even
when `~/.roblox-asset-brain/` starts empty.

## Config

- `ASSET_BRAIN_DIR` — override the persistence directory (default
  `~/.roblox-asset-brain`).

## Layout

```
src/index.js     MCP server + tool registrations
src/gameCoverage.js generic Roblox lobby/session/room coverage planner
src/headlessPipeline.js headless fragment assembly planner + manifest validator
src/playableSpaceReview.js playable-space screenshot planner + report validator
src/propHuntGate.js Prop Hunt palette + inspection validation
fixtures/place1-prop-hunt-gate.json audited Place1 gate fixture
scripts/import-prop-hunt-gate.mjs imports audited gate fixtures into the store
scripts/validate-prop-hunt-gate.mjs CLI for the persisted Prop Hunt gate
src/toolbox.js   Toolbox v2 search, ranking, extensive query expansion
src/store.js     JSON persistence, TTL cache, single-flight, reviews, inspections, palette
test/offline.mjs deterministic parsing/scoring/curation test (no network)
test/gate-cli.mjs deterministic CLI gate test (no network)
test/fixture-import.mjs deterministic Place1 fixture import test (no network)
test/smoke.mjs   spins up the server as an MCP client end-to-end
```
