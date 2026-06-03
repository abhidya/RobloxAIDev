// The "asset brain": shared state for parallel agents doing asset-driven design.
//
//   * search cache (TTL)  — so N parallel agents don't re-hit the Toolbox API
//   * single-flight       — identical in-flight searches collapse to one call
//   * reviews             — one agent's verdict is reused by every other agent
//   * rejections          — rejected assets are auto-excluded from future results
//   * claims              — an asset reserved for a slot is hidden from other
//                           agents, so two agents never pick / preview the same one
//   * palette             — the chosen asset per design slot, frozen for build
//   * inspections         — StudioMCP-measured geometry and safety facts for a
//                           shortlisted or committed asset
//
// Persistence is plain JSON under ~/.roblox-asset-brain/ — no native deps.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DAY = 24 * 60 * 60 * 1000;
export const SEARCH_TTL_MS = DAY;

function brainDir() {
  return process.env.ASSET_BRAIN_DIR || path.join(os.homedir(), ".roblox-asset-brain");
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export class Store {
  constructor() {
    this.dir = brainDir();
    this.files = {
      search: path.join(this.dir, "search-cache.json"),
      reviews: path.join(this.dir, "reviews.json"),
      palette: path.join(this.dir, "palette.json"),
      claims: path.join(this.dir, "claims.json"),
      inspections: path.join(this.dir, "inspections.json"),
    };
    this.searchCache = {};
    this.reviews = {};   // assetId -> [review]
    this.palette = {};   // project -> { slot -> {assetId,name} }
    this.claims = {};    // assetId -> { slot, reviewer, project, at }
    this.inspections = {}; // assetId -> latest StudioMCP inspection record
    this._inflight = new Map();
    this._ready = this._load();
  }

  async _load() {
    await fs.mkdir(this.dir, { recursive: true });
    this.searchCache = await readJson(this.files.search, {});
    this.reviews = await readJson(this.files.reviews, {});
    this.palette = await readJson(this.files.palette, {});
    this.claims = await readJson(this.files.claims, {});
    this.inspections = await readJson(this.files.inspections, {});
  }
  async ready() { await this._ready; }

  // --- search cache (keyed WITHOUT excludes, so the raw pool is reused) ---
  static searchKey({ query, categories, verifiedOnly, extensive }) {
    const cats = [...(categories || [])].sort().join(",");
    return [`q=${String(query).trim().toLowerCase()}`, `cats=${cats}`, `verified=${Boolean(verifiedOnly)}`, `ext=${Boolean(extensive)}`].join("|");
  }
  getCachedSearch(key, ttlMs = SEARCH_TTL_MS) {
    const hit = this.searchCache[key];
    if (hit && Date.now() - hit.createdAt <= ttlMs) return hit.ranked;
    return null;
  }
  async putCachedSearch(key, ranked) {
    this.searchCache[key] = { ranked, createdAt: Date.now() };
    await writeJsonAtomic(this.files.search, this.searchCache);
  }
  async coalesce(key, produce) {
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = (async () => { try { return await produce(); } finally { this._inflight.delete(key); } })();
    this._inflight.set(key, p);
    return p;
  }

  // --- reviews + rejection memory --------------------------------------
  async addReview(assetId, review) {
    const id = String(assetId);
    if (!this.reviews[id]) this.reviews[id] = [];
    this.reviews[id].push({ ...review, createdAt: Date.now() });
    await writeJsonAtomic(this.files.reviews, this.reviews);
  }
  getReviews(assetId) { return this.reviews[String(assetId)] || []; }

  /** True if any persisted review verdict for this asset is a rejection. */
  isRejected(assetId) {
    const rs = this.reviews[String(assetId)] || [];
    return rs.some((r) => String(r.verdict || "").toLowerCase().startsWith("rej"));
  }
  rejectedIdSet() {
    const set = new Set();
    for (const id of Object.keys(this.reviews)) if (this.isRejected(id)) set.add(Number(id));
    return set;
  }

  // --- claims (reservations so agents don't collide) -------------------
  isClaimed(assetId) {
    const c = this.claims[String(assetId)];
    return c ? c.slot : null;
  }
  claimedIdSet() {
    return new Set(Object.keys(this.claims).map(Number));
  }
  async claimAssets(project, slot, assetIds, reviewer) {
    const now = Date.now();
    const claimed = [];
    const skipped = [];
    for (const id of assetIds) {
      const key = String(id);
      const existing = this.claims[key];
      if (existing && existing.slot !== slot) { skipped.push({ id, by: existing.slot }); continue; }
      this.claims[key] = { slot, reviewer: reviewer || null, project: project || null, at: now };
      claimed.push(id);
    }
    await writeJsonAtomic(this.files.claims, this.claims);
    return { claimed, skipped };
  }
  async releaseClaim(assetId) {
    delete this.claims[String(assetId)];
    await writeJsonAtomic(this.files.claims, this.claims);
  }

  // --- StudioMCP inspection memory ------------------------------------
  async recordInspection(assetId, inspection) {
    const id = String(assetId);
    this.inspections[id] = {
      ...inspection,
      assetId: Number(assetId),
      recordedAt: Date.now(),
    };
    await writeJsonAtomic(this.files.inspections, this.inspections);
  }
  getInspection(assetId) {
    return this.inspections[String(assetId)] || null;
  }

  /** Per-candidate annotation other agents should see before acting. */
  annotate(assetId) {
    const rs = this.getReviews(assetId);
    return {
      claimedBy: this.isClaimed(assetId),
      rejected: this.isRejected(assetId),
      inspection: this.getInspection(assetId),
      reviews: rs.map((r) => ({ verdict: r.verdict, notes: r.notes, slot: r.slot, reviewer: r.reviewer })),
    };
  }

  // --- palette ----------------------------------------------------------
  async commitPalette(project, slot, assetId, name) {
    if (!this.palette[project]) this.palette[project] = {};
    this.palette[project][slot] = { assetId: Number(assetId), name: name || null };
    await writeJsonAtomic(this.files.palette, this.palette);
    // committing implies a claim
    await this.claimAssets(project, slot, [assetId], "commit");
  }
  getPalette(project) { return this.palette[project] || {}; }
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
