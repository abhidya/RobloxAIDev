# Roblox AI Game-Dev Architecture

This document distills the RobloxAIDev direction into a repeatable architecture
for building Roblox games with AI agents, asset memory, headless file generation,
and Studio-gated validation.

## Executive Shape

The winning shape is:

```text
Idea
  -> asset brain coverage and dream queues
  -> parallel curation and inspection planning
  -> headless fragment/place generation
  -> coordinator merge and file reload validation
  -> batch Studio proof gate
  -> asset brain updates and next repair loop
```

Studio remains essential, but it should be treated as the scarce validator. The
default construction surface should be repo files, Roblox file parsers/writers,
and deterministic metadata contracts.

## Evidence Base

- Roblox Studio MCP can inspect and modify an open Studio session, run Luau,
  insert Creator Store assets, capture screens, playtest, and switch active
  Studio instances: <https://create.roblox.com/docs/studio/mcp>.
- Roblox Creator Store assets can be queried outside Studio through the Creator
  Store API / Toolbox Service:
  <https://create.roblox.com/docs/projects/assets/api>.
- Lune exposes Roblox place/model deserialization and serialization APIs usable
  outside Studio: <https://lune-org.github.io/docs/roblox/2-examples>.
- rbx-dom documents the binary format used by `.rbxl` places and `.rbxm` models:
  <https://dom.rojo.space/binary.html>.

Repo evidence:

- `scripts/headless_place_insert_poc.luau` proves a copied place can be mutated
  without Studio.
- `scripts/headless_fragment_merge.luau` proves manifest-gated fragment fan-in.
- `asset-brain/v1` proves cross-project asset memory can be merged as metadata.
- `asset-search-mcp/src/visualBatchGate.js` proves Studio screenshot work can be
  planned and validated as one batch contract.

## Deep Modules

### Asset Brain Module

**Interface**

- `search_assets`, `curate_assets`, `claim_assets`, `review_asset`,
  `record_inspection`, `commit_palette`, `export_asset_brain_snapshot`
- `scripts/merge_asset_brain_sources.mjs`
- `asset-brain/v1/manifest.json`

**Implementation**

- Shared JSON store under `~/.roblox-asset-brain`
- Repo snapshot under `asset-brain/v1`
- Cross-project merger that normalizes EggBreakers, GroanTubeHero, and local MCP
  memory

**Depth**

The caller asks for slots, claims, and proof readiness. The module hides cache
layout, source-project differences, claim/rejection memory, and pages-friendly
serialization.

**Locality**

Asset reuse bugs should be fixed in one module: duplicate claims, stale
rejections, missing permission proof, and cross-project memory drift.

### Headless Assembly Module

**Interface**

- `plan_headless_assembly`
- `validate_fragment_manifest`
- `scripts/headless_fragment_merge.luau`

**Implementation**

- Lune scripts for current POCs and coordinator merge
- Manifest rules for fragment identity, digest, target parent, external anchors,
  script-loader rejection, and parent assignment
- Future production adapter can be Rust/rbx-dom without changing worker prompts

**Depth**

Agents produce small fragments. They do not know global referent policy, final
place structure, or Studio state. The coordinator owns those concerns.

**Locality**

Schema drift, referent collisions, and unsafe script loaders are caught before
Studio opens.

### Studio Gate Module

**Interface**

- `plan_playable_space_review`
- `validate_playable_space_review`
- `plan_batch_visual_gate`
- `validate_batch_visual_gate`

**Implementation**

- MCP-visible plans that produce camera queues and validation contracts
- A mockable StudioMCP adapter CLI that executes `studio_mcp_steps` serially
- Batch reports that include active-place proof, screenshots, alt text,
  findings, fixes, and verdict

**Depth**

The caller asks for a proof bundle. The module hides capture ordering, camera
placement, active-place checks, retry policy, and validation logic.

**Locality**

Visual signoff bugs stay in the Studio gate instead of leaking into every agent
prompt.

### E2E Custom MCP Module

**Interface**

- `plan_ai_game_dev_loop`
- `validate_ai_game_dev_loop`
- `docs/e2e-roblox-ai-game-design-loop.md`

**Implementation**

- One planner that composes asset coverage, asset-brain cache planning, GameKit
  adoption, Lune/Rojo/rbx-dom parser-writer work, headless assembly, and batch
  Studio visual gate packets
- One validator that requires every proof gate plus the nested batch visual gate
  report before the loop can be signed off
- One adapter CLI,
  `asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs`, that starts with
  a mock transport and writes the proof bundle shape the live Studio MCP wrapper
  must preserve

**Depth**

The caller asks for a whole Roblox AI game-dev loop. The module hides the
ordering and proof dependencies between asset search, reusable source, file
generation, Studio screenshots, and release evidence.

**Locality**

Changes to the loop contract happen in one MCP module instead of being repeated
across prompts, docs, and ad hoc agent instructions.

### Agent Prompt Module

**Interface**

- `prompts/*.md`
- Handoff contracts: inputs, allowed tools, output artifacts, stop conditions

**Implementation**

- Prompt files for orchestrator, asset brain curator, headless builder,
  Studio adapter, visual critic, and release archivist

**Depth**

The orchestrator delegates by lane, not by vague vibes. Each prompt names what
the agent may edit, what it must prove, and where it hands work back.

**Locality**

Multi-agent behavior changes are made in prompt files and contracts, not spread
through ad hoc chat instructions.

### Reusable GameKit Module

**Interface**

- `packages/roblox-game-kit/module-catalog.json`
- `packages/roblox-game-kit/inventory/source-library-inventory.json`
- `packages/roblox-game-kit/src/ReplicatedStorage/GameKit`
- `packages/roblox-game-kit/src/ServerScriptService/GameKit`

**Implementation**

- Deterministic inventory script that maps EggBreakers, GroanTubeHero, and
  RobloxAIDev Prop Hunt libraries into reusable module families
- Small source-first Luau modules for remotes, rate limits, service lifecycle,
  profiles, economy, scoring, room sessions, world layout, asset audit, config,
  client state, and test harnesses

**Depth**

New games depend on a narrow GameKit interface and provide project adapters for
DataStore names, art policy, config, and UI rendering. The module hides repeated
game-loop mechanics without importing project-specific content.

**Locality**

Future library changes are made in one package and validated by inventory plus
contract tests instead of being re-created across every generated Roblox game.

## Recommended End-To-End Process

1. **Brief intake**
   - Capture genre, player fantasy, target loop, constraints, target platform,
     and success screenshots.
   - Output: `docs/brief.md` or a project-specific brief.

2. **Asset brain planning**
   - Run `plan_game_asset_coverage` and `preprocess_storyboard_asset_cache`.
   - Merge existing brain sources with `node scripts/merge_asset_brain_sources.mjs`.
   - Output: coverage slots, dream queues, known rejected/accepted assets.

3. **Parallel curation**
   - Asset agents curate slots and claim candidates.
   - No one inserts into Studio during broad discovery.
   - Output: shortlist claims and rejected IDs.

4. **Inspection planning**
   - Group candidates by asset family.
   - Decide which families require clean-spot proof, script audit, permission
     proof, or direct replacement.
   - Output: family inspection queue.

5. **Headless build**
   - Generate one `.rbxm` fragment per lane.
   - Validate every manifest before merge.
   - Merge into a copied `.rbxl` or `.rbxlx`, then reload.
   - Output: candidate place and proof that file writes work without Studio.

6. **Batch Studio proof**
   - Plan the capture batch with `plan_batch_visual_gate`.
   - Adapter verifies active Studio place, then captures every planned view.
   - Validate the collated report with `validate_batch_visual_gate`.
   - Output: proof bundle and blocker list.

7. **Repair loop**
   - Fix only the failed families/views.
   - Recapture the same IDs or `_recap` IDs.
   - Record inspections, reviews, and permission proof back to the asset brain.

8. **Release gate**
   - Validate palette and publish permission proof.
   - Keep screenshots and binaries outside metadata brain.
   - Commit docs, prompts, source, and small metadata snapshots.

## Alternatives

| Alternative | Pros | Cons | Recommendation |
| --- | --- | --- | --- |
| Studio-first agent workflow | High fidelity; uses official Studio behavior immediately; simple mental model | Slow serial bottleneck; active-place mistakes; screenshot-by-screenshot agent churn; hard to parallelize | Use only for final validation and unavoidable insertion |
| Headless-first Lune coordinator | Fast; already installed; easy Luau POCs; strong fit for scripts and small fragments | Limited API surface vs full Studio; schema drift can surface at serialize time | Primary current implementation |
| Rust/rbx-dom coordinator | Strongest long-term format authority; deterministic library base; deeper file-format control | More implementation work; less Roblox-like scripting ergonomics for quick POCs | Graduate here after Lune contracts stabilize |
| Rojo-only generation | Deterministic source tree; great for scripts and project-owned content | Weak fit for arbitrary imported binary model surgery; asset fragments still need manifest proof | Use for source-owned trees and final source sync |
| Docker-wrapped Studio | Reproducible wrapper idea; could standardize scripts and artifact paths | Roblox Studio GUI/Mac/Windows constraints make true containerization fragile; still a GUI validator | Prefer host Studio adapter first; revisit only after adapter contract is stable |
| Direct asset download and parse | Avoids Studio insertion bottleneck; unlocks fast asset inspection | Requires auth/permission handling; asset delivery failures are common; still needs visual proof | Add as an adapter behind the asset acquisition seam |
| Many autonomous Studio agents | Superficially parallel | Studio is serial and mutable; agents collide and lose active-place context | Reject; keep one Studio adapter/leader |

## Architecture Decisions

- **Use metadata contracts as the shared language.** Agents should pass JSON
  manifests and proof reports, not raw mental state.
- **Keep identity coordinator-owned.** Fragment agents do not own referents,
  parent assignment, `UniqueId`, or `HistoryId`.
- **Make Studio adapters replaceable.** `plan_batch_visual_gate` returns a
  wrapper contract that can be executed manually, by the official Studio MCP, or
  by a future proxy.
- **Keep prompt lanes narrow.** The asset curator does not build files. The
  headless builder does not sign off visuals. The Studio adapter does not choose
  assets.
- **Treat every visual claim as provisional until screenshot proof exists.**

## Pressure-Tested Hardening

The current repo already has useful seams, but the next reliability gains come
from making the seams executable and smaller.

| Finding | Why It Matters | Hardening Step |
| --- | --- | --- |
| Planning/visual and policy tool registration has been split out of `index.js` | A change to visual gates, headless contracts, e2e planning, or release policy should not collide with asset memory transport boot | Keep `asset-search-mcp/src/mcpTools/planningTools.js` and `asset-search-mcp/src/mcpTools/policyTools.js` focused; move remaining asset-memory tools only when a clear cluster is ready |
| Publish policy is separated from persistence | JSON IO, reviews, claims, publish permissions, palettes, and inspection memory change for different reasons | Keep atomic persistence in `store.js`; keep release-readiness rules in `asset-search-mcp/src/publishPolicy.js` and MCP policy wiring in `mcpTools/policyTools.js` |
| Batch visual gate starts with a mock executor | It reduces agent churn only if something can consume the packet and return a collated proof bundle | Extend `run-studio-batch-visual-gate.mjs` from mock transport to real Studio MCP transport while preserving the artifact contract |
| Fragment manifest aliases have canonical fixtures | Alias tolerance helps migration but can hide drift between JS validators and Luau writers | Keep `asset-search-mcp/fixtures/fragment-manifests` and `test:fragment-fixtures` as the cross-writer schema guard |
| Direct asset acquisition has an explicit seam | Search, permission proof, delivery, Studio fallback, quarantine, manifests, and screenshots can otherwise drift across agents | Use `plan_asset_acquisition` and `validate_asset_acquisition` before promoting delivered assets into palettes |
| Operator handoff must live in files | Chat-only workflow memory gets lost across agents and sessions | Keep `prompts/*.md` and test them with `test:prompt-contracts` |

## POC Matrix

| Claim | POC / Test | Evidence |
| --- | --- | --- |
| Cross-project asset memory can be canonicalized | `node scripts/merge_asset_brain_sources.mjs` and `npm --prefix asset-search-mcp run test:asset-brain` | `asset-brain/v1/manifest.json`, `asset-brain/v1/indexes/merged-project-assets.ndjson` |
| Roblox files can be created/mutated outside Studio | `lune run scripts/headless_place_insert_poc.luau` and `lune run scripts/headless_place_verify_poc.luau` | ignored files under `work/headless-poc/`, console `HEADLESS_*_OK` |
| Fragment fan-in can be coordinator-gated | `lune run scripts/headless_fragment_merge.luau ...` | manifest digest validation and reload of merged place |
| JS-generated and Luau-emitted fragment manifests normalize through one schema | `npm --prefix asset-search-mcp run test:fragment-fixtures` | `asset-search-mcp/fixtures/fragment-manifests/*.json` and `validate_fragment_manifest` |
| Asset acquisition is a gated seam | `npm --prefix asset-search-mcp run test:asset-acquisition` and `npm --prefix asset-search-mcp run test:smoke` | `plan_asset_acquisition`, `validate_asset_acquisition`, quarantine metadata, and metadata-only asset-brain checks |
| Studio proof can be batched and adapter-consumed | `npm --prefix asset-search-mcp run test:offline`, `npm --prefix asset-search-mcp run test:studio-adapter`, and `npm --prefix asset-search-mcp run test:smoke` | `plan_batch_visual_gate`, `run-studio-batch-visual-gate.mjs`, and `validate_batch_visual_gate` coverage |
| Prompts/docs stay present and aligned | `npm --prefix asset-search-mcp run test:prompt-contracts` | prompt and architecture contract test |
| The full proposed loop has fresh local evidence | `node scripts/run_ai_game_dev_pocs.mjs` | `docs/poc-results/ai-game-dev-poc-latest.json` |
| Source-game libraries can be converted into reusable module families | `node scripts/inventory_reusable_game_libraries.mjs` and `npm --prefix asset-search-mcp run test:game-kit` | `packages/roblox-game-kit/module-catalog.json`, `packages/roblox-game-kit/inventory/source-library-inventory.json` |
| The e2e game-design loop is a custom MCP contract | `npm --prefix asset-search-mcp run test:offline`, `npm --prefix asset-search-mcp run test:studio-adapter`, and `npm --prefix asset-search-mcp run test:smoke` | `plan_ai_game_dev_loop`, `validate_ai_game_dev_loop`, `docs/e2e-roblox-ai-game-design-loop.md` |

## Open Risks

- The current Studio adapter transport is mock-only; the artifact shape is ready
  for a live Studio MCP transport.
- Direct asset download/parse remains auth-sensitive and should be isolated from
  the metadata brain.
- Lune is good for the current coordinator POC, but rbx-dom should be evaluated
  for a production merge engine when fragment complexity grows.
- Studio screenshot quality still depends on camera occlusion, lighting, and the
  correct active Studio instance.

## Next Deepening Candidates

1. **Live Studio adapter module** — replace the mock transport in
   `run-studio-batch-visual-gate.mjs` with a real Studio MCP transport while
   preserving the proof bundle files.
2. **Authenticated asset delivery implementation** — plug real authenticated
   Asset Delivery and permission-dashboard evidence into the
   `plan_asset_acquisition` contract.
3. **Production coordinator module** — move from Lune-only scripts to an adapter
   interface with Lune and rbx-dom implementations.
4. **Project template module** — generate a new game repo skeleton with asset
   brain, prompts, POC scripts, and gates prewired.
