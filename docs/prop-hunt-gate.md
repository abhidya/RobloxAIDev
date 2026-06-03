# Prop Hunt Validation Gate

Prop Hunt is the end-to-end gate for this repo. It proves that the asset-search MCP, the skill, and the Studio build workflow can turn a one-line game idea into a playable Roblox loop built from real Creator Store assets.

## Gate Layers

| Layer | Owner | Evidence |
| --- | --- | --- |
| Palette gate | `asset-search-mcp` | committed palette, claims, reviews, StudioMCP inspection records |
| Build gate | StudioMCP | inserted assets, measured placement, populated `Workspace.HideableProps` |
| Play gate | StudioMCP / Studio | 2-client round loop or solo `Config.MIN_PLAYERS = 1` smoke test |

The search MCP does not inspect Studio directly. It stores the inspection facts that the leader measures through StudioMCP.

## Slot Naming

Use explicit palette slot names so the gate can classify assets:

```text
medieval_market.hideable.barrel
medieval_market.setpiece.market_stall
sci_fi_lab.hideable.canister
cozy_cabin.setpiece.fireplace
```

The first segment is the area. Include `hideable` for disguise props and `setpiece` for large scene anchors.

## MCP Gate Tools

1. `commit_palette(project, slot, asset_id, name?)`
   Freezes a chosen Creator Store asset for a slot.

2. `record_inspection(asset_id, slot?, size_studs?, has_scripts?, script_count?, base_part_count?, anchored_capable?, primary_part?, issues?, reviewer?, source?)`
   Stores the latest StudioMCP-measured facts for that asset.

3. `validate_prop_hunt_gate(project?)`
   Checks the committed palette before the live build.

   Pass `format: "json"` when another tool needs structured output.

Default requirements match the current `Place1.rbxl` gate:

- 3+ themed areas.
- 20+ hideable props.
- 4+ set pieces.
- Every palette asset has an inspection record.
- Hideables are script-free, anchored-capable, have BaseParts, record `primary_part=true`, and measure between 1 and 8 studs at the largest dimension.

Use stricter options when building a larger gate, for example `min_hideable_per_area=10` or `min_setpiece_per_area=6`.

The same gate is available without an MCP client:

```bash
cd asset-search-mcp
npm run seed:prop-hunt-place1
npm run gate:prop-hunt
node scripts/validate-prop-hunt-gate.mjs --project prophunt --json
```

`seed:prop-hunt-place1` imports `fixtures/place1-prop-hunt-gate.json`, a
replayable StudioMCP audit of the shipped place. Use this when a fresh local
`~/.roblox-asset-brain/` has no committed `prophunt` palette yet.

The live Prop Hunt logic is source-controlled with Rojo:

```bash
rojo serve --address 127.0.0.1 --port 34872
rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx
```

## Studio-Only Checks

After the MCP gate passes, the leader still must verify in Studio:

- Assets insert in edit mode and are placed from measured bounding boxes.
- `Workspace.HideableProps` contains valid disguise models with `PrimaryPart`.
- No inserted asset scripts are enabled.
- The round loop runs Intermission -> Hiding -> Hunting -> RoundEnd.
- A hider can disguise through the client input path (`E` near a prop), and the
  server attaches a `Disguise` model.
- A two-client local server test works, or the solo `Config.MIN_PLAYERS = 1` loop is documented as the current smoke path.

## Traceability

| Requirement | Evidence |
| --- | --- |
| Real Creator Store assets, not hand-rolled visible props | `search_assets`, `curate_assets`, `commit_palette` |
| Parallel agents do not collide | `claim_assets`, persisted claims |
| Bad candidates are shared vetoes | `reject_asset`, `review_asset` |
| Studio measurement is captured before build | `record_inspection`, `get_inspection` |
| Prop Hunt asset scope is complete enough to build | `validate_prop_hunt_gate` |
| Live gameplay loop works | Studio playtest evidence, outside this MCP |
