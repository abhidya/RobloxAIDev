# Brief and Recovered Context

## Original Prompt

> find the skill in this repo, continue mcp development and skill development using prop hunt as a validation gate [$deliver-ambiguous-brief](/Users/abdulrehmanbhidya/.codex/skills/deliver-ambiguous-brief/SKILL.md) l

Follow-up instruction:

> use claude context as history

## What Was Found

- Repo-local skill: `skills/asset-driven-game-design/SKILL.md`.
- MCP under active development: `asset-search-mcp/`.
- Validation artifact: `Place1.rbxl`, described as a 3-theme Prop Hunt gate.
- Direct Claude history for this repo path was not found in local Claude project transcripts.
- Relevant Claude history was found in the earlier Roblox `eggBreakers` project. That history informs this repo's operating rules but is evidence from a related project, not direct proof about `Place1.rbxl`.

## Recovered Claude-History Lessons

Evidence from `~/.claude/projects/-Users-abdulrehmanbhidya-PycharmProjects-eggBreakers`:

- Keep the search MCP and Studio MCP responsibilities separate. Search/discovery is not the same as insertion, measurement, or playtesting.
- Live Studio actions are serial and leader-owned. Agent claims about Studio tests are not sufficient evidence.
- Creator Store inserts must be performed in Studio edit mode; play mode can silently drop inserts.
- Use asset names or snapshot-style diffing to locate inserted models, because default insertion names can be unreliable.
- Search ranking can be thin; shared rejection, claim, review, inspection, and palette memory make the pipeline more reliable.
- Live Studio edits are not durable until the user saves the place.

## Current Inference

This repo is intended to package those lessons as a cleaner asset-driven workflow:

- `asset-search-mcp` is the shared catalog and decision memory.
- The repo-local skill coordinates `asset-search-mcp` with the official Studio MCP.
- Prop Hunt is the validation gate because it requires real assets, measured hideable props, committed palette choices, Studio placement, `Workspace.HideableProps`, and a working round loop.

## Stop Condition For This Pass

Add a deterministic repo-side Prop Hunt asset gate to the MCP and skill, then verify it with automated tests. The live Studio playtest remains a separate gate when the Studio MCP proxy cannot reach an opened place.

Continuation update: Roblox Studio MCP tools were later discoverable, but the active Studio instance remained unreachable for read-only tree probes even after opening `Place1.rbxl`. See `docs/studio-validation-log.md`.
