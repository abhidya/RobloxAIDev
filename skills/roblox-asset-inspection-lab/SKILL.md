---
name: roblox-asset-inspection-lab
description: Build and use a Roblox asset inspection and headless assembly workflow. Use when Codex needs to preprocess the asset-search MCP cache, enrich Creator Store assets with metadata, open assets in a clean temporary Studio place for screenshots/script review, create reusable asset metadata, storyboard from cached assets, or generate/merge Roblox .rbxm/.rbxlx/.rbxl files headlessly with Lune, rbx-dom, Rojo, or similar file writers before final Studio validation.
---

# Roblox Asset Inspection Lab

Use this skill to keep Roblox Studio off the critical path. Search, cache,
storyboard, fragment, and assemble as much as possible headlessly; open Studio
only for asset screenshots, visual/script validation, and final playable-space
signoff.

## Operating Model

Split work into three lanes:

1. **Cache lane**: use only `asset-search-mcp` for discovery, curation, claims,
   reviews, and palette decisions. Do not use Studio search.
2. **Headless lane**: build manifests, `.rbxm` fragments, `.rbxlx`, or `.rbxl`
   candidates with Lune, rbx-dom, Rojo, or equivalent DOM writers. Validate by
   deserialize -> serialize -> deserialize before Studio.
3. **Studio lab lane**: open a blank inspection place or final candidate place
   only when visual/script validation is needed. Screenshot assets from
   controlled player-height angles, inspect scripts/sounds/part counts, then
   record metadata back into the asset-search MCP.

Studio should be closed when the task returns to cache preprocessing, file
writing, storyboard planning, or manifest repair.

## Cache Preprocessing

Before storyboarding or building:

1. Call `plan_game_asset_coverage(game, themes)` to generate the shell, lobby,
   NPC, portal, room, prop, ambience, and UI slots.
2. Use `curate_assets(..., extensive=true)` per slot group. Claim shortlists
   before inspection so parallel agents do not collide.
3. Persist all known facts:
   - `review_asset` / `reject_asset` for human or agent verdicts.
   - `record_inspection` for geometry, script risk, visual risk, screenshot
     verdict, and source labels.
   - `commit_palette` only for assets with enough metadata for the current
     milestone.
4. Export cache mirrors as small JSON/NDJSON shards when needed. Store only
   IDs, metadata, verdicts, hashes, and URLs; never store `.rbxl`, `.rbxm`,
   screenshots, meshes, or thumbnails in GitHub Pages.

Use `references/metadata-contract.md` for the canonical metadata shape.

## Storyboard From Cache

Create storyboards from what the cache proves, not from imagined assets:

- Prefer assets with `screenshotVerdict: "pass"` or `"fix"` plus accepted risk.
- Bend room themes to strong available assets.
- Keep rejected assets and unresolved high-risk assets out of storyboard beats.
- Mark each beat with the asset IDs, palette slots, review state, and missing
  evidence.

If a beat lacks enough cached assets, go back to curation instead of filling it
with generated placeholder parts.

## Headless File Build

Use `plan_headless_assembly(project, target_place, themes)` to get bounded work
packets. For each packet:

1. Produce exactly one root model subtree as `.rbxm` or source-tree content.
2. Create a manifest with `fragment_id`, `target_parent`, `order_key`,
   `source_digest`, `asset_ids`, `external_anchors`, and identity policy.
3. Reject fragments that contain runtime loaders such as `require(assetId)`,
   `InsertService:LoadAsset`, `loadstring`, or unapproved `HttpService`.
4. Run `validate_fragment_manifest` before merging.
5. Merge in coordinator-owned order. The coordinator, not workers, remaps
   referents, assigns parents, strips/regenerates `UniqueId`/`HistoryId`, and
   writes the candidate place.
   - Prefer `scripts/headless_fragment_merge.luau` for the Lune coordinator
     path: pass `--place`, `--out`, and one or more `--fragment` manifest
     sidecars; use `--create-missing-targets` only for intentional folder
     creation and `--replace-existing` for idempotent reruns.
6. Validate the output without Studio:
   - Lune deserialize/serialize round trip when available.
   - Rojo build for filesystem-owned source trees.
   - Schema/property checks for unsupported classes and stale properties.

Prefer `.rbxlx` while iterating because it is diffable; write binary `.rbxl`
only for final Studio/open/publish flows.

## Studio Inspection Lab

Open Studio only when the asset or candidate place needs visual evidence.

For individual asset IDs:

1. Create or open a fresh blank inspection place, not the production place.
2. Insert/load one asset at a time. Try `game:GetObjects` if
   `InsertService:LoadAsset` fails.
3. Move the asset to a neutral stage with a floor, scale ruler, player-height
   camera anchors, and clean lighting.
4. Count scripts, local scripts, module scripts, sounds, base parts, mesh parts,
   constraints, unanchored parts, and missing PrimaryPart.
5. Read script source when accessible; classify each script as safe, adapted,
   suspicious, or reject. Imported gameplay authority scripts are rejected until
   explicitly reviewed.
6. Capture screenshots: front, back, left, right, overhead, and at least one
   player-height gameplay angle. Recapture after scale/orientation fixes.
7. Record metadata with `record_inspection`, including `visual_risks`,
   `visual_risk_score`, and `screenshot_verdict`.
8. Destroy the asset or reset the lab before inspecting the next one.

For candidate places:

1. Open the headless-built place only after file validation passes.
2. Run a legacy filler scan for generated placeholders, old food/dressing/rain
   visuals, debug markers, and hidden training artifacts.
3. Run `plan_playable_space_review(review_mode="player_angle", spaces=[...])`
   for scoped asset fixes, then full playable-space review for milestone
   signoff.
4. Save screenshots and reports outside the asset cache; store only paths/URLs
   and verdict metadata in the MCP.

## Metadata Output

Each asset inspection should produce:

- asset id, slot, query, creator, catalog score, and source cache key;
- geometry: size studs, primary part, base part count, anchored capability;
- script audit: counts, source summaries, dangerous patterns, verdict;
- visual audit: screenshot ids/paths, screenshot verdict, visual risks, risk
  score, scale/orientation notes;
- cache action: keep, maybe, reject, replace, or commit palette;
- storyboard suitability: roles the asset can safely support.

Keep metadata text small and shardable. Large binaries and screenshots belong in
artifact storage or local proof folders, not the cache.

## Stop Conditions

Do not open Studio if the current task is only search, cache normalization,
storyboard drafting, manifest writing, or headless file repair.

Do not claim an asset is release-ready until it has both machine-readable
metadata and player-angle screenshot evidence.
