# E2E Roblox AI Game Design Loop

This is the durable loop for building Roblox games with AI agents, Roblox file
parsers/writers, a custom MCP contract, and gated Studio validation.

## Loop Shape

```text
idea
  -> plan_ai_game_dev_loop
  -> asset brain coverage, curation, claims, inspections, palette proof
  -> plan_asset_acquisition plus plan_asset_delivery for direct delivery, Studio fallback, quarantine
  -> GameKit source adoption
  -> headless Roblox parser/writer build
  -> fragment manifest validation and coordinator merge
  -> plan_world_asset_family_sweep for repeated world asset orientation/scale fixes
  -> gated StudioMCP batch visual proof through run-studio-batch-visual-gate
  -> validate_ai_game_dev_loop
  -> repair only failed gates
```

## Custom MCP Tools

- `plan_ai_game_dev_loop` is the top-level planner. It returns the whole loop as
  one machine-readable packet: asset-brain calls, GameKit adoption commands,
  Lune/Rojo/rbx-dom parser-writer path, headless assembly packets, Studio batch
  screenshot gate, and final release verification requirements.
- `validate_ai_game_dev_loop` validates the proof report for that packet. It
  requires asset brain, GameKit build, parser/writer generation, fragment
  manifest validation, custom MCP contract proof, world asset-family sweep
  tooling, and a passing batch visual gate.

Supporting MCP tools:

- `plan_project_template`
- `validate_project_template`
- `plan_game_asset_coverage`
- `preprocess_storyboard_asset_cache`
- `curate_assets`
- `claim_assets`
- `record_inspection`
- `commit_palette`
- `validate_publish_permissions`
- `plan_asset_acquisition`
- `validate_asset_acquisition`
- `plan_asset_delivery`
- `validate_asset_delivery_receipt`
- `plan_headless_assembly`
- `validate_fragment_manifest`
- `plan_coordinator_merge`
- `validate_coordinator_merge`
- `plan_world_asset_family_sweep`
- `validate_world_asset_family_sweep`
- `plan_batch_visual_gate`
- `validate_batch_visual_gate`

## Project Template Layer

Use `generate-project-template.mjs` to create a new repo skeleton before the
first asset pass:

```bash
node asset-search-mcp/scripts/generate-project-template.mjs \
  --project dino-dash \
  --game "Dino Dash" \
  --target-place DinoDash.rbxl \
  --theme "nursery grove" \
  --json
```

The template prewires `CONTEXT.md`, prompt lanes, asset-brain metadata layout,
Rojo source stubs, the local POC script, and the delivery/coordinator/Studio
gate commands.

## Parser/Writer Layer

Use Roblox file tooling before Studio:

- **Lune `@lune/roblox`** for current headless `.rbxl`/`.rbxm` mutation POCs and
  Luau-native coordinator merge scripts.
- **Rojo** for deterministic source-tree assembly into `.rbxlx`/`.rbxmx`.
- **rbx-dom** as the long-term production adapter and binary/XML format
  authority for deterministic referent, property, and identity handling.
- **Coordinator adapter CLI** for replaceable fan-in:
  `run-headless-coordinator.mjs --adapter lune|rbx_dom`. The `lune` adapter
  wraps the proven script; the `rbx_dom` adapter targets an external production
  command with the same report contract.

Studio opens only after headless validation passes.

## World Asset-Family Sweep Layer

Use `plan_world_asset_family_sweep` for built worlds where imported or staged
families repeat across the map: ferns, dinos, nests, rocks, ruins, food, trees,
or NPC/player model variants. This is the gate for problems such as face-down
dinos or ferns on their side.

The report must prove each family independently:

- clean-spot clone before screenshots: front, back, left, right, overhead, and
  player-height;
- canonical `up`, `forward`, scale policy, grounding offset, and pivot policy;
- propagation to every live visual instance, not only the validation clone;
- clean-spot after screenshots plus at least one live in-world player-height
  after screenshot;
- `record_inspection` metadata or refs with world placement audit fields;
- removal of the clean clone and temporary probes before the next family.

Run `validate_world_asset_family_sweep` before palette promotion, scoped
player-angle signoff, or final batch visual proof.

## Authenticated Asset Delivery Layer

Use Open Cloud Asset Delivery before Studio insertion when an asset can be
retrieved directly:

```bash
node asset-search-mcp/scripts/run-asset-delivery.mjs \
  --project eggbreakers \
  --slot nursery_grove.dino_fern \
  --asset-id 123456 \
  --json
```

The CLI reads `ROBLOX_OPEN_CLOUD_API_KEY` or
`ROBLOX_OPEN_CLOUD_ACCESS_TOKEN`, fetches
`/asset-delivery-api/v1/assetId/{assetId}` or the versioned endpoint, writes
bytes under `work/asset-acquisition/.../quarantine`, and writes a redacted
`*.delivery-receipt.json`. Validate that receipt with
`validate_asset_delivery_receipt` before promoting the asset into the broader
`validate_asset_acquisition` report. The asset brain receives only metadata
paths and proof status, never downloaded bytes or credentials.

## Gated Studio Layer

Studio work is serial and active-place sensitive. The loop gates it:

- `plan_batch_visual_gate` emits active-place preflight Luau.
- The Studio wrapper runs camera moves and screenshots serially.
- `asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs` is the executable
  adapter contract. Its mock transport writes a collated proof bundle, and its
  `studio_mcp_stdio` transport connects to a Studio MCP stdio server while
  preserving the same artifact shape.
- `validate_batch_visual_gate` requires preflight proof, image paths, alt text,
  and passing playable-space review.
- `validate_ai_game_dev_loop` refuses to sign off the full loop if the Studio
  proof is missing or fails.

Mock adapter command:

```bash
node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs \
  --plan batch-plan.json \
  --active-place GroanTubeHero.rbxl \
  --json
```

Studio MCP stdio adapter command:

```bash
node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs \
  --plan batch-plan.json \
  --transport studio_mcp_stdio \
  --studio-mcp-command /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP \
  --studio-id <studio-instance-id> \
  --json
```

## Proof Report Contract

`validate_ai_game_dev_loop` expects:

```json
{
  "schema": "roblox-ai-game-dev-loop-report/v1",
  "project": "groan-tube-hero",
  "gates": {
    "asset_brain": { "passed": true, "artifact_path": "asset-brain/v1/manifest.json" },
    "gamekit_build": { "passed": true, "artifact_path": "/tmp/RobloxGameKit.rbxlx" },
    "parser_writer_generation": { "passed": true, "artifact_path": "docs/poc-results/ai-game-dev-poc-latest.json" },
    "fragment_manifest_validation": { "passed": true, "artifact_path": "fragments/example.manifest.json" },
    "custom_mcp_contract": {
      "passed": true,
      "tools": [
        "plan_ai_game_dev_loop",
        "validate_ai_game_dev_loop",
        "plan_project_template",
        "validate_project_template",
        "plan_asset_acquisition",
        "validate_asset_acquisition",
        "plan_asset_delivery",
        "validate_asset_delivery_receipt",
        "plan_coordinator_merge",
        "validate_coordinator_merge",
        "plan_world_asset_family_sweep",
        "validate_world_asset_family_sweep",
        "plan_batch_visual_gate",
        "validate_batch_visual_gate"
      ]
    },
    "batch_visual_gate": {
      "passed": true,
      "artifact_path": "artifacts/visual-gates/example/batch-report.json",
      "batch_report": {}
    }
  },
  "open_blockers": []
}
```

The `batch_report` must be the report accepted by `validate_batch_visual_gate`.

## Verification

Run:

```bash
npm --prefix asset-search-mcp run test:offline
npm --prefix asset-search-mcp run test:studio-adapter
npm --prefix asset-search-mcp run test:smoke
npm --prefix asset-search-mcp test
```

The smoke test exercises the custom MCP tools end to end with a synthetic
collated Studio proof report. `test:studio-adapter` also exercises the stdio
transport against a fake Studio MCP server before a real open Studio session is
used.
