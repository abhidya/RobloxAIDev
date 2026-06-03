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
import { buildGameAssetCoverage, formatGameAssetCoverage } from "./gameCoverage.js";
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

function annotationSuffix(id) {
  const a = store.annotate(id);
  const bits = [];
  if (a.claimedBy) bits.push(`CLAIMED:${a.claimedBy}`);
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

const text = (s) => ({ content: [{ type: "text", text: s }] });

const server = new McpServer({ name: "asset-search", version: "0.3.0" });

server.tool(
  "plan_game_asset_coverage",
  "Create a generic Roblox game asset coverage plan for the asset-driven skill: lobby spawn, NPCs, portals, upgrade shop, leaderboard/cosmetics, and capacity-limited themed room packs. Use this before curate_assets so new rooms such as underwater, space, haunted, or jungle are grounded in searchable Creator Store slots instead of hand-built placeholders.",
  {
    game: z.string().optional().describe("Short game idea or title."),
    themes: z.array(z.string()).optional().describe("Room themes to cover, e.g. ['underwater reef', 'space station']."),
    include_defaults: z.boolean().optional().describe("Add default expansion themes when true (default true)."),
    include_lobby: z.boolean().optional().describe("Include lobby/social shell slots when true (default true)."),
    max_themes: z.number().int().min(1).max(12).optional(),
    format: z.enum(["text", "json"]).optional(),
  },
  async (args) => {
    const coverage = buildGameAssetCoverage({
      game: args.game || "Roblox game",
      themes: args.themes || [],
      includeDefaults: args.include_defaults !== false,
      includeLobby: args.include_lobby !== false,
      maxThemes: args.max_themes ?? 6,
    });
    return text(args.format === "json" ? JSON.stringify(coverage, null, 2) : formatGameAssetCoverage(coverage));
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
  },
  async (args) => {
    const query = (args.query || "").trim();
    if (!query) return text("query must not be empty");
    const ranked = await rankedSearch({ query, categories: args.categories, verifiedOnly: args.verified_only, extensive: args.extensive });
    const { pool, removed } = applyExcludes(ranked, {
      excludeRejected: args.exclude_rejected !== false,
      excludeClaimed: !!args.exclude_claimed,
      excludeIds: args.exclude_ids,
      excludeTerms: args.exclude_terms,
    });
    const shown = pool.slice(0, args.max_results ?? 10);
    if (!shown.length) return text(`No on-theme, unclaimed Creator Store assets for '${query}' (filtered ${removed}).`);
    const head = `Found ${shown.length} assets for '${query}'${args.extensive ? " (extensive)" : ""} — ${removed} filtered (rejected/claimed/off-theme):`;
    return text(`${head}\n${shown.map(formatAsset).join("\n")}\n\nMeasure geometry in Studio (StudioMCP) before placing.`);
  }
);

server.tool(
  "curate_assets",
  "Turn a storyboard's slots into a diverse, de-duplicated shortlist per slot — the right tool for parallel agents. Auto-excludes rejected + claimed assets, applies per-slot off-theme filters, caps picks per creator, and guarantees NO asset is suggested for two slots in one call. Pair with claim_assets so agents lock in their picks and the next agent's curation skips them.",
  {
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
  },
  async (args) => {
    const perSlot = args.per_slot ?? 5;
    const chosen = new Set(); // cross-slot dedup within this call
    const sections = [];
    for (const s of args.slots) {
      try {
        const ranked = await rankedSearch({ query: s.query, verifiedOnly: args.verified_only, extensive: args.extensive });
        const { pool } = applyExcludes(ranked, {
          excludeRejected: true,
          excludeClaimed: args.exclude_claimed !== false,
          excludeIds: [...chosen],
          excludeTerms: [...(args.exclude_terms || []), ...(s.exclude_terms || [])],
        });
        const curated = diversify(pool, perSlot, 2);
        curated.forEach((a) => chosen.add(a.id));
        const body = curated.length ? curated.map(formatAsset).join("\n") : "   (no on-theme candidates)";
        sections.push(`## slot '${s.slot}'  query='${s.query}'\n${body}`);
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
  "Record the latest StudioMCP inspection for an asset: measured size, script/basepart counts, anchored capability, PrimaryPart readiness, and issues. This server does not inspect Studio itself; it stores the leader's measured facts so curation and Prop Hunt validation can fail fast before build.",
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
  "commit_palette",
  "Freeze the chosen asset for a slot into the project palette (also claims it). The build phase reads this.",
  { project: z.string(), slot: z.string(), asset_id: z.number(), name: z.string().optional() },
  async (args) => {
    await store.commitPalette(args.project, args.slot, args.asset_id, args.name);
    return text(`Committed ${args.slot} -> ${args.asset_id} in '${args.project}' (and claimed it).`);
  }
);

server.tool(
  "get_palette",
  "Return the committed palette (slot -> chosen asset id) for a project.",
  { project: z.string() },
  async (args) => {
    const pal = store.getPalette(args.project);
    const entries = Object.entries(pal);
    if (!entries.length) return text(`Palette '${args.project}' is empty.`);
    return text(`Palette '${args.project}':\n${entries.map(([slot, v]) => `${slot}: ${v.assetId}${v.name ? ` (${v.name})` : ""}`).join("\n")}`);
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
  console.error("asset-search-mcp v0.3 ready (stdio) — shared rejection/claim/inspection memory active");
}
main().catch((err) => { console.error("fatal:", err); process.exit(1); });
