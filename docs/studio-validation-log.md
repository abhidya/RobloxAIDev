# Studio Validation Log

## 2026-06-03

Goal: use Prop Hunt as the validation gate for MCP and skill development.

What ran:

- `tool_search` exposed Roblox Studio MCP proxy tools.
- `list_roblox_studios` returned one Studio instance: `ef6891c0-745c-4f8e-8b2e-41700290c9e5`.
- `set_active_studio` selected that instance.
- Read-only tree probes (`search_game_tree`) failed with: `Execution is prevented because previously active Studio has disconnected or doesn't have a place opened.`
- Opened repo file `Place1.rbxl` with macOS `open`.
- Retried `list_roblox_studios`, `set_active_studio`, and read-only probes.

Result:

- The Studio proxy still reported that the active Studio had disconnected or did not have a place opened.
- No live Studio game-tree inspection, insertion check, `Workspace.HideableProps` audit, screenshot, or playtest evidence was collected.

Repo-side validation completed instead:

- `npm test` passed in `asset-search-mcp`.
- The test suite now includes offline gate logic, a persisted CLI Prop Hunt gate, and MCP smoke coverage for `validate_prop_hunt_gate`.
- A non-executing `strings` scan of `Place1.rbxl` found Prop Hunt markers, including `HideableProps`, `Intermission`, `Hiding`, `RoundEnd`, `MIN_PLAYERS`, `Medieval Market`, `Sci-Fi Lab`, and `Cozy Cabin`. This supports that the place contains Prop Hunt content, but it is not gameplay evidence.

Next live validation step:

Open `Place1.rbxl` in a Studio session where the Studio MCP proxy can execute Luau, then verify:

- `Workspace.HideableProps` contains valid disguise models.
- Every hideable model has a `PrimaryPart`.
- Inserted assets have no enabled scripts.
- The round loop runs Intermission -> Hiding -> Hunting -> RoundEnd.
