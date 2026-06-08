// DAL connection layer: opens the shared asset-brain SQLite database.
//
// Uses node:sqlite (built into Node >= 22.5) so the server keeps its
// zero-native-dependency property. SQLite WAL mode + busy_timeout gives the
// cross-process safety the old whole-file JSON rewrites could not: parallel
// agent sessions (multiple MCP server processes) share one brain without
// last-writer-wins clobbering, and claims are race-safe via transactions.
//
// On first open, any legacy ~/.roblox-asset-brain/*.json state is imported
// once (recorded in the meta table) so existing brains migrate losslessly.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

export function sqliteAvailable() {
  return DatabaseSync != null;
}

export function brainDir() {
  return process.env.ASSET_BRAIN_DIR || path.join(os.homedir(), ".roblox-asset-brain");
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_cache (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ranked TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  slot TEXT,
  rating INTEGER,
  notes TEXT,
  reviewer TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_asset ON reviews(asset_id);
CREATE TABLE IF NOT EXISTS claims (
  asset_id INTEGER PRIMARY KEY,
  slot TEXT NOT NULL,
  reviewer TEXT,
  project TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inspections (
  asset_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  asset_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS palette (
  project TEXT NOT NULL,
  slot TEXT NOT NULL,
  asset_id INTEGER NOT NULL,
  name TEXT,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (project, slot)
);
`;

export function openDatabase(dir = brainDir()) {
  if (!sqliteAvailable()) {
    throw new Error(
      "asset-search-mcp requires the built-in node:sqlite module (Node.js >= 22.5). " +
      `Current runtime: ${process.version}. Upgrade Node to run the SQL-backed asset brain.`
    );
  }
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "asset-brain.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  setMetaIfMissing(db, "schema_version", String(SCHEMA_VERSION));
  importLegacyJson(db, dir);
  return db;
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

function setMetaIfMissing(db, key, value) {
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(key, String(value));
}

/** Run fn inside an IMMEDIATE transaction (write lock up front, race-safe). */
export function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw error;
  }
}

function readLegacy(dir, name) {
  const file = path.join(dir, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** One-time import of the pre-SQL JSON brain files. Idempotent via meta flag. */
export function importLegacyJson(db, dir) {
  if (getMeta(db, "legacy_json_imported")) return false;
  const search = readLegacy(dir, "search-cache.json") || {};
  const reviews = readLegacy(dir, "reviews.json") || {};
  const palette = readLegacy(dir, "palette.json") || {};
  const claims = readLegacy(dir, "claims.json") || {};
  const inspections = readLegacy(dir, "inspections.json") || {};
  const permissions = readLegacy(dir, "publish-permissions.json") || {};

  withTransaction(db, () => {
    // Re-check inside the transaction so two processes can't both import.
    if (getMeta(db, "legacy_json_imported")) return;
    const now = Date.now();
    const putSearch = db.prepare("INSERT OR IGNORE INTO search_cache (key, created_at, ranked) VALUES (?, ?, ?)");
    for (const [key, entry] of Object.entries(search)) {
      if (!entry || !Array.isArray(entry.ranked)) continue;
      putSearch.run(key, Number(entry.createdAt) || now, JSON.stringify(entry.ranked));
    }
    const putReview = db.prepare("INSERT INTO reviews (asset_id, verdict, slot, rating, notes, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [assetId, list] of Object.entries(reviews)) {
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        putReview.run(Number(assetId), String(r.verdict ?? ""), r.slot ?? null, r.rating ?? null, r.notes ?? null, r.reviewer ?? null, Number(r.createdAt) || now);
      }
    }
    const putClaim = db.prepare("INSERT OR IGNORE INTO claims (asset_id, slot, reviewer, project, at) VALUES (?, ?, ?, ?, ?)");
    for (const [assetId, claim] of Object.entries(claims)) {
      if (!claim || !claim.slot) continue;
      putClaim.run(Number(assetId), String(claim.slot), claim.reviewer ?? null, claim.project ?? null, Number(claim.at) || now);
    }
    const putInspection = db.prepare("INSERT OR IGNORE INTO inspections (asset_id, data, recorded_at) VALUES (?, ?, ?)");
    for (const [assetId, record] of Object.entries(inspections)) {
      if (!record) continue;
      putInspection.run(Number(assetId), JSON.stringify(record), Number(record.recordedAt) || now);
    }
    const putPermission = db.prepare("INSERT OR IGNORE INTO permissions (asset_id, data, recorded_at) VALUES (?, ?, ?)");
    for (const [assetId, record] of Object.entries(permissions)) {
      if (!record) continue;
      putPermission.run(Number(assetId), JSON.stringify(record), Number(record.recordedAt) || now);
    }
    const putPalette = db.prepare("INSERT OR IGNORE INTO palette (project, slot, asset_id, name, committed_at) VALUES (?, ?, ?, ?, ?)");
    for (const [project, slots] of Object.entries(palette)) {
      for (const [slot, entry] of Object.entries(slots || {})) {
        if (!entry || entry.assetId == null) continue;
        putPalette.run(project, slot, Number(entry.assetId), entry.name ?? null, now);
      }
    }
    setMeta(db, "legacy_json_imported", new Date().toISOString());
  });
  return true;
}
