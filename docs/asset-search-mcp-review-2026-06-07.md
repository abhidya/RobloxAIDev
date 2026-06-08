# asset-search-mcp Review — Gaps & Improvements (2026-06-07)

Scope: `asset-search-mcp/` (37 tools across `src/index.js` + `src/mcpTools/{planning,policy,acquisition}Tools.js`), SDK 1.29.0, stdio transport. Full test suite passes (`npm test` → SMOKE OK). Reviewed against MCP best practices (naming, annotations, schemas, pagination, error handling, security).

> **Update 2026-06-08 (architecture deepening pass).** Several gaps below are now
> addressed by a structural pass (see `docs/roblox-ai-game-dev-architecture.md` →
> _Implemented Deepenings_). The new `src/mcpTools/registry.js` makes result and
> **error shapes consistent** across all clusters (was gap: the lone raw
> `isError` object in `commit_palette` now uses the shared `errorText`), and
> centralizes the repeated `format` selector. The new `src/proofBundle.js` gives
> the `validate_*` tools **one verdict/finding/proof-bundle definition** and
> render, the start of the "minimal top-level shape" idea in gap #7. **Gap #6
> (outputSchema)** is now done for the `validate_*` family: they declare a typed
> verdict `outputSchema` (`passed`/`errors`/`warnings`, passthrough for gate-
> specific extras) so clients consume structuredContent instead of parsing text.
> The tool count is now 41 (`roblox_`-prefixed), verified end-to-end by
> `test:tool-registration` (boots the server and calls a validator). The
> remaining gap (#10 pagination breadth) is unchanged.

## What's already strong

Cache-first + single-flight ranked search; shared rejection/claim/inspection memory; atomic JSON writes; metadata-only non-negotiable enforced in validators; redacted credential receipts (`api_key_env` names, never values); stdio logging correctly on stderr; consistent text/json `format` param on planning tools; thorough offline test suite (16 suites); Zod input validation everywhere.

## Gaps (ordered by impact)

### 1. Tool-name collisions — no service prefix 🔴
All 37 tools use bare names (`search_assets`, `claim_assets`, `get_palette`). The eggBreakers setup already has a *live collision*: the Roblox Studio MCP also exposes `search_assets`, which is exactly the wrapper-confusion documented in `eggBreakers_STATUS.md` ("do not use Codex's `mcp__Roblox_Search.search_assets`"). Best practice: prefix, e.g. `roblox_asset_search`, `roblox_asset_claim`, `roblox_palette_get`. Server name `asset-search` → `roblox-asset-search-mcp`.

### 2. Silent network failure ≠ empty results 🔴
`toolbox.js#fetchJson` swallows every error (`catch { return null }`). A Toolbox outage, rate-limit, or DNS failure returns the same answer as a genuinely empty search: "No on-theme, unclaimed Creator Store assets". Agents will record false negatives into the shared brain (and the 24h cache will *persist* an empty pool for a day). Fix: distinguish `{ok, status}` per category fetch; if all fetches failed, return `isError: true` with retry guidance; never cache an all-failures result.

### 3. Cross-process store races defeat the multi-agent promise 🔴
The brain's whole point is parallel agents, but `Store` loads `~/.roblox-asset-brain/*.json` once at startup and rewrites whole files on every mutation. Two MCP server processes (e.g. RobloxAIDev + eggBreakers sessions, or one per client) will last-writer-wins clobber claims/reviews. `claimAssets` is check-then-write with no cross-process lock — two agents *can* claim the same asset, which is the exact collision the tool exists to prevent. Single-flight only coalesces in-process. Fix options: lockfile (`proper-lockfile`), re-read-merge-write per mutation, or append-only NDJSON event log (you already use NDJSON in the pages layout) with on-read folding.

### 4. No claim release or expiry 🟠
`store.releaseClaim()` exists but is not exposed as a tool. Claims have timestamps but no TTL. A crashed/abandoned agent permanently hides assets from all future searches; the only fix today is hand-editing `claims.json`. Add `release_claim` / `release_stale_claims(max_age_hours)` tools, and consider a default claim TTL.

### 5. No tool annotations 🟠
Zero tools declare `readOnlyHint`/`destructiveHint`/`idempotentHint`. ~20 tools are pure reads or pure planners (`get_*`, `plan_*`, `validate_*`, `export_*`) and should declare `readOnlyHint: true` so clients can parallelize and skip approval prompts. Migrate `server.tool()` → `server.registerTool()` (SDK 1.29 supports `title`, `annotations`, `outputSchema`).

### 6. No outputSchema / structuredContent 🟠
Every tool returns a single text blob; JSON mode is `JSON.stringify` inside text. SDK 1.29 supports `outputSchema` + `structuredContent` — the validator and snapshot tools have stable shapes (`schema: "roblox-...-/v1"`) that are ideal candidates. This matters for the artifact/automation consumers you're planning (GitHub Pages brain).

### 7. Weak enum and report validation 🟠
- `review_asset.verdict` is `z.string()` though the description says `keep | reject | maybe`. `isRejected` matches `startsWith("rej")`, so a "discard"/"no" verdict silently never excludes the asset. Make it an enum (it already is in `record_inspection.screenshot_verdict`).
- All `validate_*` tools take `report: z.record(z.any())` — fine for flexibility, but a minimal top-level shape (schema string + required sections) would reject malformed reports at the boundary with a clearer error than the validator's downstream findings. (The 2026-06-06 cowork review's "blank finding" bug is this class of problem.)

### 8. Duplicate inspection schema (DRY) 🟡
`record_inspection`'s inline schema (index.js:480–492) duplicates `inspectionSchema` (499–514) field-for-field. Use `inspectionSchema.shape` (minus `asset_id`) in the single-record tool, like `policyTools.js` already does with `publishPermissionSchema.shape`.

### 9. Unbounded cache growth + write amplification 🟡
`putCachedSearch` never evicts; `pruneSearchCache` exists but is never called (not exposed as a tool, not run on startup). Every cached search rewrites the entire `search-cache.json`. After heavy `warm_search_cache` use this file gets large and every write is O(file). Prune expired entries on startup and/or expose `prune_search_cache` + `brain_status` (also unexposed) as tools.

### 10. No pagination metadata 🟡
`search_assets` caps at a 40-asset pool with `max_results` but returns no `has_more`/`total`/offset; `get_palette` and snapshot tools dump everything. Low priority given pool sizes, but `export_asset_brain_snapshot` over a 500-asset release palette will be one giant blob — add offset/limit there first.

### 11. Misc 🟡
- `search_assets`/`curate_assets` lack the `format: json` option other tools have — agents that want structured candidates must parse the text format.
- `formatAsset` shows `SCRIPT_REVIEW(n)` but search text answer always appends "Measure geometry in Studio (StudioMCP) before placing." even for Audio/Decal/FontFamily results.
- `main()` startup message says "v0.8" hardcoded — derive from package.json so it can't drift.
- README/`package.json` description drift risk: description lists features; consider pointing at a generated tool list instead.

## Suggested order of work

1. Prefix tool names + server rename (breaking — do it before more prompts/docs hardcode names; update RobloxAIDev prompt lanes + eggBreakers SWARM_HANDOFF in the same pass).
2. Fix silent-failure search path + never-cache-failures (small, prevents poisoning the shared brain).
3. Store locking or event-log persistence (restores the multi-agent guarantee).
4. Expose `release_claim`, `brain_status`, `prune_search_cache`; add claim TTL.
5. `registerTool` migration with annotations + outputSchema on validators/snapshot.
6. Enum tightening + report top-level shape validation.
7. DRY/format/pagination cleanups.

After 1–3, rerun the suite and add tests: concurrent claim race (two Store instances, one dir), search failure vs empty distinction, and stale-claim release.
