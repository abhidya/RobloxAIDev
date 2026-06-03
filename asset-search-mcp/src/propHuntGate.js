// Repo-side Prop Hunt validation for the asset-search MCP.
//
// This is deliberately the catalog/inspection gate only: StudioMCP still owns
// inserting assets, registering Workspace.HideableProps, and playtesting the
// round loop. The point here is to make the asset palette fail fast before a
// live Studio build spends time on bad or under-specified props.

export const PROP_HUNT_GATE_DEFAULTS = {
  min_areas: 3,
  min_hideable_total: 20,
  min_setpiece_total: 4,
  min_hideable_per_area: 0,
  min_setpiece_per_area: 0,
  min_hideable_studs: 1,
  max_hideable_studs: 8,
  require_inspections: true,
  require_primary_part: true,
};

const HIDEABLE_TOKENS = new Set(["hideable", "hideables", "hider", "hiders", "prop", "props", "disguise", "disguises"]);
const SETPIECE_TOKENS = new Set(["setpiece", "setpieces", "set_piece", "set_pieces", "scene", "scenery", "landmark", "landmarks"]);

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function slotSegments(slot) {
  return String(slot || "")
    .split(/[.:/\\]+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function tokensForSlot(slot) {
  return slotSegments(slot).flatMap((segment) => segment.split("_").filter(Boolean));
}

export function classifySlot(slot) {
  const segments = slotSegments(slot);
  const tokens = tokensForSlot(slot);
  const area = segments[0] || "unscoped";
  const compactTokens = new Set([...tokens, ...segments]);
  let role = null;
  if ([...compactTokens].some((token) => HIDEABLE_TOKENS.has(token))) role = "hideable";
  if ([...compactTokens].some((token) => SETPIECE_TOKENS.has(token))) role = "setpiece";
  return { area, role };
}

function boolValue(value) {
  if (value == null) return null;
  return Boolean(value);
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sizeObject(inspection) {
  const raw = inspection?.sizeStuds || inspection?.size_studs || inspection?.size;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const [x, y, z] = raw.map(numberValue);
    return x != null && y != null && z != null ? { x, y, z } : null;
  }
  const x = numberValue(raw.x ?? raw.X);
  const y = numberValue(raw.y ?? raw.Y);
  const z = numberValue(raw.z ?? raw.Z);
  return x != null && y != null && z != null ? { x, y, z } : null;
}

function maxDimension(inspection) {
  const size = sizeObject(inspection);
  if (!size) return null;
  return Math.max(size.x, size.y, size.z);
}

function inspectionScriptCount(inspection) {
  return numberValue(inspection?.scriptCount ?? inspection?.script_count) ?? 0;
}

function inspectionBasePartCount(inspection) {
  return numberValue(inspection?.basePartCount ?? inspection?.base_part_count);
}

function inspectionHasScripts(inspection) {
  return Boolean(inspection?.hasScripts ?? inspection?.has_scripts) || inspectionScriptCount(inspection) > 0;
}

function inspectionAnchoredCapable(inspection) {
  return boolValue(inspection?.anchoredCapable ?? inspection?.anchored_capable);
}

function inspectionPrimaryPart(inspection) {
  return boolValue(inspection?.primaryPart ?? inspection?.primary_part);
}

function areaStatsTemplate() {
  return { hideable: 0, setpiece: 0, other: 0 };
}

export function validatePropHuntGate({ project = "prophunt", palette, getInspection, getReviews, options = {} }) {
  const opts = { ...PROP_HUNT_GATE_DEFAULTS, ...options };
  const entries = Object.entries(palette || {}).map(([slot, value]) => ({
    slot,
    assetId: Number(value.assetId),
    name: value.name || null,
    ...classifySlot(slot),
  }));

  const errors = [];
  const warnings = [];
  const areaStats = new Map();

  for (const entry of entries) {
    if (!areaStats.has(entry.area)) areaStats.set(entry.area, areaStatsTemplate());
    const stats = areaStats.get(entry.area);
    if (entry.role === "hideable") stats.hideable += 1;
    else if (entry.role === "setpiece") stats.setpiece += 1;
    else stats.other += 1;

    if (!entry.role) {
      warnings.push(`${entry.slot} is not classified; use area.hideable.name or area.setpiece.name for gate assets.`);
    }

    const reviews = getReviews ? getReviews(entry.assetId) : [];
    if (reviews.some((r) => String(r.verdict || "").toLowerCase().startsWith("rej"))) {
      errors.push(`${entry.slot} -> ${entry.assetId} has a persisted reject review.`);
    }

    const inspection = getInspection ? getInspection(entry.assetId) : null;
    if (opts.require_inspections && !inspection) {
      errors.push(`${entry.slot} -> ${entry.assetId} is missing a StudioMCP inspection record.`);
      continue;
    }
    if (!inspection) continue;

    const issues = Array.isArray(inspection.issues) ? inspection.issues.filter(Boolean) : [];
    for (const issue of issues) warnings.push(`${entry.slot} -> ${entry.assetId} inspection issue: ${issue}`);

    if (inspectionHasScripts(inspection)) {
      errors.push(`${entry.slot} -> ${entry.assetId} has scripts (${inspectionScriptCount(inspection)}).`);
    }

    const baseParts = inspectionBasePartCount(inspection);
    if (baseParts != null && baseParts < 1) {
      errors.push(`${entry.slot} -> ${entry.assetId} has no BaseParts.`);
    }

    const anchored = inspectionAnchoredCapable(inspection);
    if (anchored === false) {
      errors.push(`${entry.slot} -> ${entry.assetId} is not anchored-capable.`);
    }

    if (entry.role === "hideable") {
      const max = maxDimension(inspection);
      if (max == null) {
        errors.push(`${entry.slot} -> ${entry.assetId} is missing measured size_studs.`);
      } else if (max < opts.min_hideable_studs || max > opts.max_hideable_studs) {
        errors.push(`${entry.slot} -> ${entry.assetId} hideable max dimension ${max} is outside ${opts.min_hideable_studs}-${opts.max_hideable_studs} studs.`);
      }

      const primary = inspectionPrimaryPart(inspection);
      if (opts.require_primary_part && primary !== true) {
        errors.push(`${entry.slot} -> ${entry.assetId} must record primary_part=true for disguise registration.`);
      }
    }
  }

  const classifiedAreaCount = [...areaStats.values()].filter((stats) => stats.hideable + stats.setpiece > 0).length;
  const counts = {
    palette_assets: entries.length,
    areas: classifiedAreaCount,
    hideable_total: [...areaStats.values()].reduce((sum, stats) => sum + stats.hideable, 0),
    setpiece_total: [...areaStats.values()].reduce((sum, stats) => sum + stats.setpiece, 0),
  };

  if (counts.areas < opts.min_areas) errors.push(`Need ${opts.min_areas}+ areas; palette has ${counts.areas}.`);
  if (counts.hideable_total < opts.min_hideable_total) errors.push(`Need ${opts.min_hideable_total}+ hideable props; palette has ${counts.hideable_total}.`);
  if (counts.setpiece_total < opts.min_setpiece_total) errors.push(`Need ${opts.min_setpiece_total}+ set pieces; palette has ${counts.setpiece_total}.`);

  for (const [area, stats] of areaStats) {
    if (stats.hideable < opts.min_hideable_per_area) errors.push(`${area} needs ${opts.min_hideable_per_area}+ hideables; has ${stats.hideable}.`);
    if (stats.setpiece < opts.min_setpiece_per_area) errors.push(`${area} needs ${opts.min_setpiece_per_area}+ set pieces; has ${stats.setpiece}.`);
  }

  const areas = Object.fromEntries([...areaStats.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    project,
    passed: errors.length === 0,
    options: opts,
    counts,
    areas,
    errors,
    warnings,
  };
}

export function formatPropHuntGateReport(result) {
  const status = result.passed ? "PASS" : "FAIL";
  const lines = [
    `${status} Prop Hunt asset gate for '${result.project}'`,
    `areas=${result.counts.areas} hideables=${result.counts.hideable_total} setpieces=${result.counts.setpiece_total} palette_assets=${result.counts.palette_assets}`,
  ];
  for (const [area, stats] of Object.entries(result.areas)) {
    lines.push(`- ${area}: hideable=${stats.hideable} setpiece=${stats.setpiece} other=${stats.other}`);
  }
  if (result.errors.length) {
    lines.push("", "Errors:");
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  if (result.warnings.length) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  if (result.passed) {
    lines.push("", "Studio-only next checks: insert/build in edit mode, populate Workspace.HideableProps, then run the round loop playtest.");
  }
  return lines.join("\n");
}
