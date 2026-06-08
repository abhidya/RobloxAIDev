import { createFindings, sealVerdict } from "./proofBundle.js";

export const PUBLISH_PERMISSION_MODES = ["grantable_only", "grantable_or_open_use"];

const OPEN_USE_ACCESS = new Set(["open_use", "open_use_dependency"]);
const KNOWN_ACCESS = new Set(["grantable", "open_use", "open_use_dependency", "restricted_denied", "unknown"]);
const BLOCKING_POLICIES = new Set(["quarantine", "reject"]);

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
  const findings = createFindings();
  const { errors, warnings } = findings;
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

  return sealVerdict(findings, {
    fields: {
      mode,
      assetId: record.assetId,
      access,
      grantableByUs: record.grantableByUs,
      experienceHasAccess: record.experienceHasAccess,
      publishPolicy: record.publishPolicy,
      dependencyCount: (record.dependencies || []).length,
    },
  });
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
