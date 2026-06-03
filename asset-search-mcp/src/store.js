// The "asset brain": shared state for parallel agents doing asset-driven design.
//
//   * search cache (TTL)  — so N parallel agents don't re-hit the Toolbox API
//   * single-flight       — identical in-flight searches collapse to one call
//   * reviews             — one agent's verdict is reused by every other agent
//   * palette             — the chosen asset per design slot, frozen for build
//
// Persistence is plain JSON under ~/.roblox-asset-brain/ — no native deps, no
// build step. Writes are atomic (write temp, then rename).

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DAY = 24 * 60 * 60 * 1000;
export const SEARCH_TTL_MS = DAY; // votes/ranking drift slowly

function brainDir() {
  return process.env.ASSET_BRAIN_DIR || path.join(os.homedir(), ".roblox-asset-brain");
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
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
    };
    this.searchCache = {}; // key -> { rankedJson, createdAt }
    this.reviews = {}; // assetId -> [review]
    this.palette = {}; // project -> { slot -> { assetId, name } }
    this._inflight = new Map(); // key -> Promise (single-flight)
    this._ready = this._load();
  }

  async _load() {
    await fs.mkdir(this.dir, { recursive: true });
    this.searchCache = await readJson(this.files.search, {});
    this.reviews = await readJson(this.files.reviews, {});
    this.palette = await readJson(this.files.palette, {});
  }

  async ready() {
    await this._ready;
  }

  // --- search cache key -------------------------------------------------
  static searchKey({ query, categories, verifiedOnly, maxResults, extensive }) {
    const cats = [...(categories || [])].sort().join(",");
    return [
      `q=${String(query).trim().toLowerCase()}`,
      `cats=${cats}`,
      `verified=${Boolean(verifiedOnly)}`,
      `n=${maxResults}`,
      `ext=${Boolean(extensive)}`,
    ].join("|");
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

  /**
   * Single-flight: if an identical search is already running, await it instead
   * of issuing a second network storm. `produce` is an async () => ranked[].
   */
  async coalesce(key, produce) {
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = (async () => {
      try {
        return await produce();
      } finally {
        this._inflight.delete(key);
      }
    })();
    this._inflight.set(key, p);
    return p;
  }

  // --- reviews ----------------------------------------------------------
  async addReview(assetId, review) {
    const id = String(assetId);
    if (!this.reviews[id]) this.reviews[id] = [];
    this.reviews[id].push({ ...review, createdAt: Date.now() });
    await writeJsonAtomic(this.files.reviews, this.reviews);
  }

  getReviews(assetId) {
    return this.reviews[String(assetId)] || [];
  }

  // --- palette ----------------------------------------------------------
  async commitPalette(project, slot, assetId, name) {
    if (!this.palette[project]) this.palette[project] = {};
    this.palette[project][slot] = { assetId: Number(assetId), name: name || null };
    await writeJsonAtomic(this.files.palette, this.palette);
  }

  getPalette(project) {
    return this.palette[project] || {};
  }
}

/**
 * Curation diversity: cap how many picks come from one creator so a shortlist
 * isn't just one creator's asset pack. Returns up to `perSlot` assets.
 */
export function diversify(ranked, perSlot, maxPerCreator = 2) {
  const counts = new Map();
  const out = [];
  for (const a of ranked) {
    const n = counts.get(a.creator) || 0;
    if (n < maxPerCreator) {
      counts.set(a.creator, n + 1);
      out.push(a);
      if (out.length >= perSlot) break;
    }
  }
  return out;
}
