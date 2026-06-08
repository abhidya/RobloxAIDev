// Roblox Creator Store discovery via the Toolbox Service v2 API.
//
// This is the catalog tier: cheap, network-only metadata (votes, creator,
// script/mesh counts, triangle summary). Geometric metadata (real bounding-box
// size, orientation, "will it fall over") is NOT here — that requires loading
// the asset inside Studio and is handled by the official StudioMCP, keeping this
// server fully decoupled from Roblox Studio.

const TOOLBOX_URL = "https://apis.roblox.com/toolbox-service/v2/assets:search";

export const DEFAULT_CATEGORIES = [
  "Model",
  "MeshPart",
  "Decal",
  "Audio",
  "Plugin",
  "Video",
  "FontFamily",
];

// Suffixes used by `extensive` search so parallel agents explore broadly and
// surface assets a single shallow query would miss. Order matters only for
// readability; results are merged + de-duplicated by asset id.
const EXPANSION_SUFFIXES = ["", "prop", "pack", "low poly", "realistic", "model"];

/** Expand one slot query into diverse variants for extensive exploration. */
export function expandQuery(base) {
  const b = String(base).trim();
  const seen = new Set();
  const out = [];
  for (const suffix of EXPANSION_SUFFIXES) {
    const q = suffix ? `${b} ${suffix}` : b;
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(q);
    }
  }
  return out;
}

/** Run async `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Distinguish "the API answered with no results" from "the request failed".
// Swallowing failures here used to poison the 24h shared cache with false
// empty results during outages/rate limiting.
async function fetchJson(url, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, status: null, error: aborted ? `timeout after ${timeoutMs}ms` : (error?.message || "network error") };
  } finally {
    clearTimeout(timer);
  }
}

/** Error thrown when EVERY category/variant fetch failed (do not cache!). */
export class ToolboxSearchError extends Error {
  constructor(message, failures) {
    super(message);
    this.name = "ToolboxSearchError";
    this.failures = failures;
  }
}

/** Score an asset the way an agent would weigh it. Mirrors the proven Rust ranking. */
export function scoreAsset(a) {
  let score = 0;
  if (a.voteCount > 0) score += Math.log(a.voteCount) * 10;
  score += a.upVotePercent * 0.45;
  if (a.verified) score += 20;
  if (a.purchasable) score += 5;
  if ((a.description || "").length > 20) score += 5;
  if (a.hasScripts) score -= 8;
  return score;
}

export function normalizeAsset(category, item) {
  const asset = item.asset;
  if (!asset || asset.id == null) return null;
  const creator = item.creator || {};
  const product = item.creatorStoreProduct || {};
  const voting = item.voting || {};
  const counts = asset.instanceCounts || {};
  const mesh = asset.objectMeshSummary || {};

  const scriptCount = counts.script ?? asset.scriptCount ?? 0;
  const hasScripts = Boolean(asset.hasScripts) || scriptCount > 0;

  const out = {
    id: Number(asset.id),
    name: asset.name || "Untitled",
    category,
    creator: creator.name || "Unknown",
    verified: Boolean(creator.verified),
    purchasable: Boolean(product.purchasable),
    assetTypeId: asset.assetTypeId ?? null,
    categoryPath: asset.categoryPath ?? null,
    description: asset.description || "",
    createTime: asset.createTime ?? null,
    updateTime: asset.updateTime ?? null,
    hasScripts,
    scriptCount,
    meshParts: counts.meshPart ?? 0,
    animations: counts.animation ?? 0,
    decals: counts.decal ?? 0,
    audio: counts.audio ?? 0,
    tools: counts.tool ?? 0,
    triangles: mesh.triangles ?? null,
    vertices: mesh.vertices ?? null,
    voteCount: voting.voteCount ?? 0,
    upVotePercent: voting.upVotePercent ?? 0,
    upVotes: voting.upVotes ?? 0,
    downVotes: voting.downVotes ?? 0,
  };
  out.score = scoreAsset(out);
  return out;
}

/** Search one query across the given categories in parallel. */
async function fetchOneQuery(query, categories, verifiedOnly, pageSize, timeoutMs, fetchImpl) {
  const perCategory = await mapLimit(categories, 8, async (category) => {
    const params = new URLSearchParams({
      searchCategoryType: category,
      query,
      maxPageSize: String(Math.min(Math.max(pageSize, 1), 100)),
      searchView: "Full",
      sortCategory: "Relevance",
    });
    if (verifiedOnly) params.set("includeOnlyVerifiedCreators", "true");
    const result = await fetchJson(`${TOOLBOX_URL}?${params.toString()}`, timeoutMs, fetchImpl);
    if (!result.ok) return { assets: [], failure: { query, category, error: result.error, status: result.status } };
    const assets = (result.data && result.data.creatorStoreAssets) || [];
    return { assets: assets.map((item) => normalizeAsset(category, item)).filter(Boolean), failure: null };
  });
  return {
    assets: perCategory.flatMap((r) => r.assets),
    failures: perCategory.map((r) => r.failure).filter(Boolean),
    attempts: categories.length,
  };
}

/**
 * Search the Creator Store, ranked and de-duplicated.
 * @param {object} opts
 * @param {string}   opts.query
 * @param {string[]} [opts.categories]
 * @param {boolean}  [opts.verifiedOnly]
 * @param {number}   [opts.maxResults]
 * @param {boolean}  [opts.extensive]  expand the query into variants
 * @param {number}   [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]  injectable fetch for tests
 * @returns {Promise<{assets: object[], meta: {attempts: number, failures: object[]}}>}
 * @throws {ToolboxSearchError} when EVERY fetch failed (network/API outage)
 */
export async function searchAssets(opts) {
  const query = String(opts.query || "").trim();
  const categories = (opts.categories && opts.categories.length
    ? opts.categories
    : DEFAULT_CATEGORIES
  ).filter((c) => c && c.trim());
  const verifiedOnly = Boolean(opts.verifiedOnly);
  const maxResults = Math.min(Math.max(opts.maxResults ?? 10, 1), 50);
  const extensive = Boolean(opts.extensive);
  const timeoutMs = opts.timeoutMs ?? 12000;

  const queries = extensive ? expandQuery(query) : [query];

  const perQuery = await mapLimit(queries, 4, (q) =>
    fetchOneQuery(q, categories, verifiedOnly, maxResults, timeoutMs, opts.fetchImpl)
  );

  const failures = perQuery.flatMap((r) => r.failures);
  const attempts = perQuery.reduce((sum, r) => sum + r.attempts, 0);
  if (attempts > 0 && failures.length >= attempts) {
    const sample = failures.slice(0, 3).map((f) => `${f.category}: ${f.error}`).join("; ");
    throw new ToolboxSearchError(
      `Creator Store search failed for '${query}' — all ${attempts} fetches failed (${sample}). ` +
      "This is an API/network failure, NOT an empty result. Retry shortly; nothing was cached.",
      failures
    );
  }

  // Merge + de-dup by asset id, keeping the highest-scoring occurrence.
  const byId = new Map();
  for (const asset of perQuery.flatMap((r) => r.assets)) {
    const existing = byId.get(asset.id);
    if (!existing || asset.score > existing.score) byId.set(asset.id, asset);
  }

  const ranked = [...byId.values()].sort((a, b) => b.score - a.score);
  return { assets: ranked.slice(0, maxResults), meta: { attempts, failures } };
}
