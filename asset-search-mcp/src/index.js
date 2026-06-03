#!/usr/bin/env node
// asset-search-mcp — a standalone, search-only MCP for asset-driven Roblox game
// design. Decoupled from the Roblox Studio MCP: this server only discovers,
// ranks, curates, reviews, and remembers Creator Store assets. Building/placing
// and geometric inspection are the official StudioMCP's job; the skill
// orchestrates both.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchAssets, DEFAULT_CATEGORIES } from "./toolbox.js";
import { Store, diversify } from "./store.js";

const store = new Store();

// --- shared search path: cache-first + single-flight ----------------------
async function rankedSearch(opts) {
  const key = Store.searchKey(opts);
  const cached = store.getCachedSearch(key);
  if (cached) return cached;
  return store.coalesce(key, async () => {
    const again = store.getCachedSearch(key);
    if (again) return again;
    const ranked = await searchAssets(opts);
    await store.putCachedSearch(key, ranked);
    return ranked;
  });
}

// --- formatting -----------------------------------------------------------
function formatAsset(a, index) {
  const flags = [];
  if (a.verified) flags.push("verified");
  if (a.purchasable) flags.push("purchasable");
  if (a.hasScripts) flags.push(`SCRIPT_REVIEW(scripts=${a.scriptCount})`);
  const mesh =
    a.triangles != null ? ` triangles=${a.triangles} vertices=${a.vertices ?? "?"}` : "";
  const desc = (a.description || "").split("\n")[0].trim().slice(0, 120);
  return [
    `${index + 1}. ${a.name} (ID: ${a.id})`,
    `   category=${a.category}${a.categoryPath ? ` path=${a.categoryPath}` : ""} creator=${a.creator}${flags.length ? " [" + flags.join(", ") + "]" : ""}`,
    `   score=${a.score.toFixed(1)} votes=${a.voteCount} up%=${a.upVotePercent} meshParts=${a.meshParts} decals=${a.decals} audio=${a.audio}${mesh}`,
    desc ? `   ${desc}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRanked(query, ranked, extensive) {
  if (!ranked.length) {
    return `No Creator Store assets found for '${query}'.`;
  }
  const head = `Found ${ranked.length} Creator Store assets for '${query}'${extensive ? " (extensive)" : ""}, ranked across categories:`;
  const body = ranked.map(formatAsset).join("\n");
  return `${head}\n${body}\n\nGeometric size/orientation is not in the catalog — measure shortlisted ids in Studio (StudioMCP) before placing.`;
}

const text = (s) => ({ content: [{ type: "text", text: s }] });

// --- server + tools -------------------------------------------------------
const server = new McpServer({ name: "asset-search", version: "0.1.0" });

server.tool(
  "search_assets",
  "Search the Roblox Creator Store across asset categories (Toolbox v2), returning a ranked, de-duplicated list with votes, creator verification, script/mesh/audio counts, triangle summary, and ids. Results are cached (24h) and identical concurrent searches are coalesced, so parallel agents are cheap. Set extensive=true to expand the query into variants for broader exploration of storyboard-relevant assets.",
  {
    query: z.string().describe("What to search for, e.g. 'medieval barrel' or 'sci-fi console'"),
    max_results: z.number().int().min(1).max(50).optional().describe("Max ranked results (default 10)"),
    categories: z
      .array(z.string())
      .optional()
      .describe(`Categories to search. Defaults to: ${DEFAULT_CATEGORIES.join(", ")}`),
    verified_only: z.boolean().optional().describe("Only assets from verified creators"),
    extensive: z
      .boolean()
      .optional()
      .describe("Expand the query into variants (prop/pack/low poly/realistic/model) and merge — broader exploration"),
  },
  async (args) => {
    const query = (args.query || "").trim();
    if (!query) return text("query must not be empty");
    const opts = {
      query,
      categories: args.categories,
      verifiedOnly: args.verified_only,
      maxResults: args.max_results ?? 10,
      extensive: args.extensive,
    };
    const ranked = await rankedSearch(opts);
    return text(formatRanked(query, ranked, opts.extensive));
  }
);

server.tool(
  "curate_assets",
  "Turn a storyboard's asset slots into a curated, diverse shortlist per slot. For each {slot, query}, runs a ranked search then caps picks per creator so the shortlist isn't one creator's pack. Ideal for parallel agents fanning out over a storyboard: one call per slot-group, results shared via the same cache.",
  {
    slots: z
      .array(z.object({ slot: z.string(), query: z.string() }))
      .describe("Design slots to fill, e.g. [{slot:'barrel', query:'medieval barrel'}, ...]"),
    per_slot: z.number().int().min(1).max(20).optional().describe("Shortlist size per slot (default 5)"),
    verified_only: z.boolean().optional(),
    extensive: z.boolean().optional().describe("Use extensive expansion for each slot"),
  },
  async (args) => {
    const perSlot = args.per_slot ?? 5;
    const sections = [];
    for (const { slot, query } of args.slots) {
      try {
        const ranked = await rankedSearch({
          query,
          verifiedOnly: args.verified_only,
          maxResults: perSlot * 4,
          extensive: args.extensive,
        });
        const curated = diversify(ranked, perSlot, 2);
        const body = curated.length
          ? curated.map(formatAsset).join("\n")
          : "   (no candidates)";
        sections.push(`## slot '${slot}'  query='${query}'\n${body}`);
      } catch (e) {
        sections.push(`## slot '${slot}'  query='${query}' — search failed: ${e.message}`);
      }
    }
    return text(sections.join("\n\n"));
  }
);

server.tool(
  "review_asset",
  "Persist an agent's verdict on an asset (keep/reject + notes) so other parallel agents reuse it instead of re-vetting. Returns all reviews for the asset.",
  {
    asset_id: z.number().describe("Asset id being reviewed"),
    verdict: z.string().describe("keep | reject | maybe"),
    slot: z.string().optional().describe("Which design slot this was for"),
    rating: z.number().int().min(0).max(10).optional(),
    notes: z.string().optional().describe("Why — e.g. 'great mesh, no scripts' or 'oversized, rejected'"),
    reviewer: z.string().optional().describe("Agent/slot identifier"),
  },
  async (args) => {
    await store.addReview(args.asset_id, {
      verdict: args.verdict,
      slot: args.slot ?? null,
      rating: args.rating ?? null,
      notes: args.notes ?? null,
      reviewer: args.reviewer ?? null,
    });
    const all = store.getReviews(args.asset_id);
    return text(`Recorded. ${all.length} review(s) for ${args.asset_id}:\n${JSON.stringify(all, null, 2)}`);
  }
);

server.tool(
  "get_reviews",
  "Get all persisted agent reviews for an asset id.",
  { asset_id: z.number() },
  async (args) => {
    const all = store.getReviews(args.asset_id);
    return text(all.length ? JSON.stringify(all, null, 2) : `No reviews yet for ${args.asset_id}.`);
  }
);

server.tool(
  "commit_palette",
  "Freeze the chosen asset for a design slot into the project's palette, so the build phase references a stable id.",
  {
    project: z.string().describe("Project/game name namespace"),
    slot: z.string().describe("Design slot, e.g. 'medieval.barrel'"),
    asset_id: z.number(),
    name: z.string().optional(),
  },
  async (args) => {
    await store.commitPalette(args.project, args.slot, args.asset_id, args.name);
    return text(`Committed ${args.slot} -> ${args.asset_id} in palette '${args.project}'.`);
  }
);

server.tool(
  "get_palette",
  "Return the committed palette (slot -> chosen asset id) for a project, for the build phase.",
  { project: z.string() },
  async (args) => {
    const pal = store.getPalette(args.project);
    const entries = Object.entries(pal);
    if (!entries.length) return text(`Palette '${args.project}' is empty.`);
    const lines = entries.map(([slot, v]) => `${slot}: ${v.assetId}${v.name ? ` (${v.name})` : ""}`);
    return text(`Palette '${args.project}':\n${lines.join("\n")}`);
  }
);

async function main() {
  await store.ready();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is the MCP transport.
  console.error("asset-search-mcp ready (stdio)");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
