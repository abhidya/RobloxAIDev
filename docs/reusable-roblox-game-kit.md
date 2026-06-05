# Reusable Roblox GameKit

This pass converts the source libraries from EggBreakers, GroanTubeHero, and the
RobloxAIDev Prop Hunt surface into reusable module families for future Roblox AI
game-dev speed.

## Behavior Lock

- Original game repos are left unchanged.
- `scripts/inventory_reusable_game_libraries.mjs` scans the three source areas
  and assigns every library file to a reusable module family.
- `asset-search-mcp/test/game-kit-contracts.mjs` verifies that the inventory,
  module catalog, module files, and this doc stay aligned.
- Existing MCP tests remain the broader regression gate.

## Cleanup Plan

Scope:

- Create reusable modules in `packages/roblox-game-kit`.
- Create a deterministic source library inventory.
- Do not rewrite EggBreakers, GroanTubeHero, or Prop Hunt callers in this pass.

Smells addressed:

- **Duplication**: rate limiting, remotes, profile cache, scoring, queues,
  world markers, placement validation, asset audit, and test harness patterns
  existed in project-local forms.
- **Boundary violations**: project-specific data and generic logic were mixed in
  game services. The GameKit modules keep reusable logic separate from adapters.
- **Fallback-like code**: source projects contain grounded Studio/debug
  compatibility paths. This pass names them as policy seams instead of copying
  them as implicit defaults.

## Fallback Findings

| Finding | Classification | Action |
| --- | --- | --- |
| Studio-only DataStore session behavior in GroanTubeHero | Grounded compatibility/fail-safe fallback | Preserved as an explicit `sessionOnly` option in `ProfileStore` |
| Release-blocked debug visuals in EggBreakers | Grounded compatibility/fail-safe fallback | Kept in source game, documented as release-gate policy |
| Broad `pcall` and warning-heavy world builder paths | Ambiguous fallback-like code | Not extracted wholesale; future adapter should expose failure evidence |
| Procedural visible affordances | Grounded when release metadata is present | Treated as asset-audit policy, not default GameKit art generation |

## Module Family Map

| Family | GameKit module | Source examples |
| --- | --- | --- |
| service-lifecycle | `ServiceRegistry`, `Result` | game bootstraps and service start order |
| remote-contracts | `RemoteBridge` | Prop Hunt remotes and EggBreakers remote contracts |
| remote-security | `RateLimiter` | EggBreakers rate limits and GroanTubeHero anti-exploit buckets |
| profile-store | `ProfileStore` | EggBreakers player data and GroanTubeHero profile cache |
| economy-wallet | `EconomyWallet` | DNA/fossils, coins/fans/tickets, shop spend/grant logic |
| score-and-timing | `ScoringRules` | rhythm judgement windows, multipliers, grades, accuracy |
| room-session | `RoomQueue`, `RoundPhaseMachine` | Prop Hunt room queues, GroanTubeHero rooms and sessions |
| world-layout | `PolarLayout`, `PlacementRules`, `WorldMarkers` | circular arena layout and biome placement validation |
| asset-audit | `AssetAudit` | script counts, mesh/part counts, quarantine flow |
| config-registry | `ConfigRegistry`, `DeepCopy` | project configs, rosters, catalogs |
| life-sim | `StatRules` | survival drains, oxygen, health, combat resources |
| client-ui | `ClientStateStore` | shared client snapshot state |
| test-harness | `TestHarness` | table-based Roblox test runners |

## Migration Passes

1. **Adopt package in new games first.** Map `packages/roblox-game-kit` through
   Rojo or copy it into a new game skeleton.
2. **Replace shallow remotes/rate limits.** These have low game-specific data
   and high reuse.
3. **Move profile/economy adapters next.** Keep DataStore names, defaults, and
   leaderstats in project adapters.
4. **Move world/asset audit modules after visual gates.** They need project
   policy and screenshot proof before full reuse.
5. **Only then migrate old games.** Each source game should migrate one module
   family at a time with its own tests.

## Top Recommendation

Start future projects with `RemoteBridge`, `RateLimiter`, `ServiceRegistry`,
`RoomQueue`, and `RoundPhaseMachine`. They are deep enough to speed up every new
game, but small enough to validate without dragging in project-specific art,
economy, or world policy.
