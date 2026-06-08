# asset-search-mcp Module Map

The domain model of the asset-search MCP, module by module. Names come from
[CONTEXT.md](../CONTEXT.md) (domain) and the architecture glossary (module,
interface, implementation, seam, depth, leverage, locality). This is the map an
agent should read before changing the server: it says what each module's
**interface** is, what **implementation** it hides, where its **seam** is, and
which test pins it.

A module is **deep** when a small interface hides a lot of behavior. The goal of
the 2026-06-08 deepening pass (see
[roblox-ai-game-dev-architecture.md](roblox-ai-game-dev-architecture.md) →
_Implemented Deepenings_) was to make the shallow seams deep.

## Loop phase → modules

The [Roblox AI game-dev loop](../CONTEXT.md) runs idea → playable place. Each
phase is owned by a module (or a small cluster):

| Phase | Module(s) | Interface (entry points) |
| --- | --- | --- |
| Discover / remember assets | `toolbox.js`, `store.js` + `dal/` | `searchAssets`, `Store` |
| Plan coverage / storyboard | `gameCoverage.js`, `index.js` | `buildGameAssetCoverage`, `roblox_preprocess_storyboard_asset_cache` |
| Acquire bytes | `assetAcquisition.js`, `assetDelivery.js` | `buildAssetAcquisitionPlan`, `executeAssetDeliveryRequest` |
| Assemble headlessly | `headlessPipeline.js`, `coordinatorAdapter.js` | `buildHeadlessAssemblyPlan`, `buildCoordinatorMergePlan` |
| Prove visually (Studio gate) | `studioMcpAdapterCore.js` + batch/family adapters, `visualBatchGate.js`, `worldAssetFamilySweep.js`, `playableSpaceReview.js` | `runStudioCaptureBatch`, `validate*` |
| Gate release | `propHuntGate.js`, `publishPolicy.js` | `validatePropHuntGate`, `evaluatePublishPermission` |
| Verdict shape (all gates) | `proofBundle.js` | `createFindings`, `sealVerdict`, `renderFindings` |
| Orchestrate end-to-end | `aiGameDevLoop.js`, `projectTemplate.js` | `buildAiGameDevLoopPlan`, `buildProjectTemplatePlan` |
| Expose as MCP tools | `index.js`, `mcpTools/registry.js`, `mcpTools/*Tools.js` | `roblox_*` tools |

## Deep modules

### Asset brain — `store.js` + `dal/`
- **Interface:** the `Store` class — `search/claim/review/inspect/commitPalette/brainStatus/…`.
- **Hides:** SQLite (WAL), six DAOs, the legacy JSON → SQLite migration, race-safe
  claim transactions, search-cache TTL.
- **Seam:** the DAL (`dal/index.js`) — storage is swappable behind the DAO
  interface; callers never see SQL. **Two-process safe.**
- **Why deep:** asset-reuse bugs (duplicate claims, stale rejections, cache
  poisoning) concentrate here, not across agents.
- **Tests:** `test:dal`, `test:offline`.

### Proof-bundle module — `proofBundle.js`
- **Interface:** `createFindings()` (collect), `sealVerdict()`/`withCounts()`
  (verdict), `renderFindings()`/`passLabel()` (present).
- **Hides:** the verdict envelope (`passed` + `errors` + `warnings` + `counts`)
  and the two render dialects — `bullets` for the `*-validation/v1` family,
  `inline` (`ERROR:`/`WARN:`) for the studio gate family.
- **Seam:** every gate validator/formatter routes its verdict through it; gates
  supply only domain checks (their depth).
- **Leverage:** one definition of "what a proof bundle looks like" across 8+
  gates. **Locality:** change the verdict shape once.
- **Tests:** `test:proof-bundle`, plus every `validate_*` gate test.

### Studio capture driver — `studioMcpAdapterCore.js`
- **Interface:** `runStudioCaptureBatch(client, plan, opts)` (live),
  `runMockStudioCaptureBatch(plan, opts)` (offline). Both return
  `{ preflight, executionLog, captures, failedCaptureIds, liveResponses }`.
- **Hides:** studio selection, active-place preflight, the serial
  `studio_mcp_steps` loop, screenshot writes, per-capture pass/fail, the
  execution log.
- **Seam:** the batch visual gate adapter and the world asset-family sweep
  adapter sit behind it and only shape their own reports. Two real transports
  (stdio + mock) justify the seam.
- **Tests:** `test:studio-core`, `test:studio-adapter`, `test:studio-world-family-adapter`.

### Coordinator adapter — `coordinatorAdapter.js`
- **Interface:** `buildCoordinatorMergePlan({adapter})`,
  `executeCoordinatorMergePlan`, `validateCoordinatorMergeReport`.
- **Seam:** two real adapters behind one report contract — `lune` (proven path)
  and `rbx_dom` (external command). Coordinator owns referent remap / identity.
- **Tests:** `test:coordinator-adapter`.

### Asset acquisition + delivery — `assetAcquisition.js`, `assetDelivery.js`
- **Interface:** `buildAssetAcquisitionPlan`/`validateAssetAcquisitionReport`;
  `buildAssetDeliveryRequest`/`executeAssetDeliveryRequest`/`validateAssetDeliveryReceipt`.
- **Seam:** acquisition plans the workflow (search → permission → deliver →
  quarantine → visual); delivery owns the authenticated request and the redacted
  [asset delivery receipt](../CONTEXT.md).
- **Credential seam:** the Open Cloud credential is sealed in a closure
  (`apply(headers)`); only the redacted receipt crosses the boundary. The
  live-headers resolver is **not** exported. **Locality:** secrets in one module.
- **Tests:** `test:asset-acquisition`, `test:asset-delivery`.

### Tool registry — `mcpTools/registry.js`
- **Interface:** `text`/`result`/`errorText` (response envelope), `ANNOTATIONS`
  (hint presets), `rendered(out, format, render)` (the format selector),
  `createToolRegistrar(server, annotations)` (registrar factory),
  `reportSchema`/`planSchema` (shared validate-tool input schemas).
- **Seam:** `index.js` and every `mcpTools/*Tools.js` cluster register through
  it, so result/error shapes don't drift and `index.js` passes only real
  dependencies (`store`) to clusters.
- **Tests:** `test:tool-registration` (fake-server cluster check + a real server
  boot that lists the full `roblox_` tool surface).

## Shallow-by-design (planners and validators)

These produce or check **metadata contracts**; their depth is in their domain
rules, not in hidden machinery:

- `gameCoverage.js` — coverage slots + dream-queue planner.
- `headlessPipeline.js` — assembly-plan builder (config + delegation) and the
  **deep** `validateFragmentManifest` (identity policy, script-loader rejection).
- `visualBatchGate.js`, `playableSpaceReview.js`, `worldAssetFamilySweep.js`,
  `propHuntGate.js`, `publishPolicy.js` — gates; each owns its checks and routes
  its verdict through `proofBundle.js`.
- `aiGameDevLoop.js` — composes the loop plan and validates the nested gates.
- `projectTemplate.js` — file-set planner + materializer; on-disk verification is
  an injectable seam (`verifyOnDisk`) so report-shape validation runs without
  disk and disk failures pin to the materialize layer.

## Non-negotiables (enforced in code, not just docs)

See [CONTEXT.md](../CONTEXT.md) → _Non-Negotiables_. The validators enforce them:
metadata-only asset brain (no binaries/screenshots/credentials), coordinator-owned
identity, visual proof requires player-height screenshots, family fixes must be
propagated. The asset delivery credential seam keeps secrets out of receipts.
