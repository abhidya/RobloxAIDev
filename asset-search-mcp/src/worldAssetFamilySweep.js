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
const DEFAULT_ADAPTER = "studio_mcp_proxy";
const ADAPTERS = new Set(["studio_mcp_proxy", "manual_studio_mcp"]);

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

function vec(rawValue, fallback) {
  const raw = asObject(rawValue) || {};
  const source = Object.keys(raw).length ? raw : fallback;
  return {
    x: Number(source?.x || 0),
    y: Number(source?.y || 0),
    z: Number(source?.z || 0),
  };
}

function vectorLua(value) {
  const v = vec(value);
  return `Vector3.new(${v.x}, ${v.y}, ${v.z})`;
}

function expectedPlaceNames(targetPlace) {
  const raw = String(targetPlace || "").trim();
  if (!raw) return [];
  const base = raw.replace(/\.(rbxlx?|place)$/i, "");
  return [...new Set([raw, base].filter(Boolean))];
}

function normalizeAdapter(adapter) {
  const normalized = slugify(adapter || DEFAULT_ADAPTER);
  return ADAPTERS.has(normalized) ? normalized : DEFAULT_ADAPTER;
}

function preflightLua(expectedNames) {
  const expected = JSON.stringify(expectedNames || []);
  return [
    `local expected = ${expected}`,
    "local placeName = game.Name",
    "local lowerPlaceName = string.lower(placeName)",
    "local match = #expected == 0",
    "for _, name in ipairs(expected) do",
    "  local key = string.lower(tostring(name))",
    "  if key ~= '' and string.find(lowerPlaceName, key, 1, true) then",
    "    match = true",
    "  end",
    "end",
    "return {",
    "  ok = match,",
    "  placeName = placeName,",
    "  placeId = game.PlaceId,",
    "  workspaceChildren = #workspace:GetChildren(),",
    "  hasCurrentCamera = workspace.CurrentCamera ~= nil,",
    "}",
  ].join("\n");
}

function cameraLua(capture) {
  return [
    "local camera = workspace.CurrentCamera",
    "if not camera then return { ok = false, error = 'workspace.CurrentCamera missing' } end",
    "camera.CameraType = Enum.CameraType.Scriptable",
    `camera.CFrame = CFrame.lookAt(${vectorLua(capture.camera_position)}, ${vectorLua(capture.look_at_position)})`,
    "task.wait(0.15)",
    `return { ok = true, capture_id = ${JSON.stringify(capture.capture_id)}, camera = tostring(camera.CFrame) }`,
  ].join("\n");
}

function defaultCenter(index) {
  return {
    x: (index % 4) * 70,
    y: 4,
    z: Math.floor(index / 4) * 70,
  };
}

function cleanKindBase(kind) {
  return kind.replace(/_after$/u, "");
}

function cameraForKind(family, index, kind) {
  const distance = numberValue(family.camera_distance_studs) ?? 18;
  const playerHeight = numberValue(family.player_camera_height_studs) ?? 4.5;
  const cleanCenter = vec(family.clean_stage_center, defaultCenter(index));
  const liveCenter = vec(family.live_view_center, cleanCenter);
  const baseKind = cleanKindBase(kind);
  const center = baseKind === "live_player_height" ? liveCenter : cleanCenter;
  const lookAt = { x: center.x, y: center.y + 2, z: center.z };

  if (baseKind === "clean_back") {
    return {
      camera_position: { x: center.x, y: center.y + playerHeight, z: center.z - distance },
      look_at_position: lookAt,
    };
  }
  if (baseKind === "clean_left") {
    return {
      camera_position: { x: center.x - distance, y: center.y + playerHeight, z: center.z },
      look_at_position: lookAt,
    };
  }
  if (baseKind === "clean_right") {
    return {
      camera_position: { x: center.x + distance, y: center.y + playerHeight, z: center.z },
      look_at_position: lookAt,
    };
  }
  if (baseKind === "clean_overhead") {
    return {
      camera_position: { x: center.x, y: center.y + Math.max(distance, 24), z: center.z + 0.1 },
      look_at_position: { x: center.x, y: center.y, z: center.z },
    };
  }
  return {
    camera_position: { x: center.x, y: center.y + playerHeight, z: center.z + distance },
    look_at_position: lookAt,
  };
}

function captureInstruction(capture, index, artifactRoot) {
  return {
    ...capture,
    sequence: index + 1,
    studio_mcp_steps: [
      {
        tool: "execute_luau",
        purpose: "Set the edit camera to the planned family validation view.",
        code: cameraLua(capture),
      },
      {
        tool: "screen_capture",
        purpose: "Capture the current Studio viewport after the camera settles.",
        capture_id: capture.capture_id,
        suggested_output_path: capture.expected_image_path,
      },
    ],
    result_contract: {
      capture_id: capture.capture_id,
      family_id: capture.family_id,
      kind: capture.kind,
      phase: capture.phase,
      image_path: capture.expected_image_path || `${artifactRoot}/${capture.family_id}/${capture.kind}.png`,
      passed: false,
      alt_text: "",
      findings: [],
    },
  };
}

function normalizeFamily(family, index) {
  const raw = asObject(family) || {};
  const id = slugify(raw.family_id || raw.familyId || raw.id || raw.name || `family_${index + 1}`, `family_${index + 1}`);
  const cleanStageCenter = raw.clean_stage_center || raw.cleanStageCenter || raw.clean_stage || raw.cleanStage || raw.validation_position || raw.validationPosition;
  const liveViewCenter = raw.live_view_center || raw.liveViewCenter || raw.live_position || raw.livePosition || raw.world_position || raw.worldPosition;
  return {
    family_id: id,
    name: String(raw.name || id.replace(/_/g, " ")),
    source_asset_id: raw.source_asset_id || raw.sourceAssetId || raw.asset_id || raw.assetId || null,
    slot: raw.slot || raw.palette_slot || raw.paletteSlot || null,
    family_key: raw.family_key || raw.familyKey || raw.mesh_id || raw.meshId || raw.staged_model_path || raw.stagedModelPath || id,
    live_instance_count: numberValue(raw.live_instance_count ?? raw.liveInstanceCount ?? raw.instances ?? raw.count) ?? 1,
    locations: asArray(raw.locations).map(String),
    clean_stage_center: cleanStageCenter ? vec(cleanStageCenter) : defaultCenter(index),
    live_view_center: liveViewCenter ? vec(liveViewCenter) : null,
    camera_distance_studs: numberValue(raw.camera_distance_studs ?? raw.cameraDistanceStuds) ?? 18,
    player_camera_height_studs: numberValue(raw.player_camera_height_studs ?? raw.playerCameraHeightStuds) ?? 4.5,
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
  adapter = DEFAULT_ADAPTER,
  maxFamilies = 24,
} = {}) {
  const familyList = asArray(families).slice(0, maxFamilies).map(normalizeFamily);
  const normalizedProject = slugify(project, "roblox_game");
  const root = artifactRoot || `artifacts/world-asset-family-sweeps/${normalizedProject}`;
  const captures = [];

  for (const [familyIndex, family] of familyList.entries()) {
    for (const kind of REQUIRED_CLEAN_VIEWS) {
      const camera = cameraForKind(family, familyIndex, kind);
      captures.push({
        capture_id: `${normalizedProject}_${family.family_id}_${kind}`,
        family_id: family.family_id,
        kind,
        phase: "before_fix",
        expected_image_path: `${root}/${family.family_id}/${kind}.png`,
        ...camera,
      });
    }
    for (const kind of REQUIRED_AFTER_VIEWS) {
      const camera = cameraForKind(family, familyIndex, kind);
      captures.push({
        capture_id: `${normalizedProject}_${family.family_id}_${kind}`,
        family_id: family.family_id,
        kind,
        phase: "after_fix",
        expected_image_path: `${root}/${family.family_id}/${kind}.png`,
        ...camera,
      });
    }
  }
  const captureBatch = captures.map((capture, index) => captureInstruction(capture, index, root));
  const expectedNames = expectedPlaceNames(targetPlace);

  return {
    schema: "roblox-world-asset-family-sweep-plan/v1",
    project: normalizedProject,
    target_place: targetPlace,
    adapter: normalizeAdapter(adapter),
    artifact_root: root,
    families: familyList,
    required_clean_views: [...REQUIRED_CLEAN_VIEWS],
    required_after_views: [...REQUIRED_AFTER_VIEWS],
    agent_call_reduction: {
      model: "one MCP plan call, one wrapper execution, one validation call",
      serial_studio_steps: 1 + captureBatch.length * 2,
      reason: "Studio remains serial, but the agent no longer decides each clean/live family screenshot interactively.",
    },
    studio_preflight: {
      required: true,
      expected_place_names: expectedNames,
      studio_mcp_tool: "execute_luau",
      code: preflightLua(expectedNames),
      failure_rule: "Stop the family sweep when the active Studio place does not match target_place.",
    },
    capture_batch: {
      serial: true,
      retry_policy: {
        max_retries_per_capture: 1,
        retry_same_camera: true,
        fail_batch_on_missing_image: true,
      },
      captures: captureBatch,
      rule: "Capture one family at a time: clean clone before views, canonical fix, clean clone after views, live player-height after view, then cleanup.",
    },
    collation: {
      manifest_path: `${root}/family-sweep-manifest.json`,
      accessibility_index_path: `${root}/alt-text.json`,
      execution_log_path: `${root}/execution-log.json`,
      required_image_fields: ["capture_id", "family_id", "kind", "phase", "image_path", "alt_text", "passed"],
    },
    report_template: {
      schema: "roblox-world-asset-family-sweep-report/v1",
      sweep_id: `${normalizedProject}_${slugify(targetPlace)}`,
      project: normalizedProject,
      target_place: targetPlace,
      active_place: null,
      preflight: {
        passed: false,
        placeName: null,
        placeId: null,
      },
      family_reports: familyList.map((family) => ({
        family_id: family.family_id,
        status: "fix",
        screenshot_verdict: "fix",
        inventory: { live_instance_count: family.live_instance_count },
        clean_clone: { created: false, path: null },
        canonical: {},
        propagation: {
          live_instances_total: family.live_instance_count,
          fixed_live_instances: 0,
          skipped_non_visual_instances: 0,
        },
        cleanup: {
          clean_clone_removed: false,
          temporary_models_remaining: null,
        },
        screenshots: captureBatch
          .filter((capture) => capture.family_id === family.family_id)
          .map((capture) => capture.result_contract),
        findings: [],
        blockers: [],
        inspection_recorded: false,
        record_inspection_refs: [],
      })),
      temporary_cleanup: { probes_remaining: 0 },
      verdict: "not_signed_off",
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
    validation: {
      mcp_tool: "validate_world_asset_family_sweep",
      rule: "The sweep only passes when active-place preflight passes, all planned family screenshots have image paths, and each family report proves canonical metadata, propagation, inspection refs, and cleanup.",
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
  const preflight = asObject(raw.preflight) || {};
  if (plan?.studio_preflight?.required && preflight.passed !== true && preflight.ok !== true) {
    errors.push("active-place preflight did not pass");
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
      const label = String(blocker || "").trim();
      if (!label) {
        errors.push(`family '${family.family_id}' blocker must not be blank`);
      } else {
        errors.push(`family '${family.family_id}' blocker remains: ${label}`);
      }
    }
    for (const finding of familyReport.findings) {
      const findingObject = asObject(finding);
      if (!findingObject) continue;
      const label = String(findingObject.id || findingObject.title || findingObject.description || "").trim();
      if (!label) errors.push(`family '${family.family_id}' finding title/description must not be blank`);
      const severity = slugify(findingObject.severity || "major");
      const status = slugify(findingObject.status || (findingObject.resolved ? "resolved" : "open"));
      if (["major", "blocker"].includes(severity) && !["resolved", "accepted_risk"].includes(status)) {
        errors.push(`family '${family.family_id}' unresolved ${severity} finding '${label || "finding"}'`);
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
