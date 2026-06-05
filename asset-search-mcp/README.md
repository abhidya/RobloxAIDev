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
- **`record_asset_permission` / `validate_publish_permissions`** — persist
  Creator Dashboard/Studio permission proof so release palettes can require
  target-grantable assets or explicitly allowed Open Use dependencies.
- **`commit_palette` / `get_palette`** — freeze the chosen asset per slot for the
  build phase, optionally refusing assets without publish-permission proof.
- **`validate_prop_hunt_gate`** — validate the committed Prop Hunt asset palette
  before a live Studio build/playtest.
- **`plan_headless_assembly` / `validate_fragment_manifest`** — define and check
  referent-safe `.rbxm` fragment packets for parallel headless place assembly.
- **`plan_playable_space_review` / `validate_playable_space_review`** — plan
  and enforce the player-height screenshot gate for lobby, rooms, UI states, and
  unresolved visual blockers, including scoped asset-fix passes.
- **`plan_batch_visual_gate` / `validate_batch_visual_gate`** — wrap a
  playable-space plan into one StudioMCP batch job with active-place preflight,
  deterministic camera steps, screenshot collation, accessibility fields, and a
  final validation gate.
- **`plan_ai_game_dev_loop` / `validate_ai_game_dev_loop`** — top-level custom
  MCP contract for the whole AI game-design loop: asset brain, reusable GameKit
  source, Roblox file parsers/writers, headless merge, gated Studio screenshot
  proof, and release verification.

State persists as plain JSON under `~/.roblox-asset-brain/` — no native deps, no
build step. The cache stores metadata only: IDs, reviews, inspections, visual
verdicts, permission proof, and palette choices.

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
| `plan_ai_game_dev_loop(project?, game?, target_place?, themes?, include_defaults?, include_lobby?, max_themes?, max_fragments?, assembly_profile?, review_mode?, spaces?, include_default_spaces?, artifact_root?, max_captures?, format?)` | Plan the full AI Roblox game-dev loop across asset brain, GameKit, parser/writer generation, headless merge, gated Studio batch proof, and release verification. |
| `validate_ai_game_dev_loop(report, plan?, format?)` | Validate the final proof report for the full AI game-dev loop, including custom MCP contract proof and the nested batch visual gate report. |
| `plan_asset_acquisition(project?, slot?, query?, asset_ids?, target_place?, delivery_mode?, require_publish_permission?, format?)` | Plan the asset acquisition seam: search/claim, publish permission proof, direct asset delivery parse, Studio insertion fallback, quarantine, manifest validation, and visual proof. |
| `validate_asset_acquisition(report, plan?, format?)` | Validate an acquisition proof report before an asset can move from quarantine into a palette. |
| `plan_asset_delivery(project?, slot?, asset_id, version_number?, quarantine_root?, base_url?, api_key_env?, bearer_env?, format?)` | Plan one authenticated Open Cloud Asset Delivery request that writes bytes to quarantine and records only a redacted receipt. |
| `validate_asset_delivery_receipt(receipt, request?, format?)` | Validate an Asset Delivery receipt: redacted auth proof, 2xx response, non-empty bytes, sha256 digest, and no asset-brain binary paths. |
| `plan_game_asset_coverage(game?, themes?, include_defaults?, include_lobby?, max_themes?, format?)` | Generate lobby/session/room asset search coverage before curation. |
| `preprocess_storyboard_asset_cache(project?, game?, themes?, include_defaults?, include_lobby?, max_themes?, max_slots?, warm_search_cache?, per_slot?, verified_only?, extensive?, format?)` | Build storyboard-ready coverage slots, optionally warm ranked search cache, and return Pages-friendly metadata layout. |
| `export_asset_brain_snapshot(project?, include_search_cache?, max_queries?, max_results_per_query?, format?)` | Export small metadata-only snapshot for GitHub Pages or handoff; no binaries/screenshots. |
| `plan_headless_assembly(project?, target_place?, themes?, include_lobby?, max_fragments?, format?)` | Generate parallel headless fragment packets, merge contract, endpoints, Rojo/Lune validation commands, and Studio visual gate. |
| `validate_fragment_manifest(manifest, format?)` | Reject unsafe or under-specified `.rbxm` fragment manifests before coordinator merge. |
| `plan_playable_space_review(project?, review_mode?, spaces?, include_defaults?, format?)` | Generate the required Studio screenshot queue for lobby/room quadrant review and UI states. `review_mode="player_angle"` emits only player-height quadrant shots for scoped asset-fix passes. |
| `validate_playable_space_review(report, plan?, format?)` | Fail visual signoff reports that skip spaces, player-height quadrants, required screenshot kinds, or unresolved major/blocker findings. A supplied custom plan is authoritative; otherwise custom/scoped reports are inferred before the default Prop Hunt plan is used. |
| `plan_batch_visual_gate(project?, target_place?, review_mode?, spaces?, include_defaults?, adapter?, artifact_root?, max_captures?, format?)` | Turn a playable-space review plan into one serial StudioMCP wrapper packet with active-place preflight, camera Luau, `screen_capture` requests, collation paths, and a report template. |
| `validate_batch_visual_gate(batch_report, plan?, format?)` | Validate a collated Studio screenshot batch: active-place proof must pass, every planned capture needs an image path, and the embedded playable-space report must pass. |
| `search_assets(query, max_results?, categories?, verified_only?, extensive?, exclude_terms?, exclude_rejected?, exclude_claimed?, exclude_ids?, exclude_unpublishable?, publish_permission_mode?, require_studio_probe?, require_save_reopen?)` | Ranked search; auto-hides rejected/claimed; `exclude_terms` drops off-theme names; optional release-mode permission filtering uses recorded proof. |
| `curate_assets(slots[], per_slot?, verified_only?, extensive?, exclude_terms?, exclude_claimed?, exclude_unpublishable?, publish_permission_mode?, require_studio_probe?, require_save_reopen?)` | Diverse shortlist per slot; excludes rejected + claimed; no asset suggested for two slots; optional permission filtering for release palette curation. |
| `claim_assets(project, slot, asset_ids[], reviewer?)` | Reserve assets to a slot so other agents' results hide them — prevents collisions. |
| `reject_asset(asset_id, reason, slot?, reviewer?)` | Shared veto: the asset is auto-excluded from every agent's future results. |
| `review_asset(asset_id, verdict, slot?, rating?, notes?, reviewer?)` | Persist a shared verdict (`reject` auto-excludes). |
| `get_reviews(asset_id)` | Read all verdicts + claim status for an asset. |
| `record_inspection(asset_id, slot?, size_studs?, has_scripts?, script_count?, base_part_count?, anchored_capable?, primary_part?, issues?, visual_risks?, visual_risk_score?, screenshot_verdict?, reviewer?, source?)` | Store the latest StudioMCP-measured and player-angle visual facts for an asset. |
| `record_inspections(inspections[])` | Store many StudioMCP inspection records in one call after a live palette audit. |
| `get_inspection(asset_id)` | Read the latest persisted Studio inspection for an asset. |
| `record_asset_permission(asset_id, target_publisher?, target_experience_id?, access, grantable_by_us?, experience_has_access?, publish_policy?, studio_insert_probe?, save_reopen_probe?, dependencies?, evidence?, notes?, reviewer?, source?)` | Store permission proof for one asset and its dependencies. |
| `record_asset_permissions(permissions[])` | Store many permission records from a dashboard export or Studio audit. |
| `get_asset_permission(asset_id, publish_permission_mode?, require_studio_probe?, require_save_reopen?)` | Read permission proof plus evaluated release readiness. |
| `validate_publish_permissions(project?, publish_permission_mode?, require_studio_probe?, require_save_reopen?, format?)` | Fail a palette when any committed asset lacks publish permission proof. |
| `commit_palette(project, slot, asset_id, name?, require_publish_permission?, publish_permission_mode?, require_studio_probe?, require_save_reopen?)` | Freeze a chosen asset per slot (also claims it); strict mode refuses assets without publish proof. |
| `get_palette(project)` | Read the committed palette for the build phase, including publish-readiness status. |
| `validate_prop_hunt_gate(project?, min_areas?, min_hideable_total?, min_setpiece_total?, min_hideable_per_area?, min_setpiece_per_area?, min_hideable_studs?, max_hideable_studs?, require_inspections?, require_primary_part?, format?)` | Check the committed Prop Hunt palette before Studio build. |

The Studio batch execution side has a mockable CLI contract:

```bash
node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs \
  --plan batch-plan.json \
  --active-place GroanTubeHero.rbxl \
  --json
```

The mock transport writes `batch-report.json`, `batch-manifest.json`,
`alt-text.json`, and `execution-log.json`; the live Studio MCP transport should
keep that artifact shape.

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

## Publish-permission gate

Use permission proof before a palette becomes release input. The MCP supports two
release modes:

- `grantable_only` — every committed palette asset must be owned/grantable by
  the target publisher, with the target experience's access proven.
- `grantable_or_open_use` — committed assets may be target-grantable or Open
  Use; dependencies must still be grantable or Open Use and not
  quarantined/rejected.

Record proof after a Creator Dashboard permissions export or a Studio permission
probe:

```text
record_asset_permission(
  asset_id: 12345,
  target_publisher: { type: "group", id: "123" },
  target_experience_id: "987654321",
  access: "grantable",
  grantable_by_us: true,
  experience_has_access: true,
  publish_policy: "allow",
  studio_insert_probe: "pass",
  save_reopen_probe: "pass",
  dependencies: [
    { asset_id: 55501, type: "Mesh", access: "open_use", experience_has_access: true, status: "pass" }
  ],
  evidence: ["dashboard-permissions-export", "studio-save-reopen"]
)
```

Then make palette commits strict:

```text
commit_palette(
  project: "eggbreakers",
  slot: "swamp_delta.lily_safe_node",
  asset_id: 12345,
  require_publish_permission: true,
  publish_permission_mode: "grantable_only",
  require_studio_probe: true,
  require_save_reopen: true
)
```

Before headless assembly, Studio insertion, or release, run:

```text
validate_publish_permissions(
  project: "eggbreakers",
  publish_permission_mode: "grantable_only",
  require_studio_probe: true,
  require_save_reopen: true
)
```

`search_assets` and `curate_assets` also accept `exclude_unpublishable=true` for
release-palette curation after permission records exist. Leave it false during
early dreaming so agents can discover candidates before permission audit.

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
events, inspections, permission proof, visual verdicts, hashes, paths, and URLs
in that mirror. Do not put `.rbxl`, `.rbxm`, screenshots, meshes, or thumbnails
there.

## Authenticated asset delivery

Use `plan_asset_delivery` or the CLI to fetch candidate model bytes before
falling back to Studio insertion:

```bash
node asset-search-mcp/scripts/run-asset-delivery.mjs \
  --project eggbreakers \
  --slot nursery_grove.dino_fern \
  --asset-id 123456 \
  --json
```

The adapter reads `ROBLOX_OPEN_CLOUD_API_KEY` or
`ROBLOX_OPEN_CLOUD_ACCESS_TOKEN`, calls the Open Cloud Asset Delivery endpoint,
writes downloaded bytes under `work/asset-acquisition/.../quarantine`, and
stores a redacted delivery receipt. Run `validate_asset_delivery_receipt` before
including that receipt in `validate_asset_acquisition`. Keep the receipt path
metadata in the asset brain; keep downloaded `.rbxm` bytes out of it.

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

The coordinator entrypoint is:

```bash
lune run scripts/headless_fragment_merge.luau \
  --place work/headless-poc/Place1.headless-working.rbxl \
  --out work/headless-poc/Place1.headless-merged.rbxl \
  --fragment work/headless-poc/generated-headless-marker.manifest.json \
  --replace-existing
```

`headless_fragment_merge.luau` reads one or more manifest sidecars, verifies the
declared model digest, rejects unsafe script loaders in both manifest source
summaries and actual `.rbxm` script source, sorts fragments by target/order/id,
parents each single root into the copied place, stamps merge metadata, writes a
new `.rbxl`, and reloads the output before reporting success. Use
`--create-missing-targets` only when the coordinator should create missing
folder targets under Roblox services.

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

For lower-churn validation, use `plan_batch_visual_gate`. It emits one wrapper
packet for a StudioMCP adapter: active-place preflight first, then serial camera
and screenshot steps for every capture, then contact-sheet/alt-text/report
collation. Feed the wrapper output to `validate_batch_visual_gate`; it fails if
the active place was wrong, if any planned image is missing, or if the normal
playable-space report still has missing coverage or unresolved blockers.

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
src/visualBatchGate.js batch StudioMCP screenshot wrapper planner + validator
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
