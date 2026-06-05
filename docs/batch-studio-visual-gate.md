# Batch Studio Visual Gate

RobloxAIDev should generate and mutate Roblox files headlessly whenever possible,
then use Studio as the scarce visual/runtime validator. The batch visual gate is
the bridge: an agent asks for one capture plan, a wrapper drives StudioMCP
serially, and the MCP validates the collated proof bundle.

## Why

Prior Roblox project work showed the same failure pattern:

- Studio/Search MCP calls are serial and active-place sensitive.
- Agents churn when they decide camera placement screenshot-by-screenshot.
- Visual signoff is not real unless player-height screenshots prove the asset
  or playable space from the correct active Studio place.
- Headless `.rbxl`/`.rbxm` generation is fast, but it must be followed by a
  screenshot and runtime gate.

## Flow

1. Asset brain produces slots, candidates, family queues, and known rejections.
2. Headless builders produce `.rbxm` fragments or mutate a copied `.rbxl`.
3. `plan_batch_visual_gate` turns playable spaces into one Studio job packet.
4. The Studio wrapper runs the packet:
   - active-place preflight with `execute_luau`;
   - one camera-set `execute_luau` per view;
   - one `screen_capture` per view;
   - contact sheet, alt text index, and screenshot manifest.
5. `validate_batch_visual_gate` checks:
   - preflight passed;
   - every planned capture returned an image path;
   - the collated playable-space review passes.

## Contract

The batch plan is metadata only. It does not contain screenshots or Roblox
binaries. A Studio adapter is responsible for executing the returned
`studio_mcp_steps` against the active Studio MCP and writing artifacts under the
declared `artifact_root`.

The batch report must include:

- `preflight.passed=true` from the target Studio place;
- one screenshot entry per planned `capture_id`;
- `image_path`, `alt_text`, and `passed` for every screenshot;
- `findings`, `fixes`, and a final verdict accepted by the playable-space gate.

## Current MCP Tools

- `plan_batch_visual_gate`
- `validate_batch_visual_gate`
- `plan_playable_space_review`
- `validate_playable_space_review`

This keeps the agent's job small: ask for the plan, hand it to the wrapper, read
the collated report, then fix and recapture only the failing views.
