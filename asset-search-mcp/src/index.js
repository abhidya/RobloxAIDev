#!/usr/bin/env node
// roblox-asset-search-mcp — the shared "asset brain" for asset-driven,
// multi-agent Roblox game design. Decoupled from the Roblox Studio MCP: it
// discovers, ranks, curates, and REMEMBERS Creator Store assets so parallel
// agents never re-search, re-preview, or re-reject the same items, and stay
// on-theme. All tools are prefixed roblox_ to avoid collisions with other
// Roblox MCP servers (the Studio MCP also exposes a bare search_assets).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchAssets, DEFAULT_CATEGORIES, ToolboxSearchError } from "./toolbox.js";
import { Store, DEFAULT_STALE_CLAIM_MS, SEARCH_TTL_MS, diversify, filterByTerms } from "./store.js";
import { buildGameAssetCoverage } from "./gameCoverage.js";
import { registerAcquisitionTools } from "./mcpTools/acquisitionTools.js";
import { registerPlanningTools } from "./mcpTools/planningTools.js";
import { registerPolicyTools } from "./mcpTools/policyTools.js";
import { ANNOTATIONS, errorText, rendered, result, text, verdictOutputSchema } from "./mcpTools/registry.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "./propHuntGate.js";

const PKG = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

const store = new Store();
const POOL = 40; // raw candidates fetched + cached per query; excludes applied after

// Response envelope (text/result/errorText), the format selector (rendered),
// and the annotation presets all live in the tool registry now, so index.js and
// every cluster register through one seam instead of passing plumbing around.
const { READ_LOCAL, READ_NETWORK, WRITE_LOCAL, WRITE_DESTRUCTIVE } = ANNOTATIONS;

// Cache-first + single-flight raw pool (cached WITHOUT excludes for max reuse).
// Throws ToolboxSearchError when ALL fetches fail — failures are NEVER cached,
// so an API outage can't poison the shared 24h cache with false empties.
async function rankedSearch(opts) {
  const key = Store.searchKey(opts);
  const cached = store.getCachedSearch(key);
  if (cached) return { ranked: cached, fromCache: true, failures: [] };
  return store.coalesce(key, async () => {
    const again = store.getCachedSearch(key);
    if (again) return { ranked: again, fromCache: true, failures: [] };
    const { assets, meta } = await searchAssets({ ...opts, maxResults: POOL });
    await store.putCachedSearch(key, assets);
    return { ranked: assets, fromCache: false, failures: meta.failures };
  });
}

// Remove rejected / claimed / explicitly-excluded / off-theme candidates.
function applyExcludes(ranked, o) {
  const ex = new Set((o.excludeIds || []).map(Number));
  if (o.excludeRejected) for (const id of store.rejectedIdSet()) ex.add(id);
  if (o.excludeClaimed) for (const id of store.claimedIdSet()) ex.add(id);
  let pool = ranked.filter((a) => !ex.has(a.id));
  pool = filterByTerms(pool, o.excludeTerms);
  return { pool, removed: ranked.length - pool.length };
}

function applyPublishPermissionFilter(pool, o) {
  if (!o.excludeUnpublishable) return { pool, removed: 0 };
  const options = {
    mode: o.publishPermissionMode || "grantable_or_open_use",
    requireStudioProbe: !!o.requireStudioProbe,
    requireSaveReopen: !!o.requireSaveReopen,
  };
  const filtered = pool.filter((asset) => store.evaluatePublishPermission(asset.id, options).passed);
  return { pool: filtered, removed: pool.length - filtered.length };
}

function annotationSuffix(id) {
  const a = store.annotate(id);
  const bits = [];
  if (a.claimedBy) bits.push(`CLAIMED:${a.claimedBy}`);
  if (a.publishPermission?.status) bits.push(`PERM:${a.publishPermission.status}`);
  for (const r of a.reviews) bits.push(`${r.verdict}${r.notes ? `(${r.notes})` : ""}`);
  return bits.length ? `  «${bits.join("; ")}»` : "";
}

function formatAsset(a, index) {
  const flags = [];
  if (a.verified) flags.push("verified");
  if (a.hasScripts) flags.push(`SCRIPT_REVIEW(${a.scriptCount})`);
  const mesh = a.triangles != null ? ` tris=${a.triangles}` : "";
  const desc = (a.description || "").split("\n")[0].trim().slice(0, 90);
  return [
    `${index + 1}. ${a.name} (ID: ${a.id})${annotationSuffix(a.id)}`,
    `   category=${a.category} creator=${a.creator}${flags.length ? " [" + flags.join(", ") + "]" : ""} score=${a.score.toFixed(1)} votes=${a.voteCount}${mesh}`,
    desc ? `   ${desc}` : "",
  ].filter(Boolean).join("\n");
}

function formatPaletteSeed(slot, entry, index) {
  const annotation = store.annotate(entry.assetId);
  const bits = [];
  if (annotation.inspection?.screenshotVerdict) bits.push(`visual=${annotation.inspection.screenshotVerdict}`);
  if (annotation.inspection?.visualRiskScore != null) bits.push(`risk=${annotation.inspection.visualRiskScore}`);
  if (annotation.rejected) bits.push("REJECTED");
  return [
    `${index + 1}. ${entry.name || "Committed palette asset"} (ID: ${entry.assetId})  «PALETTE:${slot}${bits.length ? "; " + bits.join("; ") : ""}»`,
    "   source=committed palette; use roblox_get_inspection/roblox_get_reviews before Studio work",
  ].join("\n");
}

/** Strip a normalized asset to the fields agents need in JSON mode. */
function liteAsset(a) {
  return {
    id: a.id, name: a.name, category: a.category, creator: a.creator,
    verified: a.verified, score: a.score, voteCount: a.voteCount,
    hasScripts: a.hasScripts, scriptCount: a.scriptCount, triangles: a.triangles,
  };
}

function geometryReminder(assets) {
  return assets.some((a) => a.category === "Model" || a.category === "MeshPart")
    ? "\n\nMeasure geometry in Studio (StudioMCP) before placing."
    : "";
}

function partialFailureNote(failures) {
  if (!failures.length) return "";
  const sample = failures.slice(0, 2).map((f) => `${f.category}: ${f.error}`).join("; ");
  return `\n\nWARNING: ${failures.length} category fetch(es) failed (${sample}) — results may be incomplete; cached anyway because some categories succeeded.`;
}

const server = new McpServer({ name: "roblox-asset-search", version: PKG.version });
registerPlanningTools(server);
registerPolicyTools(server, { store });
registerAcquisitionTools(server);

function shardForAssetId(assetId) {
  return String(assetId).replace(/\D/g, "").slice(0, 3) || "unknown";
}

function pagesLayout(project) {
  const root = `asset-brain/v1`;
  return {
    manifest: `${root}/manifest.json`,
    asset: `${root}/assets/by-id/{shard}/{assetId}.json`,
    enrichment_events: `${root}/enrichments/by-asset/{shard}/{assetId}.ndjson`,
    reviews: `${root}/reviews/by-asset/{shard}/{assetId}.ndjson`,
    permissions: `${root}/permissions/by-asset/{shard}/{assetId}.json`,
    palette: `${root}/palettes/${project}.json`,
    indexes: [
      `${root}/indexes/assets-lite.ndjson`,
      `${root}/indexes/queries-lite.ndjson`,
      `${root}/indexes/rejected-assets.ndjson`,
      `${root}/indexes/publish-readiness.ndjson`,
    ],
  };
}

function collectAssetIdsForSnapshot(project) {
  const ids = new Set();
  for (const id of store.reviewedAssetIds()) ids.add(Number(id));
  for (const id of store.claimedAssetIds()) ids.add(Number(id));
  for (const id of store.inspectedAssetIds()) ids.add(Number(id));
  for (const id of store.permissionAssetIds()) ids.add(Number(id));
  for (const entry of Object.values(store.getPalette(project) || {})) {
    if (entry?.assetId != null) ids.add(Number(entry.assetId));
  }
  return [...ids].filter(Number.isFinite).sort((a, b) => a - b);
}

function buildAssetBrainSnapshot({
  project = "prophunt",
  includeSearchCache = false,
  maxQueries = 100,
  maxResultsPerQuery = 8,
  assetOffset = 0,
  maxAssets = 500,
} = {}) {
  const allAssetIds = collectAssetIdsForSnapshot(project);
  const assetIds = allAssetIds.slice(assetOffset, assetOffset + maxAssets);
  const assets = assetIds.map((assetId) => {
    const annotation = store.annotate(assetId);
    const inspection = annotation.inspection || {};
    const publishPermission = store.getPublishPermission(assetId);
    const publishEvaluation = store.evaluatePublishPermission(assetId);
    return {
      assetId,
      shard: shardForAssetId(assetId),
      claimedBy: annotation.claimedBy || null,
      rejected: annotation.rejected,
      reviews: annotation.reviews,
      inspection,
      visual: {
        screenshotVerdict: inspection.screenshotVerdict || "not_reviewed",
        visualRiskScore: inspection.visualRiskScore ?? null,
        visualRisks: inspection.visualRisks || [],
      },
      publishPermission,
      publishReadiness: publishEvaluation,
    };
  });

  const searchQueries = [];
  if (includeSearchCache) {
    for (const entry of store.searchCacheEntries(maxQueries)) {
      searchQueries.push({
        key: entry.key,
        createdAt: entry.createdAt || null,
        resultCount: entry.ranked.length,
        topResults: entry.ranked.slice(0, maxResultsPerQuery).map((asset) => ({
          id: asset.id,
          name: asset.name,
          category: asset.category,
          creator: asset.creator,
          score: asset.score,
          hasScripts: asset.hasScripts,
        })),
      });
    }
  }

  const status = store.brainStatus();
  return {
    schema: "roblox-asset-brain-snapshot/v1",
    project,
    generatedAt: new Date().toISOString(),
    counts: {
      assets: assets.length,
      assetsTotal: allAssetIds.length,
      searchQueries: searchQueries.length,
      reviews: status.counts.reviews,
      inspections: status.counts.inspections,
      publishPermissions: status.counts.publishPermissions,
      claims: status.counts.claims,
      paletteAssets: Object.keys(store.getPalette(project) || {}).length,
    },
    pagination: {
      assetOffset,
      assetCount: assets.length,
      assetTotal: allAssetIds.length,
      hasMore: assetOffset + assets.length < allAssetIds.length,
      nextAssetOffset: assetOffset + assets.length < allAssetIds.length ? assetOffset + assets.length : null,
    },
    pagesLayout: pagesLayout(project),
    palette: store.getPalette(project),
    assets,
    searchQueries,
  };
}

function formatAssetBrainSnapshot(snapshot) {
  return [
    `Asset brain snapshot '${snapshot.project}'`,
    `assets=${snapshot.counts.assets}/${snapshot.counts.assetsTotal} palette=${snapshot.counts.paletteAssets} reviews=${snapshot.counts.reviews} inspections=${snapshot.counts.inspections} queries=${snapshot.counts.searchQueries}`,
    `pages=${snapshot.pagesLayout.manifest}${snapshot.pagination.hasMore ? ` (more: next_asset_offset=${snapshot.pagination.nextAssetOffset})` : ""}`,
    "",
    "Asset shards:",
    ...snapshot.assets.slice(0, 20).map((asset) => `- ${asset.assetId} shard=${asset.shard} rejected=${asset.rejected} visual=${asset.visual.screenshotVerdict} publish=${asset.publishReadiness.passed ? "pass" : "fail"}`),
  ].join("\n");
}

server.registerTool(
  "roblox_preprocess_storyboard_asset_cache",
  {
    title: "Preprocess storyboard asset cache",
    description: "Preprocess the asset-search cache for asset-driven storyboarding and headless Roblox file assembly. Builds coverage slots, optionally warms ranked search cache for each slot, and returns storyboard/headless inputs plus the GitHub Pages-friendly metadata layout. Use this before storyboarding so the game bends to cached Creator Store evidence.",
    inputSchema: {
      project: z.string().optional().describe("Project/cache name (default: prophunt)."),
      game: z.string().optional().describe("Short game idea or title."),
      themes: z.array(z.string()).optional().describe("Room/story themes to cover."),
      include_defaults: z.boolean().optional().describe("Add default expansion themes when true (default true)."),
      include_lobby: z.boolean().optional().describe("Include lobby/social shell slots when true (default true)."),
      max_themes: z.number().int().min(1).max(12).optional(),
      max_slots: z.number().int().min(1).max(80).optional().describe("Maximum coverage slots to include/warm (default 40)."),
      warm_search_cache: z.boolean().optional().describe("Actually run ranked searches to populate the cache (default false)."),
      per_slot: z.number().int().min(1).max(10).optional().describe("Candidates returned per warmed slot (default 3)."),
      verified_only: z.boolean().optional(),
      extensive: z.boolean().optional().describe("Use expanded search variants while warming cache."),
      format: z.enum(["text", "json"]).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (args) => {
    const project = args.project || "prophunt";
    const coverage = buildGameAssetCoverage({
      game: args.game || project,
      themes: args.themes || [],
      includeDefaults: args.include_defaults !== false,
      includeLobby: args.include_lobby !== false,
      maxThemes: args.max_themes ?? 6,
    });
    const slots = coverage.slots.slice(0, args.max_slots ?? 40);
    const warmed = [];
    const warmFailures = [];
    if (args.warm_search_cache) {
      for (const slot of slots) {
        try {
          const { ranked } = await rankedSearch({
            query: slot.query,
            verifiedOnly: args.verified_only,
            extensive: args.extensive,
          });
          const { pool, removed } = applyExcludes(ranked, {
            excludeRejected: true,
            excludeClaimed: false,
            excludeTerms: [],
          });
          warmed.push({
            slot: slot.slot,
            query: slot.query,
            candidates: pool.slice(0, args.per_slot ?? 3).map(liteAsset),
            filtered: removed,
          });
        } catch (error) {
          if (!(error instanceof ToolboxSearchError)) throw error;
          warmFailures.push({ slot: slot.slot, query: slot.query, error: error.message });
        }
      }
    }
    const out = {
      schema: "roblox-storyboard-cache-preprocess/v1",
      project,
      game: coverage.game,
      themes: coverage.themes,
      slots,
      warmed,
      warmFailures,
      pagesLayout: pagesLayout(project),
      next: [
        "Use warmed candidates for storyboarding; do not invent uncached assets.",
        "Claim shortlisted assets (roblox_claim_assets) before Studio/lab inspection.",
        "Record geometry, script audit, and visual risk with roblox_record_inspection.",
        "Commit palette winners, then call roblox_plan_headless_assembly for .rbxm/.rbxlx work packets.",
      ],
    };
    return rendered(out, args.format, () => [
      `Preprocessed storyboard cache plan for '${project}'`,
      `slots=${slots.length} warmed=${warmed.length}${warmFailures.length ? ` warm_failures=${warmFailures.length}` : ""} themes=${out.themes.join(", ")}`,
      `pages=${out.pagesLayout.manifest}`,
      "",
      "Slots:",
      ...slots.slice(0, 30).map((slot) => `- ${slot.slot}: ${slot.query}`),
      ...(warmFailures.length ? ["", "Warm failures (API/network — retry these):", ...warmFailures.map((f) => `- ${f.slot}: ${f.error}`)] : []),
      "",
      "Next:",
      ...out.next.map((step) => `- ${step}`),
    ].join("\n"));
  }
);

server.registerTool(
  "roblox_export_asset_brain_snapshot",
  {
    title: "Export asset brain snapshot",
    description: "Export a compact, GitHub Pages-friendly snapshot of the asset-search brain: palette, reviews, claims, inspections, visual risk metadata, and optional capped search-cache summaries. Returns metadata only, never binary assets or screenshots. Paginate large brains with asset_offset/max_assets.",
    inputSchema: {
      project: z.string().optional().describe("Palette project name (default: prophunt)."),
      include_search_cache: z.boolean().optional().describe("Include capped lightweight search-query summaries (default false)."),
      max_queries: z.number().int().min(1).max(500).optional(),
      max_results_per_query: z.number().int().min(1).max(20).optional(),
      asset_offset: z.number().int().min(0).optional().describe("Pagination offset into the sorted asset id list (default 0)."),
      max_assets: z.number().int().min(1).max(2000).optional().describe("Max assets per page (default 500)."),
      format: z.enum(["text", "json"]).optional(),
    },
    annotations: READ_LOCAL,
  },
  async (args) => {
    const snapshot = buildAssetBrainSnapshot({
      project: args.project || "prophunt",
      includeSearchCache: !!args.include_search_cache,
      maxQueries: args.max_queries ?? 100,
      maxResultsPerQuery: args.max_results_per_query ?? 8,
      assetOffset: args.asset_offset ?? 0,
      maxAssets: args.max_assets ?? 500,
    });
    return rendered(snapshot, args.format, formatAssetBrainSnapshot);
  }
);

server.registerTool(
  "roblox_search_assets",
  {
    title: "Search Creator Store assets",
    description: "Search the Roblox Creator Store (Toolbox v2), ranked + de-duplicated, CACHED (24h) and single-flighted so parallel agents are cheap. The shared brain auto-excludes assets other agents already rejected or claimed, and you can pass exclude_terms to drop off-theme results (e.g. ['palm','tropical','sci-fi'] when searching medieval). Each result is annotated with prior verdicts/claims so you never re-evaluate a known item. API/network outages return an explicit error (never a fake empty list) and are never cached.",
    inputSchema: {
      query: z.string(),
      max_results: z.number().int().min(1).max(40).optional().describe("How many to show after exclusions (default 10)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset into the filtered pool (default 0)"),
      categories: z.array(z.string()).optional().describe(`Default: ${DEFAULT_CATEGORIES.join(", ")}`),
      verified_only: z.boolean().optional(),
      extensive: z.boolean().optional().describe("Expand query into variants for broader exploration"),
      exclude_terms: z.array(z.string()).optional().describe("Drop results whose NAME contains any of these (off-theme filter)"),
      exclude_rejected: z.boolean().optional().describe("Hide assets already rejected by any agent (default true)"),
      exclude_claimed: z.boolean().optional().describe("Hide assets already claimed/committed by another slot (default false)"),
      exclude_ids: z.array(z.number()).optional(),
      exclude_unpublishable: z.boolean().optional().describe("Hide assets without passing publish-permission proof (default false, because search is usually exploratory)."),
      publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
      require_studio_probe: z.boolean().optional(),
      require_save_reopen: z.boolean().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    annotations: READ_NETWORK,
  },
  async (args) => {
    const query = (args.query || "").trim();
    if (!query) return errorText("query must not be empty");
    let searched;
    try {
      searched = await rankedSearch({ query, categories: args.categories, verifiedOnly: args.verified_only, extensive: args.extensive });
    } catch (error) {
      if (error instanceof ToolboxSearchError) return errorText(error.message);
      throw error;
    }
    const { ranked, failures } = searched;
    const { pool: excludedPool, removed } = applyExcludes(ranked, {
      excludeRejected: args.exclude_rejected !== false,
      excludeClaimed: !!args.exclude_claimed,
      excludeIds: args.exclude_ids,
      excludeTerms: args.exclude_terms,
    });
    const { pool, removed: permissionRemoved } = applyPublishPermissionFilter(excludedPool, {
      excludeUnpublishable: !!args.exclude_unpublishable,
      publishPermissionMode: args.publish_permission_mode,
      requireStudioProbe: args.require_studio_probe,
      requireSaveReopen: args.require_save_reopen,
    });
    const offset = args.offset ?? 0;
    const limit = args.max_results ?? 10;
    const shown = pool.slice(offset, offset + limit);
    const pagination = {
      total: pool.length,
      offset,
      count: shown.length,
      hasMore: offset + shown.length < pool.length,
      nextOffset: offset + shown.length < pool.length ? offset + shown.length : null,
    };
    if (args.format === "json") {
      return result({
        schema: "roblox-asset-search-results/v1",
        query,
        pagination,
        filtered: removed,
        publishFiltered: permissionRemoved,
        fetchFailures: failures,
        assets: shown.map((a) => ({ ...liteAsset(a), annotations: store.annotate(a.id) })),
      });
    }
    if (!shown.length) return text(`No on-theme, unclaimed Creator Store assets for '${query}' (pool=${pool.length}, filtered ${removed}, publish-filtered ${permissionRemoved}).${partialFailureNote(failures)}`);
    const head = `Found ${shown.length} of ${pool.length} assets for '${query}'${args.extensive ? " (extensive)" : ""} — ${removed} filtered (rejected/claimed/off-theme), ${permissionRemoved} publish-filtered${pagination.hasMore ? `, more at offset=${pagination.nextOffset}` : ""}:`;
    return text(`${head}\n${shown.map(formatAsset).join("\n")}${geometryReminder(shown)}${partialFailureNote(failures)}`);
  }
);

server.registerTool(
  "roblox_curate_assets",
  {
    title: "Curate assets per storyboard slot",
    description: "Turn a storyboard's slots into a diverse, de-duplicated shortlist per slot — the right tool for parallel agents. Auto-excludes rejected + claimed assets, applies per-slot off-theme filters, caps picks per creator, and guarantees NO asset is suggested for two slots in one call. Pair with roblox_claim_assets so agents lock in their picks and the next agent's curation skips them. Pass project + include_palette=true to surface already committed palette assets when live search is sparse or stale.",
    inputSchema: {
      project: z.string().optional().describe("Optional palette project used when include_palette=true."),
      include_palette: z.boolean().optional().describe("Include committed palette entries for matching slots as fallback evidence (default false)."),
      slots: z.array(z.object({
        slot: z.string(),
        query: z.string(),
        exclude_terms: z.array(z.string()).optional(),
      })).describe("e.g. [{slot:'barrel', query:'medieval barrel', exclude_terms:['sci-fi','neon']}]"),
      per_slot: z.number().int().min(1).max(15).optional().describe("Shortlist size per slot (default 5)"),
      verified_only: z.boolean().optional(),
      extensive: z.boolean().optional(),
      exclude_terms: z.array(z.string()).optional().describe("Global off-theme terms applied to every slot"),
      exclude_claimed: z.boolean().optional().describe("Skip assets already claimed by other slots (default true)"),
      exclude_unpublishable: z.boolean().optional().describe("Hide assets without passing publish-permission proof (default false for exploratory curation)."),
      publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
      require_studio_probe: z.boolean().optional(),
      require_save_reopen: z.boolean().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    annotations: READ_NETWORK,
  },
  async (args) => {
    const perSlot = args.per_slot ?? 5;
    const chosen = new Set(); // cross-slot dedup within this call
    const sections = [];
    const jsonSlots = [];
    for (const s of args.slots) {
      try {
        const { ranked, failures } = await rankedSearch({ query: s.query, verifiedOnly: args.verified_only, extensive: args.extensive });
        const { pool: excludedPool, removed } = applyExcludes(ranked, {
          excludeRejected: true,
          excludeClaimed: args.exclude_claimed !== false,
          excludeIds: [...chosen],
          excludeTerms: [...(args.exclude_terms || []), ...(s.exclude_terms || [])],
        });
        const { pool, removed: permissionRemoved } = applyPublishPermissionFilter(excludedPool, {
          excludeUnpublishable: !!args.exclude_unpublishable,
          publishPermissionMode: args.publish_permission_mode,
          requireStudioProbe: args.require_studio_probe,
          requireSaveReopen: args.require_save_reopen,
        });
        const curated = diversify(pool, perSlot, 2);
        curated.forEach((a) => chosen.add(a.id));
        const paletteEntry = args.include_palette && args.project ? store.getPalette(args.project)[s.slot] : null;
        const lines = curated.length ? curated.map(formatAsset) : [];
        let paletteFallback = false;
        if (paletteEntry && !chosen.has(Number(paletteEntry.assetId))) {
          lines.push(formatPaletteSeed(s.slot, paletteEntry, lines.length));
          chosen.add(Number(paletteEntry.assetId));
          paletteFallback = true;
        }
        const body = lines.length ? lines.join("\n") : "   (no on-theme candidates)";
        const diagnostics = `   diagnostics: raw=${ranked.length} filtered=${removed} publish_filtered=${permissionRemoved} curated=${curated.length}${paletteFallback ? " palette_fallback=1" : ""}${failures.length ? ` fetch_failures=${failures.length}` : ""}`;
        sections.push(`## slot '${s.slot}'  query='${s.query}'\n${body}\n${diagnostics}`);
        jsonSlots.push({
          slot: s.slot, query: s.query, ok: true,
          candidates: curated.map(liteAsset),
          paletteFallback: paletteFallback ? { assetId: Number(paletteEntry.assetId), name: paletteEntry.name || null } : null,
          diagnostics: { raw: ranked.length, filtered: removed, publishFiltered: permissionRemoved, fetchFailures: failures },
        });
      } catch (e) {
        const failureKind = e instanceof ToolboxSearchError ? "API/network failure (retry, nothing cached)" : "search failed";
        // Even when live search is down, a committed palette entry is still
        // valid evidence — surface it so the slot isn't dead in an outage.
        const paletteEntry = args.include_palette && args.project ? store.getPalette(args.project)[s.slot] : null;
        const fallbackLines = [];
        if (paletteEntry && !chosen.has(Number(paletteEntry.assetId))) {
          fallbackLines.push(formatPaletteSeed(s.slot, paletteEntry, 0));
          chosen.add(Number(paletteEntry.assetId));
        }
        sections.push(`## slot '${s.slot}'  query='${s.query}'\n${fallbackLines.join("\n") || "   (no candidates)"}\n   ${failureKind}: ${e.message}\n   diagnostics: search_error=1${fallbackLines.length ? " palette_fallback=1" : ""}`);
        jsonSlots.push({
          slot: s.slot, query: s.query, ok: false, error: e.message,
          paletteFallback: fallbackLines.length ? { assetId: Number(paletteEntry.assetId), name: paletteEntry.name || null } : null,
        });
      }
    }
    if (args.format === "json") return result({ schema: "roblox-asset-curation/v1", slots: jsonSlots });
    return text(sections.join("\n\n"));
  }
);

server.registerTool(
  "roblox_claim_assets",
  {
    title: "Claim assets for a slot",
    description: "Reserve asset ids for a design slot so other parallel agents' search/curate calls hide them. Transactional in SQLite: two agent processes can never claim the same asset. Returns which ids were claimed vs already taken.",
    inputSchema: {
      project: z.string(),
      slot: z.string(),
      asset_ids: z.array(z.number()),
      reviewer: z.string().optional().describe("Agent/slot identifier"),
    },
    annotations: WRITE_LOCAL,
  },
  async (args) => {
    const { claimed, skipped } = await store.claimAssets(args.project, args.slot, args.asset_ids, args.reviewer);
    let msg = `Claimed ${claimed.length} for '${args.slot}': ${claimed.join(", ") || "none"}.`;
    if (skipped.length) msg += `\nAlready claimed elsewhere: ${skipped.map((s) => `${s.id}→${s.by}`).join(", ")}.`;
    return result({ claimed, skipped }, msg);
  }
);

server.registerTool(
  "roblox_release_claim",
  {
    title: "Release a claimed asset",
    description: "Release one asset id's claim so other agents can pick it again. Use when a slot changes direction or an agent abandons a shortlist.",
    inputSchema: { asset_id: z.number() },
    annotations: WRITE_DESTRUCTIVE,
  },
  async (args) => {
    const released = await store.releaseClaim(args.asset_id);
    return result({ assetId: args.asset_id, released }, released ? `Released claim on ${args.asset_id}.` : `No claim existed for ${args.asset_id}.`);
  }
);

server.registerTool(
  "roblox_release_stale_claims",
  {
    title: "Release stale claims",
    description: "Release every claim older than max_age_hours (default 168h = 7 days). Crashed or abandoned agent sessions leave claims behind that permanently hide assets from all future searches — run this periodically to reclaim them. Committed palette assets get re-claimed automatically on commit, so legitimate winners survive.",
    inputSchema: {
      max_age_hours: z.number().min(1).optional().describe("Claims older than this are released (default 168)."),
      dry_run: z.boolean().optional().describe("List stale claims without releasing (default false)."),
    },
    annotations: WRITE_DESTRUCTIVE,
  },
  async (args) => {
    const maxAgeMs = (args.max_age_hours ?? DEFAULT_STALE_CLAIM_MS / 36e5) * 36e5;
    if (args.dry_run) {
      const cutoff = Date.now() - maxAgeMs;
      const stale = store.dal.claims.all().filter((c) => c.at < cutoff);
      return result({ dryRun: true, stale }, `${stale.length} stale claim(s) older than ${Math.round(maxAgeMs / 36e5)}h:\n${stale.map((c) => `- ${c.assetId} (${c.slot}, age ${Math.round((Date.now() - c.at) / 36e5)}h)`).join("\n") || "(none)"}`);
    }
    const released = await store.releaseStaleClaims(maxAgeMs);
    return result({ dryRun: false, released }, `Released ${released.length} stale claim(s) older than ${Math.round(maxAgeMs / 36e5)}h${released.length ? `: ${released.map((c) => c.assetId).join(", ")}` : ""}.`);
  }
);

server.registerTool(
  "roblox_reject_asset",
  {
    title: "Reject an asset",
    description: "Record that an asset is unsuitable (with a reason). It is then auto-excluded from every agent's future search/curate, so no one re-finds, re-previews, or re-rejects it.",
    inputSchema: {
      asset_id: z.number(),
      reason: z.string().describe("Why — e.g. 'oversized', 'has scripts', 'off-theme', 'untextured'"),
      slot: z.string().optional(),
      reviewer: z.string().optional(),
    },
    annotations: WRITE_LOCAL,
  },
  async (args) => {
    await store.addReview(args.asset_id, { verdict: "reject", notes: args.reason, slot: args.slot ?? null, reviewer: args.reviewer ?? null });
    return text(`Rejected ${args.asset_id} (${args.reason}). It is now hidden from all agents' results.`);
  }
);

server.registerTool(
  "roblox_review_asset",
  {
    title: "Review an asset",
    description: "Persist a verdict (keep/reject/maybe + notes) shared across agents. 'reject' verdicts auto-exclude the asset from future results. Returns all reviews for the asset.",
    inputSchema: {
      asset_id: z.number(),
      verdict: z.enum(["keep", "reject", "maybe"]),
      slot: z.string().optional(),
      rating: z.number().int().min(0).max(10).optional(),
      notes: z.string().optional(),
      reviewer: z.string().optional(),
    },
    annotations: WRITE_LOCAL,
  },
  async (args) => {
    await store.addReview(args.asset_id, { verdict: args.verdict, slot: args.slot ?? null, rating: args.rating ?? null, notes: args.notes ?? null, reviewer: args.reviewer ?? null });
    return text(`Recorded '${args.verdict}' for ${args.asset_id}. ${store.getReviews(args.asset_id).length} total review(s).`);
  }
);

server.registerTool(
  "roblox_get_reviews",
  {
    title: "Get reviews for an asset",
    description: "Get all persisted reviews + claim status for an asset id (so you can skip re-evaluating it).",
    inputSchema: { asset_id: z.number() },
    annotations: READ_LOCAL,
  },
  async (args) => result(store.annotate(args.asset_id))
);

const inspectionFields = {
  slot: z.string().optional(),
  size_studs: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional().describe("Bounding-box size from Studio in studs."),
  has_scripts: z.boolean().optional(),
  script_count: z.number().int().min(0).optional(),
  base_part_count: z.number().int().min(0).optional(),
  anchored_capable: z.boolean().optional(),
  primary_part: z.boolean().optional().describe("True when the model has or can be assigned a PrimaryPart for disguise registration."),
  issues: z.array(z.string()).optional(),
  visual_risks: z.array(z.string()).optional().describe("Player-angle screenshot risks such as floating, sparse, misoriented, occluding camera, or off-theme."),
  visual_risk_score: z.number().int().min(0).max(10).optional().describe("0=no visible risk, 10=must reject or replace after player-angle review."),
  screenshot_verdict: z.enum(["not_reviewed", "pass", "fix", "reject"]).optional().describe("Latest player-angle screenshot verdict for this asset."),
  reviewer: z.string().optional(),
  source: z.string().optional().describe("Usually StudioMCP or a specific inspection pass label."),
};
const inspectionSchema = z.object({ asset_id: z.number(), ...inspectionFields });

function normalizeInspection(args) {
  return {
    slot: args.slot ?? null,
    sizeStuds: args.size_studs ?? null,
    hasScripts: args.has_scripts ?? null,
    scriptCount: args.script_count ?? null,
    basePartCount: args.base_part_count ?? null,
    anchoredCapable: args.anchored_capable ?? null,
    primaryPart: args.primary_part ?? null,
    issues: args.issues ?? [],
    visualRisks: args.visual_risks ?? [],
    visualRiskScore: args.visual_risk_score ?? null,
    screenshotVerdict: args.screenshot_verdict ?? "not_reviewed",
    reviewer: args.reviewer ?? null,
    source: args.source ?? "StudioMCP",
  };
}

server.registerTool(
  "roblox_record_inspection",
  {
    title: "Record a Studio inspection",
    description: "Record the latest StudioMCP inspection for an asset: measured size, script/basepart counts, anchored capability, PrimaryPart readiness, issues, and player-angle visual risks. This server does not inspect Studio itself; it stores the leader's measured facts so curation and validation can fail fast before build.",
    inputSchema: { asset_id: z.number(), ...inspectionFields },
    annotations: WRITE_LOCAL,
  },
  async (args) => {
    await store.recordInspection(args.asset_id, normalizeInspection(args));
    return text(`Recorded Studio inspection for ${args.asset_id}${args.slot ? ` (${args.slot})` : ""}.`);
  }
);

server.registerTool(
  "roblox_record_inspections",
  {
    title: "Record many Studio inspections",
    description: "Record many StudioMCP inspection records in one call. Use this after a live Studio audit of a full palette so the search MCP has reusable geometry/safety evidence without dozens of individual tool calls.",
    inputSchema: { inspections: z.array(inspectionSchema).min(1).max(200) },
    annotations: WRITE_LOCAL,
  },
  async (args) => {
    for (const inspection of args.inspections) {
      await store.recordInspection(inspection.asset_id, normalizeInspection(inspection));
    }
    return text(`Recorded ${args.inspections.length} Studio inspection(s).`);
  }
);

server.registerTool(
  "roblox_get_inspection",
  {
    title: "Get the latest inspection",
    description: "Get the latest persisted StudioMCP inspection for an asset id.",
    inputSchema: { asset_id: z.number() },
    annotations: READ_LOCAL,
  },
  async (args) => {
    const inspection = store.getInspection(args.asset_id);
    if (!inspection) return text(`No inspection recorded for ${args.asset_id}.`);
    return result(inspection);
  }
);

server.registerTool(
  "roblox_brain_status",
  {
    title: "Asset brain status",
    description: "Report the shared asset brain's health: backend, storage dir, search-cache freshness, and counts of reviews, rejections, claims, inspections, publish permissions, and palette entries per project.",
    inputSchema: {},
    annotations: READ_LOCAL,
  },
  async () => result(store.brainStatus())
);

server.registerTool(
  "roblox_prune_search_cache",
  {
    title: "Prune expired search cache",
    description: "Delete expired search-cache rows (older than the 24h TTL by default). The cache is also pruned automatically at server startup; use dry_run=true to preview.",
    inputSchema: {
      ttl_hours: z.number().min(0.1).optional().describe("Entries older than this are pruned (default 24)."),
      dry_run: z.boolean().optional(),
    },
    annotations: WRITE_DESTRUCTIVE,
  },
  async (args) => {
    const ttlMs = (args.ttl_hours ?? SEARCH_TTL_MS / 36e5) * 36e5;
    const out = await store.pruneSearchCache(ttlMs, !!args.dry_run);
    return result(out, `${out.dryRun ? "[dry run] Would remove" : "Removed"} ${out.removed} expired cache entr${out.removed === 1 ? "y" : "ies"}; ${out.kept} kept (ttl=${out.ttlHours}h).`);
  }
);

server.registerTool(
  "roblox_validate_prop_hunt_gate",
  {
    title: "Validate the Prop Hunt gate",
    description: "Validate the committed palette as the repo-side Prop Hunt gate before a live Studio build. Slot names should be area.hideable.name or area.setpiece.name. Defaults match the current Place1 gate: 3 areas, 20 hideable props, 4 set pieces, inspected script-free hideables between 1 and 8 studs with PrimaryPart readiness.",
    inputSchema: {
      project: z.string().optional().describe("Palette project name (default: prophunt)"),
      min_areas: z.number().int().min(1).optional(),
      min_hideable_total: z.number().int().min(0).optional(),
      min_setpiece_total: z.number().int().min(0).optional(),
      min_hideable_per_area: z.number().int().min(0).optional(),
      min_setpiece_per_area: z.number().int().min(0).optional(),
      min_hideable_studs: z.number().min(0).optional(),
      max_hideable_studs: z.number().min(0).optional(),
      require_inspections: z.boolean().optional(),
      require_primary_part: z.boolean().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    annotations: READ_LOCAL,
    outputSchema: verdictOutputSchema,
  },
  async (args) => {
    const project = args.project || "prophunt";
    const { format, ...options } = args;
    const out = validatePropHuntGate({
      project,
      palette: store.getPalette(project),
      getInspection: (id) => store.getInspection(id),
      getReviews: (id) => store.getReviews(id),
      options,
    });
    return rendered(out, format, formatPropHuntGateReport);
  }
);

async function main() {
  await store.ready();
  await server.connect(new StdioServerTransport());
  console.error(`roblox-asset-search-mcp v${PKG.version} ready (stdio) — SQLite asset brain at ${store.dir} (cross-process safe; shared rejection/claim/inspection/publish-permission/cache memory active)`);
}
main().catch((err) => { console.error("fatal:", err); process.exit(1); });
