const REQUIRED_CLEAN_VIEWS = [
  "clean_front",
  "clean_back",
  "clean_left",
  "clean_right",
  "clean_overhead",
  "clean_player_height",
];

const REQUIRED_AFTER_VIEWS = [
  "clean_front_after",
  "clean_back_after",
  "clean_left_after",
  "clean_right_after",
  "clean_overhead_after",
  "clean_player_height_after",
  "live_player_height_after",
];

const VERDICTS = new Set(["pass", "fix", "reject"]);

function slugify(value, fallback = "asset_family") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bool(value) {
  return value === true;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeFamily(family, index) {
  const raw = asObject(family) || {};
  const id = slugify(raw.family_id || raw.familyId || raw.id || raw.name || `family_${index + 1}`, `family_${index + 1}`);
  return {
    family_id: id,
    name: String(raw.name || id.replace(/_/g, " ")),
    source_asset_id: raw.source_asset_id || raw.sourceAssetId || raw.asset_id || raw.assetId || null,
    slot: raw.slot || raw.palette_slot || raw.paletteSlot || null,
    family_key: raw.family_key || raw.familyKey || raw.mesh_id || raw.meshId || raw.staged_model_path || raw.stagedModelPath || id,
    live_instance_count: numberValue(raw.live_instance_count ?? raw.liveInstanceCount ?? raw.instances ?? raw.count) ?? 1,
    locations: asArray(raw.locations).map(String),
    notes: raw.notes ? String(raw.notes) : "",
  };
}

function normalizeScreenshot(rawScreenshot) {
  const raw = asObject(rawScreenshot) || {};
  return {
    capture_id: String(raw.capture_id || raw.captureId || raw.id || "").trim(),
    family_id: slugify(raw.family_id || raw.familyId || raw.family || ""),
    kind: slugify(raw.kind || raw.view || raw.type || ""),
    phase: slugify(raw.phase || ""),
    image_path: String(raw.image_path || raw.imagePath || raw.path || "").trim(),
    passed: raw.passed !== false,
  };
}

function normalizeFamilyReport(rawFamily) {
  const raw = asObject(rawFamily) || {};
  const id = slugify(raw.family_id || raw.familyId || raw.id || raw.name || "");
  return {
    family_id: id,
    status: slugify(raw.status || raw.verdict || "fix"),
    screenshot_verdict: slugify(raw.screenshot_verdict || raw.screenshotVerdict || raw.status || raw.verdict || "fix"),
    inventory: asObject(raw.inventory) || {},
    clean_clone: asObject(raw.clean_clone || raw.cleanClone) || {},
    canonical: asObject(raw.canonical) || {},
    propagation: asObject(raw.propagation) || {},
    cleanup: asObject(raw.cleanup || raw.temporary_cleanup || raw.temporaryCleanup) || {},
    screenshots: asArray(raw.screenshots).map(normalizeScreenshot),
    findings: asArray(raw.findings),
    blockers: asArray(raw.blockers),
    inspection_recorded: bool(raw.inspection_recorded ?? raw.inspectionRecorded),
    record_inspection_refs: asArray(raw.record_inspection_refs || raw.recordInspectionRefs).map(String),
  };
}

export function buildWorldAssetFamilySweepPlan({
  project = "roblox-game",
  targetPlace = "Place1.rbxl",
  families = [],
  artifactRoot,
  maxFamilies = 24,
} = {}) {
  const familyList = asArray(families).slice(0, maxFamilies).map(normalizeFamily);
  const normalizedProject = slugify(project, "roblox_game");
  const root = artifactRoot || `artifacts/world-asset-family-sweeps/${normalizedProject}`;
  const captures = [];

  for (const family of familyList) {
    for (const kind of REQUIRED_CLEAN_VIEWS) {
      captures.push({
        capture_id: `${normalizedProject}_${family.family_id}_${kind}`,
        family_id: family.family_id,
        kind,
        phase: "before_fix",
        expected_image_path: `${root}/${family.family_id}/${kind}.png`,
      });
    }
    for (const kind of REQUIRED_AFTER_VIEWS) {
      captures.push({
        capture_id: `${normalizedProject}_${family.family_id}_${kind}`,
        family_id: family.family_id,
        kind,
        phase: "after_fix",
        expected_image_path: `${root}/${family.family_id}/${kind}.png`,
      });
    }
  }

  return {
    schema: "roblox-world-asset-family-sweep-plan/v1",
    project: normalizedProject,
    target_place: targetPlace,
    artifact_root: root,
    families: familyList,
    required_clean_views: [...REQUIRED_CLEAN_VIEWS],
    required_after_views: [...REQUIRED_AFTER_VIEWS],
    capture_batch: {
      serial: true,
      captures,
      rule: "Capture one family at a time: clean clone before views, canonical fix, clean clone after views, live player-height after view, then cleanup.",
    },
    family_contract: {
      required_fields: [
        "family_id",
        "inventory.live_instance_count",
        "clean_clone.created",
        "canonical.up",
        "canonical.forward",
        "canonical.scale_policy",
        "canonical.grounding_offset_studs",
        "canonical.pivot_policy",
        "propagation.live_instances_total",
        "propagation.fixed_live_instances",
        "cleanup.clean_clone_removed",
        "screenshots",
        "inspection_recorded",
        "screenshot_verdict",
      ],
      verdicts: ["pass", "fix", "reject"],
      pass_rule: "pass requires all required screenshots with image paths, all visual live instances fixed or explicitly skipped as non-visual, no temporary clone remaining, and inspection metadata recorded.",
    },
    next: [
      "Inventory Workspace visible models and group by source asset id, mesh id, staged model path, palette slot, or stable source name.",
      "Create exactly one clean-spot clone for the current family and strip scripts/audio unless behavior is being reviewed.",
      "Capture clean front/back/left/right/overhead/player-height views before changing orientation or scale.",
      "Apply the canonical up, forward, scale, pivot, grounding, and collision fix to every live visual instance in that family.",
      "Recapture clean after views plus an in-world player-height after view.",
      "Record inspection metadata with worldPlacementAudit and screenshot refs.",
      "Destroy the clean clone and temporary probes before moving to the next family.",
      "Run validate_world_asset_family_sweep before palette commit, visual signoff, or release-ready claims.",
    ],
  };
}

function expectedFamilies(plan, report) {
  const planned = asArray(plan?.families);
  if (planned.length) return planned.map((family, index) => normalizeFamily(family, index));
  const reported = asArray(report?.family_reports || report?.families);
  return reported.map((family, index) => normalizeFamily(family, index));
}

function viewSetFor(familyReport) {
  const set = new Set();
  for (const screenshot of familyReport.screenshots) {
    if (!screenshot.capture_id) continue;
    if (!screenshot.image_path) continue;
    if (screenshot.passed === false) continue;
    if (screenshot.kind) set.add(screenshot.kind);
  }
  return set;
}

function hasInspectionProof(familyReport) {
  return familyReport.inspection_recorded || familyReport.record_inspection_refs.length > 0;
}

export function validateWorldAssetFamilySweep(report, plan = null) {
  const errors = [];
  const warnings = [];
  const raw = asObject(report);
  if (!raw) {
    return {
      passed: false,
      schema: "roblox-world-asset-family-sweep-validation/v1",
      errors: ["report must be a JSON object"],
      warnings,
      counts: {},
    };
  }

  if (raw.schema && raw.schema !== "roblox-world-asset-family-sweep-report/v1") {
    errors.push("report schema must be roblox-world-asset-family-sweep-report/v1");
  }
  const expected = expectedFamilies(plan, raw);
  if (!expected.length) errors.push("at least one asset family is required");
  const reports = asArray(raw.family_reports || raw.families).map(normalizeFamilyReport);
  const reportsById = new Map(reports.map((family) => [family.family_id, family]));
  const globalTemp = asObject(raw.temporary_cleanup || raw.temporaryCleanup) || {};
  if (globalTemp.probes_remaining > 0 || globalTemp.probesRemaining > 0) {
    errors.push("temporary cleanup reports remaining probes");
  }

  let passedFamilies = 0;
  for (const family of expected) {
    const familyReport = reportsById.get(family.family_id);
    if (!familyReport) {
      errors.push(`family '${family.family_id}' is missing a report`);
      continue;
    }
    if (!VERDICTS.has(familyReport.status)) errors.push(`family '${family.family_id}' status must be pass, fix, or reject`);
    if (!VERDICTS.has(familyReport.screenshot_verdict)) errors.push(`family '${family.family_id}' screenshot_verdict must be pass, fix, or reject`);
    const liveCount = numberValue(familyReport.inventory.live_instance_count ?? familyReport.inventory.liveInstanceCount ?? family.live_instance_count);
    if (!liveCount || liveCount < 1) errors.push(`family '${family.family_id}' must inventory at least one live instance`);
    if (!bool(familyReport.clean_clone.created)) errors.push(`family '${family.family_id}' clean clone must be created`);

    for (const field of ["up", "forward", "scale_policy", "pivot_policy"]) {
      if (!familyReport.canonical[field] && !familyReport.canonical[field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]) {
        errors.push(`family '${family.family_id}' canonical.${field} is required`);
      }
    }
    if (numberValue(familyReport.canonical.grounding_offset_studs ?? familyReport.canonical.groundingOffsetStuds) === null) {
      errors.push(`family '${family.family_id}' canonical.grounding_offset_studs is required`);
    }

    const propagationTotal = numberValue(familyReport.propagation.live_instances_total ?? familyReport.propagation.liveInstancesTotal);
    const fixed = numberValue(familyReport.propagation.fixed_live_instances ?? familyReport.propagation.fixedLiveInstances) ?? 0;
    const skipped = numberValue(familyReport.propagation.skipped_non_visual_instances ?? familyReport.propagation.skippedNonVisualInstances) ?? 0;
    if (!propagationTotal || propagationTotal < 1) {
      errors.push(`family '${family.family_id}' propagation.live_instances_total is required`);
    } else if (fixed + skipped < propagationTotal) {
      errors.push(`family '${family.family_id}' did not propagate fixes to all live visual instances`);
    }

    if (!bool(familyReport.cleanup.clean_clone_removed ?? familyReport.cleanup.cleanCloneRemoved)) {
      errors.push(`family '${family.family_id}' clean clone must be removed`);
    }
    const tempRemaining = numberValue(familyReport.cleanup.temporary_models_remaining ?? familyReport.cleanup.temporaryModelsRemaining) ?? 0;
    if (tempRemaining > 0) errors.push(`family '${family.family_id}' has temporary validation models remaining`);

    const views = viewSetFor(familyReport);
    for (const kind of REQUIRED_CLEAN_VIEWS) {
      if (!views.has(kind)) errors.push(`family '${family.family_id}' is missing '${kind}' screenshot`);
    }
    for (const kind of REQUIRED_AFTER_VIEWS) {
      if (!views.has(kind)) errors.push(`family '${family.family_id}' is missing '${kind}' screenshot`);
    }
    if (!hasInspectionProof(familyReport)) {
      errors.push(`family '${family.family_id}' must record inspection metadata or refs`);
    }
    for (const blocker of familyReport.blockers) {
      errors.push(`family '${family.family_id}' blocker remains: ${String(blocker)}`);
    }
    for (const finding of familyReport.findings) {
      const findingObject = asObject(finding);
      if (!findingObject) continue;
      const severity = slugify(findingObject.severity || "major");
      const status = slugify(findingObject.status || (findingObject.resolved ? "resolved" : "open"));
      if (["major", "blocker"].includes(severity) && !["resolved", "accepted_risk"].includes(status)) {
        errors.push(`family '${family.family_id}' unresolved ${severity} finding '${findingObject.id || findingObject.description || "finding"}'`);
      }
    }
    if (familyReport.status === "pass" && familyReport.screenshot_verdict !== "pass") {
      errors.push(`family '${family.family_id}' pass status requires screenshot_verdict=pass`);
    }
    if (familyReport.status === "pass") passedFamilies += 1;
  }

  const verdict = slugify(raw.verdict || (errors.length ? "not_signed_off" : "signed_off"));
  if (verdict === "signed_off" && errors.length) {
    errors.push("signed_off verdict is invalid while family sweep errors are present");
  }

  return {
    schema: "roblox-world-asset-family-sweep-validation/v1",
    passed: errors.length === 0,
    project: raw.project || plan?.project || "unknown",
    target_place: raw.target_place || raw.targetPlace || plan?.target_place || "unknown",
    verdict,
    errors,
    warnings,
    counts: {
      families_required: expected.length,
      family_reports: reports.length,
      families_passed: passedFamilies,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function formatWorldAssetFamilySweepPlan(plan) {
  const lines = [
    `World asset-family sweep for '${plan.project}'`,
    `target=${plan.target_place} families=${plan.families.length} captures=${plan.capture_batch.captures.length}`,
    "",
    "Families:",
  ];
  for (const family of plan.families) {
    const source = family.source_asset_id ? ` source=${family.source_asset_id}` : "";
    lines.push(`- ${family.family_id}${source} live=${family.live_instance_count}`);
  }
  lines.push("", "Required views:", ...[...REQUIRED_CLEAN_VIEWS, ...REQUIRED_AFTER_VIEWS].map((kind) => `- ${kind}`));
  lines.push("", "Next:", ...plan.next.map((step) => `- ${step}`));
  return lines.join("\n");
}

export function formatWorldAssetFamilySweepValidation(result) {
  const lines = [
    result.passed ? "PASS world asset-family sweep" : "FAIL world asset-family sweep",
    `families=${result.counts.families_passed || 0}/${result.counts.families_required || 0} reports=${result.counts.family_reports || 0} verdict=${result.verdict || "unknown"}`,
  ];
  for (const error of result.errors) lines.push(`ERROR: ${error}`);
  for (const warning of result.warnings) lines.push(`WARN: ${warning}`);
  return lines.join("\n");
}
