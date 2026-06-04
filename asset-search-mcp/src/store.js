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
//   * publish permissions — owner/access/dependency proof for release palettes
//
// Persistence is plain JSON under ~/.roblox-asset-brain/ — no native deps.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DAY = 24 * 60 * 60 * 1000;
export const SEARCH_TTL_MS = DAY;
export const PUBLISH_PERMISSION_MODES = ["grantable_only", "grantable_or_open_use"];

const OPEN_USE_ACCESS = new Set(["open_use", "open_use_dependency"]);
const KNOWN_ACCESS = new Set(["grantable", "open_use", "open_use_dependency", "restricted_denied", "unknown"]);
const BLOCKING_POLICIES = new Set(["quarantine", "reject"]);

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
      permissions: path.join(this.dir, "publish-permissions.json"),
    };
    this.searchCache = {};
    this.reviews = {};   // assetId -> [review]
    this.palette = {};   // project -> { slot -> {assetId,name} }
    this.claims = {};    // assetId -> { slot, reviewer, project, at }
    this.inspections = {}; // assetId -> latest StudioMCP inspection record
    this.permissions = {}; // assetId -> latest publish permission proof
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
    this.permissions = await readJson(this.files.permissions, {});
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
  searchCacheStatus(ttlMs = SEARCH_TTL_MS, now = Date.now()) {
    let fresh = 0;
    let stale = 0;
    let oldestAgeMs = 0;
    let newestAgeMs = null;
    for (const entry of Object.values(this.searchCache)) {
      const ageMs = Math.max(0, now - Number(entry.createdAt || 0));
      if (ageMs <= ttlMs) fresh += 1;
      else stale += 1;
      oldestAgeMs = Math.max(oldestAgeMs, ageMs);
      newestAgeMs = newestAgeMs == null ? ageMs : Math.min(newestAgeMs, ageMs);
    }
    return {
      entries: Object.keys(this.searchCache).length,
      fresh,
      stale,
      ttlHours: Math.round((ttlMs / 60 / 60 / 1000) * 100) / 100,
      oldestAgeHours: Math.round((oldestAgeMs / 60 / 60 / 1000) * 100) / 100,
      newestAgeHours: newestAgeMs == null ? 0 : Math.round((newestAgeMs / 60 / 60 / 1000) * 100) / 100,
    };
  }
  async pruneSearchCache(ttlMs = SEARCH_TTL_MS, dryRun = false, now = Date.now()) {
    const kept = {};
    const removedKeys = [];
    for (const [key, entry] of Object.entries(this.searchCache)) {
      const ageMs = Math.max(0, now - Number(entry.createdAt || 0));
      if (ageMs <= ttlMs) kept[key] = entry;
      else removedKeys.push(key);
    }
    if (!dryRun && removedKeys.length) {
      this.searchCache = kept;
      await writeJsonAtomic(this.files.search, this.searchCache);
    }
    return {
      dryRun,
      removed: removedKeys.length,
      kept: Object.keys(kept).length,
      removedKeys,
      ttlHours: Math.round((ttlMs / 60 / 60 / 1000) * 100) / 100,
    };
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

  // --- publish permission memory --------------------------------------
  async recordPublishPermission(assetId, permission) {
    const id = String(assetId);
    this.permissions[id] = normalizePublishPermission(assetId, permission);
    await writeJsonAtomic(this.files.permissions, this.permissions);
  }
  getPublishPermission(assetId) {
    return this.permissions[String(assetId)] || null;
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
    const rs = this.getReviews(assetId);
    return {
      claimedBy: this.isClaimed(assetId),
      rejected: this.isRejected(assetId),
      inspection: this.getInspection(assetId),
      publishPermission: summarizePublishPermission(this.getPublishPermission(assetId)),
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

  brainStatus(ttlMs = SEARCH_TTL_MS) {
    const paletteByProject = {};
    for (const [project, slots] of Object.entries(this.palette)) {
      paletteByProject[project] = Object.keys(slots || {}).length;
    }
    const reviewCounts = Object.values(this.reviews).map((reviews) => Array.isArray(reviews) ? reviews.length : 0);
    return {
      searchCache: this.searchCacheStatus(ttlMs),
      counts: {
        reviewedAssets: Object.keys(this.reviews).length,
        reviews: reviewCounts.reduce((sum, count) => sum + count, 0),
        rejectedAssets: this.rejectedIdSet().size,
        claims: Object.keys(this.claims).length,
        inspections: Object.keys(this.inspections).length,
        publishPermissions: Object.keys(this.permissions).length,
        paletteProjects: Object.keys(this.palette).length,
        paletteAssets: Object.values(paletteByProject).reduce((sum, count) => sum + count, 0),
      },
      paletteByProject,
    };
  }
}

function normalizeAccess(access) {
  const value = String(access || "unknown").toLowerCase();
  return KNOWN_ACCESS.has(value) ? value : "unknown";
}

function defaultPublishPolicy({ access, grantableByUs, experienceHasAccess }) {
  if (access === "restricted_denied") return "reject";
  if (access === "grantable" && grantableByUs === true && experienceHasAccess === true) return "allow";
  if (OPEN_USE_ACCESS.has(access) && experienceHasAccess === true) return "allow_external_open_use";
  return "quarantine";
}

function normalizeDependency(dep) {
  const access = normalizeAccess(dep?.access);
  const status = String(dep?.status || "unknown").toLowerCase();
  return {
    assetId: dep?.assetId ?? dep?.asset_id ?? null,
    type: dep?.type ?? null,
    access,
    grantableByUs: dep?.grantableByUs ?? dep?.grantable_by_us ?? null,
    experienceHasAccess: dep?.experienceHasAccess ?? dep?.experience_has_access ?? null,
    status: ["pass", "quarantine", "reject", "unknown"].includes(status) ? status : "unknown",
    evidence: Array.isArray(dep?.evidence) ? dep.evidence : [],
    notes: dep?.notes ?? null,
  };
}

export function normalizePublishPermission(assetId, permission = {}) {
  const access = normalizeAccess(permission.access);
  const grantableByUs = permission.grantableByUs ?? permission.grantable_by_us ?? null;
  const experienceHasAccess = permission.experienceHasAccess ?? permission.experience_has_access ?? null;
  const dependencies = Array.isArray(permission.dependencies) ? permission.dependencies.map(normalizeDependency) : [];
  const publishPolicy = permission.publishPolicy
    ?? permission.publish_policy
    ?? defaultPublishPolicy({ access, grantableByUs, experienceHasAccess });
  return {
    assetId: Number(assetId),
    targetPublisher: permission.targetPublisher ?? permission.target_publisher ?? null,
    targetExperienceId: permission.targetExperienceId ?? permission.target_experience_id ?? null,
    access,
    grantableByUs,
    experienceHasAccess,
    publishPolicy,
    studioInsertProbe: permission.studioInsertProbe ?? permission.studio_insert_probe ?? "not_run",
    saveReopenProbe: permission.saveReopenProbe ?? permission.save_reopen_probe ?? "not_run",
    dependencies,
    evidence: Array.isArray(permission.evidence) ? permission.evidence : [],
    notes: permission.notes ?? null,
    reviewer: permission.reviewer ?? null,
    source: permission.source ?? "permission-audit",
    recordedAt: Date.now(),
  };
}

function dependencyPasses(dep, errors, index) {
  const label = dep.assetId ? `dependency ${dep.assetId}` : `dependency[${index}]`;
  if (dep.status === "reject") errors.push(`${label} is rejected`);
  if (dep.status === "quarantine" || dep.status === "unknown") errors.push(`${label} permission status is ${dep.status}`);
  if (dep.access === "unknown") errors.push(`${label} access is unknown`);
  if (dep.access === "restricted_denied") errors.push(`${label} is restricted_denied`);
  if (dep.access === "grantable" && dep.grantableByUs !== true) errors.push(`${label} is grantable but not grantable by target publisher`);
  if (dep.experienceHasAccess === false) errors.push(`${label} target experience lacks access`);
}

export function evaluatePublishPermission(record, options = {}) {
  const mode = options.mode || "grantable_or_open_use";
  const requireStudioProbe = Boolean(options.requireStudioProbe ?? options.require_studio_probe);
  const requireSaveReopen = Boolean(options.requireSaveReopen ?? options.require_save_reopen);
  const errors = [];
  const warnings = [];
  if (!record) {
    return {
      passed: false,
      mode,
      access: "missing",
      publishPolicy: "missing",
      errors: ["missing publish permission record"],
      warnings,
    };
  }

  const access = normalizeAccess(record.access);
  if (BLOCKING_POLICIES.has(record.publishPolicy)) errors.push(`publishPolicy is ${record.publishPolicy}`);
  if (access === "unknown") errors.push("asset access is unknown");
  if (access === "restricted_denied") errors.push("asset is restricted_denied");
  if (record.experienceHasAccess !== true) errors.push("target experience access is not proven");

  if (mode === "grantable_only") {
    if (access !== "grantable" || record.grantableByUs !== true) {
      errors.push("asset is not grantable by the target publisher");
    }
  } else if (access === "grantable") {
    if (record.grantableByUs !== true) errors.push("asset is marked grantable but grantableByUs is not true");
  } else if (!OPEN_USE_ACCESS.has(access)) {
    errors.push(`asset access '${access}' is not allowed by mode ${mode}`);
  }

  if (requireStudioProbe && record.studioInsertProbe !== "pass") errors.push("studio insert probe has not passed");
  if (requireSaveReopen && record.saveReopenProbe !== "pass") errors.push("save/reopen probe has not passed");

  for (const [index, dep] of (record.dependencies || []).entries()) {
    dependencyPasses(dep, errors, index);
  }

  if (OPEN_USE_ACCESS.has(access) && mode !== "grantable_only") {
    warnings.push("asset is Open Use, not grantable by target publisher; keep dependency proof fresh");
  }

  return {
    passed: errors.length === 0,
    mode,
    assetId: record.assetId,
    access,
    grantableByUs: record.grantableByUs,
    experienceHasAccess: record.experienceHasAccess,
    publishPolicy: record.publishPolicy,
    dependencyCount: (record.dependencies || []).length,
    errors,
    warnings,
  };
}

export function summarizePublishPermission(record) {
  if (!record) return { status: "missing", publishReady: false };
  const evaluation = evaluatePublishPermission(record);
  return {
    status: evaluation.passed ? "pass" : "fail",
    publishReady: evaluation.passed,
    access: evaluation.access,
    grantableByUs: evaluation.grantableByUs,
    experienceHasAccess: evaluation.experienceHasAccess,
    publishPolicy: evaluation.publishPolicy,
    errors: evaluation.errors,
  };
}

export function validatePalettePublishPermissions({ project, palette, getPermission, options = {} }) {
  const mode = options.mode || "grantable_or_open_use";
  const assets = [];
  const errors = [];
  for (const [slot, entry] of Object.entries(palette || {})) {
    const assetId = Number(entry?.assetId);
    const evaluation = evaluatePublishPermission(getPermission(assetId), options);
    assets.push({
      slot,
      assetId,
      name: entry?.name || null,
      ...evaluation,
    });
    for (const error of evaluation.errors) {
      errors.push(`${slot}:${assetId} ${error}`);
    }
  }
  return {
    passed: errors.length === 0,
    project,
    mode,
    counts: {
      paletteAssets: assets.length,
      passed: assets.filter((asset) => asset.passed).length,
      failed: assets.filter((asset) => !asset.passed).length,
      missing: assets.filter((asset) => asset.access === "missing").length,
    },
    errors,
    warnings: assets.flatMap((asset) => asset.warnings.map((warning) => `${asset.slot}:${asset.assetId} ${warning}`)),
    assets,
  };
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
