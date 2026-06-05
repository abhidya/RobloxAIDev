#!/usr/bin/env node
// asset-search-mcp — the shared "asset brain" for asset-driven, multi-agent
// Roblox game design. Decoupled from the Roblox Studio MCP: it discovers,
// ranks, curates, and REMEMBERS Creator Store assets so parallel agents never
// re-search, re-preview, or re-reject the same items, and stay on-theme.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchAssets, DEFAULT_CATEGORIES } from "./toolbox.js";
import { Store, diversify, filterByTerms } from "./store.js";
import { buildGameAssetCoverage } from "./gameCoverage.js";
import { registerPlanningTools } from "./mcpTools/planningTools.js";
import { registerPolicyTools } from "./mcpTools/policyTools.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "./propHuntGate.js";

const store = new Store();
const POOL = 40; // raw candidates fetched + cached per query; excludes applied after

// Cache-first + single-flight raw pool (cached WITHOUT excludes for max reuse).
async function rankedSearch(opts) {
  const key = Store.searchKey(opts);
  const cached = store.getCachedSearch(key);
  if (cached) return cached;
  return store.coalesce(key, async () => {
    const again = store.getCachedSearch(key);
    if (again) return again;
    const ranked = await searchAssets({ ...opts, maxResults: POOL });
    await store.putCachedSearch(key, ranked);
    return ranked;
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
    "   source=committed palette; use get_inspection/get_reviews before Studio work",
  ].join("\n");
}

const text = (s) => ({ content: [{ type: "text", text: s }] });

const server = new McpServer({ name: "asset-search", version: "0.8.0" });
registerPlanningTools(server, { text });
registerPolicyTools(server, { store, text });

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
  for (const id of Object.keys(store.reviews || {})) ids.add(Number(id));
  for (const id of Object.keys(store.claims || {})) ids.add(Number(id));
  for (const id of Object.keys(store.inspections || {})) ids.add(Number(id));
  for (const id of Object.keys(store.permissions || {})) ids.add(Number(id));
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
} = {}) {
  const assetIds = collectAssetIdsForSnapshot(project);
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
    for (const [key, entry] of Object.entries(store.searchCache || {}).slice(0, maxQueries)) {
      const ranked = Array.isArray(entry?.ranked) ? entry.ranked : [];
      searchQueries.push({
        key,
        createdAt: entry?.createdAt || null,
        resultCount: ranked.length,
        topResults: ranked.slice(0, maxResultsPerQuery).map((asset) => ({
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

  return {
    schema: "roblox-asset-brain-snapshot/v1",
    project,
    generatedAt: new Date().toISOString(),
    counts: {
      assets: assets.length,
      searchQueries: searchQueries.length,
      reviews: Object.values(store.reviews || {}).reduce((sum, reviews) => sum + (Array.isArray(reviews) ? reviews.length : 0), 0),
      inspections: Object.keys(store.inspections || {}).length,
      publishPermissions: Object.keys(store.permissions || {}).length,
      claims: Object.keys(store.claims || {}).length,
      paletteAssets: Object.keys(store.getPalette(project) || {}).length,
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
    `assets=${snapshot.counts.assets} palette=${snapshot.counts.paletteAssets} reviews=${snapshot.counts.reviews} inspections=${snapshot.counts.inspections} queries=${snapshot.counts.searchQueries}`,
    `pages=${snapshot.pagesLayout.manifest}`,
    "",
    "Asset shards:",
    ...snapshot.assets.slice(0, 20).map((asset) => `- ${asset.assetId} shard=${asset.shard} rejected=${asset.rejected} visual=${asset.visual.screenshotVerdict} publish=${asset.publishReadiness.passed ? "pass" : "fail"}`),
  ].join("\n");
}

server.tool(
  "preprocess_storyboard_asset_cache",
  "Preprocess the asset-search cache for asset-driven storyboarding and headless Roblox file assembly. Builds coverage slots, optionally warms ranked search cache for each slot, and returns storyboard/headless inputs plus the GitHub Pages-friendly metadata layout. Use this before storyboarding so the game bends to cached Creator Store evidence.",
  {
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
    if (args.warm_search_cache) {
      for (const slot of slots) {
        const ranked = await rankedSearch({
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
          candidates: pool.slice(0, args.per_slot ?? 3).map((asset) => ({
            id: asset.id,
            name: asset.name,
            category: asset.category,
            creator: asset.creator,
            score: asset.score,
            hasScripts: asset.hasScripts,
          })),
          filtered: removed,
        });
      }
    }
    const result = {
      schema: "roblox-storyboard-cache-preprocess/v1",
      project,
      game: coverage.game,
      themes: coverage.themes,
      slots,
      warmed,
      pagesLayout: pagesLayout(project),
      next: [
        "Use warmed candidates for storyboarding; do not invent uncached assets.",
        "Claim shortlisted assets before Studio/lab inspection.",
        "Record geometry, script audit, and visual risk with record_inspection.",
        "Commit palette winners, then call plan_headless_assembly for .rbxm/.rbxlx work packets.",
      ],
    };
    if (args.format === "json") return text(JSON.stringify(result, null, 2));
    return text([
      `Preprocessed storyboard cache plan for '${project}'`,
      `slots=${slots.length} warmed=${warmed.length} themes=${result.themes.join(", ")}`,
      `pages=${result.pagesLayout.manifest}`,
      "",
      "Slots:",
      ...slots.slice(0, 30).map((slot) => `- ${slot.slot}: ${slot.query}`),
      "",
      "Next:",
      ...result.next.map((step) => `- ${step}`),
    ].join("\n"));
  }
);

server.tool(
  "export_asset_brain_snapshot",
  "Export a compact, GitHub Pages-friendly snapshot of the asset-search brain: palette, reviews, claims, inspections, visual risk metadata, and optional capped search-cache summaries. Returns metadata only, never binary assets or screenshots.",
  {
    project: z.string().optional().describe("Palette project name (default: prophunt)."),
    include_search_cache: z.boolean().optional().describe("Include capped lightweight search-query summaries (default false)."),
    max_queries: z.number().int().min(1).max(500).optional(),
    max_results_per_query: z.number().int().min(1).max(20).optional(),
    format: z.enum(["text", "json"]).optional(),
  },
  async (args) => {
    const snapshot = buildAssetBrainSnapshot({
      project: args.project || "prophunt",
      includeSearchCache: !!args.include_search_cache,
      maxQueries: args.max_queries ?? 100,
      maxResultsPerQuery: args.max_results_per_query ?? 8,
    });
    return text(args.format === "json" ? JSON.stringify(snapshot, null, 2) : formatAssetBrainSnapshot(snapshot));
  }
);

server.tool(
  "search_assets",
  "Search the Creator Store (Toolbox v2), ranked + de-duplicated, CACHED (24h) and single-flighted so parallel agents are cheap. The shared brain auto-excludes assets other agents already rejected or claimed, and you can pass exclude_terms to drop off-theme results (e.g. ['palm','tropical','sci-fi'] when searching medieval). Each result is annotated with prior verdicts/claims so you never re-evaluate a known item.",
  {
    query: z.string(),
    max_results: z.number().int().min(1).max(40).optional().describe("How many to show after exclusions (default 10)"),
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
  },
  async (args) => {
    const query = (args.query || "").trim();
    if (!query) return text("query must not be empty");
    const ranked = await rankedSearch({ query, categories: args.categories, verifiedOnly: args.verified_only, extensive: args.extensive });
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
    const shown = pool.slice(0, args.max_results ?? 10);
    if (!shown.length) return text(`No on-theme, unclaimed Creator Store assets for '${query}' (filtered ${removed}, publish-filtered ${permissionRemoved}).`);
    const head = `Found ${shown.length} assets for '${query}'${args.extensive ? " (extensive)" : ""} — ${removed} filtered (rejected/claimed/off-theme), ${permissionRemoved} publish-filtered:`;
    return text(`${head}\n${shown.map(formatAsset).join("\n")}\n\nMeasure geometry in Studio (StudioMCP) before placing.`);
  }
);

server.tool(
  "curate_assets",
  "Turn a storyboard's slots into a diverse, de-duplicated shortlist per slot — the right tool for parallel agents. Auto-excludes rejected + claimed assets, applies per-slot off-theme filters, caps picks per creator, and guarantees NO asset is suggested for two slots in one call. Pair with claim_assets so agents lock in their picks and the next agent's curation skips them. Pass project + include_palette=true to surface already committed palette assets when live search is sparse or stale.",
  {
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
  },
  async (args) => {
    const perSlot = args.per_slot ?? 5;
    const chosen = new Set(); // cross-slot dedup within this call
    const sections = [];
    for (const s of args.slots) {
      try {
        const ranked = await rankedSearch({ query: s.query, verifiedOnly: args.verified_only, extensive: args.extensive });
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
        if (paletteEntry && !chosen.has(Number(paletteEntry.assetId))) {
          lines.push(formatPaletteSeed(s.slot, paletteEntry, lines.length));
          chosen.add(Number(paletteEntry.assetId));
        }
        const body = lines.length ? lines.join("\n") : "   (no on-theme candidates)";
        const diagnostics = `   diagnostics: raw=${ranked.length} filtered=${removed} publish_filtered=${permissionRemoved} curated=${curated.length}${paletteEntry ? " palette_fallback=1" : ""}`;
        sections.push(`## slot '${s.slot}'  query='${s.query}'\n${body}\n${diagnostics}`);
      } catch (e) {
        sections.push(`## slot '${s.slot}' — search failed: ${e.message}`);
      }
    }
    return text(sections.join("\n\n"));
  }
);

server.tool(
  "claim_assets",
  "Reserve asset ids for a design slot so other parallel agents' search/curate calls hide them. Prevents two agents picking or previewing the same asset. Returns which ids were claimed vs already taken.",
  {
    project: z.string(),
    slot: z.string(),
    asset_ids: z.array(z.number()),
    reviewer: z.string().optional().describe("Agent/slot identifier"),
  },
  async (args) => {
    const { claimed, skipped } = await store.claimAssets(args.project, args.slot, args.asset_ids, args.reviewer);
    let msg = `Claimed ${claimed.length} for '${args.slot}': ${claimed.join(", ") || "none"}.`;
    if (skipped.length) msg += `\nAlready claimed elsewhere: ${skipped.map((s) => `${s.id}→${s.by}`).join(", ")}.`;
    return text(msg);
  }
);

server.tool(
  "reject_asset",
  "Record that an asset is unsuitable (with a reason). It is then auto-excluded from every agent's future search/curate, so no one re-finds, re-previews, or re-rejects it.",
  {
    asset_id: z.number(),
    reason: z.string().describe("Why — e.g. 'oversized', 'has scripts', 'off-theme', 'untextured'"),
    slot: z.string().optional(),
    reviewer: z.string().optional(),
  },
  async (args) => {
    await store.addReview(args.asset_id, { verdict: "reject", notes: args.reason, slot: args.slot ?? null, reviewer: args.reviewer ?? null });
    return text(`Rejected ${args.asset_id} (${args.reason}). It is now hidden from all agents' results.`);
  }
);

server.tool(
  "review_asset",
  "Persist a verdict (keep/reject/maybe + notes) shared across agents. 'reject' verdicts auto-exclude the asset from future results. Returns all reviews for the asset.",
  {
    asset_id: z.number(),
    verdict: z.string().describe("keep | reject | maybe"),
    slot: z.string().optional(),
    rating: z.number().int().min(0).max(10).optional(),
    notes: z.string().optional(),
    reviewer: z.string().optional(),
  },
  async (args) => {
    await store.addReview(args.asset_id, { verdict: args.verdict, slot: args.slot ?? null, rating: args.rating ?? null, notes: args.notes ?? null, reviewer: args.reviewer ?? null });
    return text(`Recorded '${args.verdict}' for ${args.asset_id}. ${store.getReviews(args.asset_id).length} total review(s).`);
  }
);

server.tool(
  "get_reviews",
  "Get all persisted reviews + claim status for an asset id (so you can skip re-evaluating it).",
  { asset_id: z.number() },
  async (args) => text(JSON.stringify(store.annotate(args.asset_id), null, 2))
);

server.tool(
  "record_inspection",
  "Record the latest StudioMCP inspection for an asset: measured size, script/basepart counts, anchored capability, PrimaryPart readiness, issues, and player-angle visual risks. This server does not inspect Studio itself; it stores the leader's measured facts so curation and validation can fail fast before build.",
  {
    asset_id: z.number(),
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
  },
  async (args) => {
    await store.recordInspection(args.asset_id, normalizeInspection(args));
    return text(`Recorded Studio inspection for ${args.asset_id}${args.slot ? ` (${args.slot})` : ""}.`);
  }
);

const inspectionSchema = z.object({
  asset_id: z.number(),
  slot: z.string().optional(),
  size_studs: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional().describe("Bounding-box size from Studio in studs."),
  has_scripts: z.boolean().optional(),
  script_count: z.number().int().min(0).optional(),
  base_part_count: z.number().int().min(0).optional(),
  anchored_capable: z.boolean().optional(),
  primary_part: z.boolean().optional(),
  issues: z.array(z.string()).optional(),
  visual_risks: z.array(z.string()).optional(),
  visual_risk_score: z.number().int().min(0).max(10).optional(),
  screenshot_verdict: z.enum(["not_reviewed", "pass", "fix", "reject"]).optional(),
  reviewer: z.string().optional(),
  source: z.string().optional(),
});

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

server.tool(
  "record_inspections",
  "Record many StudioMCP inspection records in one call. Use this after a live Studio audit of a full Prop Hunt palette so the search MCP has reusable geometry/safety evidence without dozens of individual tool calls.",
  {
    inspections: z.array(inspectionSchema).min(1).max(200),
  },
  async (args) => {
    for (const inspection of args.inspections) {
      await store.recordInspection(inspection.asset_id, normalizeInspection(inspection));
    }
    return text(`Recorded ${args.inspections.length} Studio inspection(s).`);
  }
);

server.tool(
  "get_inspection",
  "Get the latest persisted StudioMCP inspection for an asset id.",
  { asset_id: z.number() },
  async (args) => {
    const inspection = store.getInspection(args.asset_id);
    return text(inspection ? JSON.stringify(inspection, null, 2) : `No inspection recorded for ${args.asset_id}.`);
  }
);

server.tool(
  "validate_prop_hunt_gate",
  "Validate the committed palette as the repo-side Prop Hunt gate before a live Studio build. Slot names should be area.hideable.name or area.setpiece.name. Defaults match the current Place1 gate: 3 areas, 20 hideable props, 4 set pieces, inspected script-free hideables between 1 and 8 studs with PrimaryPart readiness.",
  {
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
    format: z.enum(["text", "json"]).optional().describe("Return human-readable text (default) or JSON."),
  },
  async (args) => {
    const project = args.project || "prophunt";
    const { format, ...options } = args;
    const result = validatePropHuntGate({
      project,
      palette: store.getPalette(project),
      getInspection: (id) => store.getInspection(id),
      getReviews: (id) => store.getReviews(id),
      options,
    });
    return text(format === "json" ? JSON.stringify(result, null, 2) : formatPropHuntGateReport(result));
  }
);

async function main() {
  await store.ready();
  await server.connect(new StdioServerTransport());
  console.error("asset-search-mcp v0.8 ready (stdio) - shared rejection/claim/inspection/publish-permission/cache-preprocess/headless/player-angle visual-review memory active");
}
main().catch((err) => { console.error("fatal:", err); process.exit(1); });
