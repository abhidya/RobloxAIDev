// The "asset brain" service layer for parallel agents doing asset-driven design.
//
//   * search cache (TTL)  — so N parallel agents don't re-hit the Toolbox API
//   * single-flight       — identical in-flight searches collapse to one call
//   * reviews             — one agent's verdict is reused by every other agent
//   * rejections          — rejected assets are auto-excluded from future results
//   * claims              — an asset reserved for a slot is hidden from other
//                           agents, so two agents never pick / preview the same one
//   * palette             — the chosen asset per design slot, frozen for build
//   * inspections         — StudioMCP-measured geometry and safety facts
//   * publish permissions — owner/access/dependency proof for release palettes
//
// Persistence is SQLite (node:sqlite, WAL) under ~/.roblox-asset-brain/ via the
// DAL in src/dal/ — cross-process safe for concurrent agent sessions, with
// transactional (race-free) claims. Legacy JSON brain files are imported once
// automatically. The public API is unchanged from the JSON-file era.

import { createDal } from "./dal/index.js";
import {
  evaluatePublishPermission,
  normalizePublishPermission,
  summarizePublishPermission,
  validatePalettePublishPermissions,
} from "./publishPolicy.js";
export {
  evaluatePublishPermission,
  normalizePublishPermission,
  PUBLISH_PERMISSION_MODES,
  summarizePublishPermission,
  validatePalettePublishPermissions,
} from "./publishPolicy.js";

const DAY = 24 * 60 * 60 * 1000;
export const SEARCH_TTL_MS = DAY;
/** Claims older than this are treated as stale by release_stale_claims defaults. */
export const DEFAULT_STALE_CLAIM_MS = 7 * DAY;

export class Store {
  constructor() {
    this.dal = createDal();
    this.dir = this.dal.dir;
    this._inflight = new Map();
    // Drop expired search-cache rows on startup so the cache can't grow forever.
    this.dal.searchCache.prune(SEARCH_TTL_MS);
  }

  /** Kept for API compatibility; SQLite opens synchronously. */
  async ready() {}

  // --- search cache (keyed WITHOUT excludes, so the raw pool is reused) ---
  static searchKey({ query, categories, verifiedOnly, extensive }) {
    const cats = [...(categories || [])].sort().join(",");
    return [`q=${String(query).trim().toLowerCase()}`, `cats=${cats}`, `verified=${Boolean(verifiedOnly)}`, `ext=${Boolean(extensive)}`].join("|");
  }
  getCachedSearch(key, ttlMs = SEARCH_TTL_MS) {
    return this.dal.searchCache.get(key, ttlMs);
  }
  async putCachedSearch(key, ranked) {
    this.dal.searchCache.put(key, ranked);
  }
  searchCacheStatus(ttlMs = SEARCH_TTL_MS, now = Date.now()) {
    return this.dal.searchCache.status(ttlMs, now);
  }
  async pruneSearchCache(ttlMs = SEARCH_TTL_MS, dryRun = false, now = Date.now()) {
    return this.dal.searchCache.prune(ttlMs, dryRun, now);
  }
  searchCacheEntries(limit = 100) {
    return this.dal.searchCache.entries(limit);
  }
  async coalesce(key, produce) {
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = (async () => { try { return await produce(); } finally { this._inflight.delete(key); } })();
    this._inflight.set(key, p);
    return p;
  }

  // --- reviews + rejection memory --------------------------------------
  async addReview(assetId, review) {
    this.dal.reviews.add(assetId, review);
  }
  getReviews(assetId) {
    return this.dal.reviews.listFor(assetId);
  }
  /** True if any persisted review verdict for this asset is a rejection. */
  isRejected(assetId) {
    return this.dal.reviews.listFor(assetId).some((r) => String(r.verdict || "").toLowerCase().startsWith("rej"));
  }
  rejectedIdSet() {
    return new Set(this.dal.reviews.rejectedAssetIds());
  }
  reviewedAssetIds() {
    return this.dal.reviews.assetIds();
  }

  // --- claims (reservations so agents don't collide) -------------------
  isClaimed(assetId) {
    const claim = this.dal.claims.get(assetId);
    return claim ? claim.slot : null;
  }
  getClaim(assetId) {
    return this.dal.claims.get(assetId);
  }
  claimedIdSet() {
    return new Set(this.dal.claims.assetIds());
  }
  claimedAssetIds() {
    return this.dal.claims.assetIds();
  }
  /** Transactional: two parallel agent processes can never claim the same asset. */
  async claimAssets(project, slot, assetIds, reviewer) {
    return this.dal.claims.claimMany(project, slot, assetIds, reviewer);
  }
  async releaseClaim(assetId) {
    return this.dal.claims.release(assetId);
  }
  async releaseStaleClaims(maxAgeMs = DEFAULT_STALE_CLAIM_MS, now = Date.now()) {
    return this.dal.claims.releaseStale(maxAgeMs, now);
  }

  // --- StudioMCP inspection memory ------------------------------------
  async recordInspection(assetId, inspection) {
    this.dal.inspections.set(assetId, { ...inspection, assetId: Number(assetId), recordedAt: Date.now() });
  }
  getInspection(assetId) {
    return this.dal.inspections.get(assetId);
  }
  inspectedAssetIds() {
    return this.dal.inspections.assetIds();
  }

  // --- publish permission memory --------------------------------------
  async recordPublishPermission(assetId, permission) {
    this.dal.permissions.set(assetId, normalizePublishPermission(assetId, permission));
  }
  getPublishPermission(assetId) {
    return this.dal.permissions.get(assetId);
  }
  permissionAssetIds() {
    return this.dal.permissions.assetIds();
  }
  evaluatePublishPermission(assetId, options = {}) {
    return evaluatePublishPermission(this.getPublishPermission(assetId), options);
  }
  validatePalettePublishPermissions(project, options = {}) {
    return validatePalettePublishPermissions({
      project,
      palette: this.getPalette(project),
      getPermission: (id) => this.getPublishPermission(id),
      options,
    });
  }

  /** Per-candidate annotation other agents should see before acting. */
  annotate(assetId) {
    const claim = this.dal.claims.get(assetId);
    return {
      claimedBy: claim ? claim.slot : null,
      claimedAt: claim ? claim.at : null,
      rejected: this.isRejected(assetId),
      inspection: this.getInspection(assetId),
      publishPermission: summarizePublishPermission(this.getPublishPermission(assetId)),
      reviews: this.getReviews(assetId).map((r) => ({ verdict: r.verdict, notes: r.notes, slot: r.slot, reviewer: r.reviewer })),
    };
  }

  // --- palette ----------------------------------------------------------
  async commitPalette(project, slot, assetId, name) {
    this.dal.palette.commit(project, slot, assetId, name);
    // committing implies a claim
    await this.claimAssets(project, slot, [assetId], "commit");
  }
  getPalette(project) {
    return this.dal.palette.get(project);
  }

  brainStatus(ttlMs = SEARCH_TTL_MS) {
    const reviewCounts = this.dal.reviews.counts();
    const paletteByProject = this.dal.palette.countByProject();
    return {
      backend: "sqlite",
      dir: this.dir,
      searchCache: this.searchCacheStatus(ttlMs),
      counts: {
        reviewedAssets: reviewCounts.assets,
        reviews: reviewCounts.reviews,
        rejectedAssets: this.dal.reviews.rejectedAssetIds().length,
        claims: this.dal.claims.count(),
        inspections: this.dal.inspections.count(),
        publishPermissions: this.dal.permissions.count(),
        paletteProjects: Object.keys(paletteByProject).length,
        paletteAssets: Object.values(paletteByProject).reduce((sum, count) => sum + count, 0),
      },
      paletteByProject,
    };
  }
}

/** Diversity cap: at most `maxPerCreator` picks from one creator. */
export function diversify(ranked, perSlot, maxPerCreator = 2) {
  const counts = new Map();
  const out = [];
  for (const a of ranked) {
    const n = counts.get(a.creator) || 0;
    if (n < maxPerCreator) { counts.set(a.creator, n + 1); out.push(a); if (out.length >= perSlot) break; }
  }
  return out;
}

/** Drop assets whose name contains any negative term (case-insensitive). */
export function filterByTerms(assets, excludeTerms) {
  if (!excludeTerms || !excludeTerms.length) return assets;
  const terms = excludeTerms.map((t) => String(t).toLowerCase()).filter(Boolean);
  return assets.filter((a) => {
    const name = String(a.name || "").toLowerCase();
    return !terms.some((t) => name.includes(t));
  });
}
