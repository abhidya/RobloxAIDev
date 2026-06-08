// DAOs (data access objects) for the asset brain. Each DAO owns one table and
// hides its SQL behind a small interface; the Store service layer composes
// them. All methods are synchronous (node:sqlite is sync) — the Store wraps
// them in the async API the MCP tools already use.

import { withTransaction } from "./database.js";

export class SearchCacheDao {
  constructor(db) { this.db = db; }
  get(key, ttlMs, now = Date.now()) {
    const row = this.db.prepare("SELECT created_at, ranked FROM search_cache WHERE key = ?").get(key);
    if (!row) return null;
    if (now - Number(row.created_at) > ttlMs) return null;
    try { return JSON.parse(row.ranked); } catch { return null; }
  }
  put(key, ranked, now = Date.now()) {
    this.db.prepare(
      "INSERT INTO search_cache (key, created_at, ranked) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET created_at = excluded.created_at, ranked = excluded.ranked"
    ).run(key, now, JSON.stringify(ranked));
  }
  status(ttlMs, now = Date.now()) {
    const rows = this.db.prepare("SELECT created_at FROM search_cache").all();
    let fresh = 0, stale = 0, oldestAgeMs = 0, newestAgeMs = null;
    for (const row of rows) {
      const ageMs = Math.max(0, now - Number(row.created_at));
      if (ageMs <= ttlMs) fresh += 1; else stale += 1;
      oldestAgeMs = Math.max(oldestAgeMs, ageMs);
      newestAgeMs = newestAgeMs == null ? ageMs : Math.min(newestAgeMs, ageMs);
    }
    const hours = (ms) => Math.round((ms / 36e5) * 100) / 100;
    return {
      entries: rows.length, fresh, stale,
      ttlHours: hours(ttlMs),
      oldestAgeHours: hours(oldestAgeMs),
      newestAgeHours: newestAgeMs == null ? 0 : hours(newestAgeMs),
    };
  }
  prune(ttlMs, dryRun = false, now = Date.now()) {
    const cutoff = now - ttlMs;
    const removedKeys = this.db.prepare("SELECT key FROM search_cache WHERE created_at < ?").all(cutoff).map((r) => r.key);
    if (!dryRun && removedKeys.length) {
      this.db.prepare("DELETE FROM search_cache WHERE created_at < ?").run(cutoff);
    }
    const kept = this.db.prepare("SELECT COUNT(*) AS n FROM search_cache").get().n - (dryRun ? 0 : 0);
    return {
      dryRun,
      removed: removedKeys.length,
      kept: dryRun ? kept - removedKeys.length : kept,
      removedKeys,
      ttlHours: Math.round((ttlMs / 36e5) * 100) / 100,
    };
  }
  entries(limit = 100) {
    return this.db.prepare("SELECT key, created_at, ranked FROM search_cache ORDER BY created_at DESC LIMIT ?")
      .all(limit)
      .map((row) => {
        let ranked = [];
        try { ranked = JSON.parse(row.ranked); } catch { /* skip corrupt */ }
        return { key: row.key, createdAt: Number(row.created_at), ranked };
      });
  }
}

export class ReviewsDao {
  constructor(db) { this.db = db; }
  add(assetId, review, now = Date.now()) {
    this.db.prepare(
      "INSERT INTO reviews (asset_id, verdict, slot, rating, notes, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(Number(assetId), String(review.verdict ?? ""), review.slot ?? null, review.rating ?? null, review.notes ?? null, review.reviewer ?? null, now);
  }
  listFor(assetId) {
    return this.db.prepare(
      "SELECT verdict, slot, rating, notes, reviewer, created_at AS createdAt FROM reviews WHERE asset_id = ? ORDER BY id"
    ).all(Number(assetId));
  }
  rejectedAssetIds() {
    return this.db.prepare("SELECT DISTINCT asset_id FROM reviews WHERE lower(verdict) LIKE 'rej%'").all().map((r) => Number(r.asset_id));
  }
  assetIds() {
    return this.db.prepare("SELECT DISTINCT asset_id FROM reviews").all().map((r) => Number(r.asset_id));
  }
  counts() {
    const assets = this.db.prepare("SELECT COUNT(DISTINCT asset_id) AS n FROM reviews").get().n;
    const reviews = this.db.prepare("SELECT COUNT(*) AS n FROM reviews").get().n;
    return { assets, reviews };
  }
}

export class ClaimsDao {
  constructor(db) { this.db = db; }
  get(assetId) {
    return this.db.prepare("SELECT asset_id AS assetId, slot, reviewer, project, at FROM claims WHERE asset_id = ?").get(Number(assetId)) || null;
  }
  all() {
    return this.db.prepare("SELECT asset_id AS assetId, slot, reviewer, project, at FROM claims ORDER BY at").all();
  }
  assetIds() {
    return this.db.prepare("SELECT asset_id FROM claims").all().map((r) => Number(r.asset_id));
  }
  /** Atomically claim ids for a slot. Existing claims for OTHER slots are skipped. */
  claimMany(project, slot, assetIds, reviewer, now = Date.now()) {
    return withTransaction(this.db, () => {
      const claimed = [];
      const skipped = [];
      const select = this.db.prepare("SELECT slot FROM claims WHERE asset_id = ?");
      const upsert = this.db.prepare(
        "INSERT INTO claims (asset_id, slot, reviewer, project, at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(asset_id) DO UPDATE SET reviewer = excluded.reviewer, project = excluded.project, at = excluded.at"
      );
      for (const id of assetIds) {
        const existing = select.get(Number(id));
        if (existing && existing.slot !== slot) { skipped.push({ id, by: existing.slot }); continue; }
        upsert.run(Number(id), slot, reviewer || null, project || null, now);
        claimed.push(id);
      }
      return { claimed, skipped };
    });
  }
  release(assetId) {
    const result = this.db.prepare("DELETE FROM claims WHERE asset_id = ?").run(Number(assetId));
    return Number(result.changes) > 0;
  }
  releaseStale(maxAgeMs, now = Date.now()) {
    const cutoff = now - maxAgeMs;
    const stale = this.db.prepare("SELECT asset_id AS assetId, slot, at FROM claims WHERE at < ?").all(cutoff);
    if (stale.length) this.db.prepare("DELETE FROM claims WHERE at < ?").run(cutoff);
    return stale;
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM claims").get().n;
  }
}

class JsonByAssetDao {
  constructor(db, table) { this.db = db; this.table = table; }
  set(assetId, record, now = Date.now()) {
    this.db.prepare(
      `INSERT INTO ${this.table} (asset_id, data, recorded_at) VALUES (?, ?, ?) ` +
      "ON CONFLICT(asset_id) DO UPDATE SET data = excluded.data, recorded_at = excluded.recorded_at"
    ).run(Number(assetId), JSON.stringify(record), now);
  }
  get(assetId) {
    const row = this.db.prepare(`SELECT data FROM ${this.table} WHERE asset_id = ?`).get(Number(assetId));
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
  }
  assetIds() {
    return this.db.prepare(`SELECT asset_id FROM ${this.table}`).all().map((r) => Number(r.asset_id));
  }
  count() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table}`).get().n;
  }
}

export class InspectionsDao extends JsonByAssetDao {
  constructor(db) { super(db, "inspections"); }
}

export class PermissionsDao extends JsonByAssetDao {
  constructor(db) { super(db, "permissions"); }
}

export class PaletteDao {
  constructor(db) { this.db = db; }
  commit(project, slot, assetId, name, now = Date.now()) {
    this.db.prepare(
      "INSERT INTO palette (project, slot, asset_id, name, committed_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(project, slot) DO UPDATE SET asset_id = excluded.asset_id, name = excluded.name, committed_at = excluded.committed_at"
    ).run(project, slot, Number(assetId), name ?? null, now);
  }
  get(project) {
    const rows = this.db.prepare("SELECT slot, asset_id AS assetId, name FROM palette WHERE project = ? ORDER BY slot").all(project);
    const out = {};
    for (const row of rows) out[row.slot] = { assetId: Number(row.assetId), name: row.name ?? null };
    return out;
  }
  projects() {
    return this.db.prepare("SELECT DISTINCT project FROM palette ORDER BY project").all().map((r) => r.project);
  }
  countByProject() {
    const out = {};
    for (const row of this.db.prepare("SELECT project, COUNT(*) AS n FROM palette GROUP BY project").all()) {
      out[row.project] = Number(row.n);
    }
    return out;
  }
}
