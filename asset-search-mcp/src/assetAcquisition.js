import { OPEN_CLOUD_ENDPOINTS } from "./headlessPipeline.js";

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "asset";
}

function uniqueIds(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const id = Number(value);
    if (Number.isFinite(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function artifactPaths(project, slot) {
  const root = `work/asset-acquisition/${slugify(project)}/${slugify(slot)}`;
  return {
    quarantine_root: `${root}/quarantine`,
    delivery_report: `${root}/delivery-report.json`,
    studio_fallback_report: `${root}/studio-fallback-report.json`,
    fragment_manifest: `${root}/fragment.manifest.json`,
    visual_gate_report: `${root}/visual-gate/batch-report.json`,
  };
}

function endpoint(name) {
  return OPEN_CLOUD_ENDPOINTS.find((item) => item.name === name) || null;
}

export function buildAssetAcquisitionPlan({
  project = "roblox-ai-game",
  slot = "unassigned.asset",
  query = "",
  assetIds = [],
  targetPlace = "Place1.rbxl",
  deliveryMode = "direct_or_studio_fallback",
  requirePublishPermission = true,
} = {}) {
  const ids = uniqueIds(assetIds);
  const artifacts = artifactPaths(project, slot);
  return {
    schema: "roblox-asset-acquisition-plan/v1",
    project,
    slot,
    query,
    target_place: targetPlace,
    delivery_mode: deliveryMode,
    candidate_asset_ids: ids,
    policy: {
      asset_brain_is_metadata_only: true,
      quarantine_before_palette: true,
      direct_delivery_preferred: deliveryMode !== "studio_only",
      studio_insert_is_fallback: deliveryMode !== "direct_only",
      require_publish_permission: requirePublishPermission,
      no_runtime_asset_loaders: true,
    },
    artifacts,
    phases: [
      {
        id: "search_claim",
        goal: "Find, shortlist, and claim candidates before any file or Studio work.",
        tools: ["search_assets", "curate_assets", "claim_assets", "reject_asset"],
        outputs: ["claims", "rejections", "shortlist"],
      },
      {
        id: "permission_proof",
        goal: "Record target publisher, target experience, dependency, Studio insert, and save/reopen proof.",
        tools: ["record_asset_permission", "record_asset_permissions", "validate_publish_permissions"],
        required: requirePublishPermission,
        outputs: ["publish-permission records"],
      },
      {
        id: "direct_delivery_parse",
        goal: "Try asset delivery outside Studio, parse the serialized model, and write quarantine metadata.",
        endpoints: [endpoint("Asset Delivery"), endpoint("Toolbox asset metadata")].filter(Boolean),
        parsers: [
          "Lune @lune/roblox for current Luau-native parse/serialize POC",
          "rbx-dom for production binary/XML authority",
        ],
        outputs: [artifacts.delivery_report, artifacts.quarantine_root],
      },
      {
        id: "studio_insert_fallback",
        goal: "If direct delivery is unavailable or permission-gated, insert through the active-place-gated Studio adapter and preserve the same report shape.",
        tools: ["record_inspection", "record_asset_permission", "plan_batch_visual_gate"],
        required_when: "direct_delivery_parse fails or delivery_mode is studio_only",
        outputs: [artifacts.studio_fallback_report],
      },
      {
        id: "quarantine_scan",
        goal: "Reject scripts, remote loaders, unsafe dependencies, missing roots, and unreviewed permissions before palette commit.",
        tools: ["record_inspection", "validate_fragment_manifest"],
        outputs: [artifacts.fragment_manifest],
      },
      {
        id: "visual_gate",
        goal: "Capture clean-spot/player-angle proof before the asset can be promoted from quarantine to palette.",
        tools: ["plan_batch_visual_gate", "validate_batch_visual_gate", "commit_palette"],
        outputs: [artifacts.visual_gate_report],
      },
    ],
    validation_contract: {
      schema: "roblox-asset-acquisition-report/v1",
      required_gate_ids: [
        "search_claim",
        "permission_proof",
        "acquisition_attempt",
        "quarantine_scan",
        "manifest_validation",
        "visual_gate",
      ],
      conditional_gate_ids: ["direct_delivery_parse", "studio_insert_fallback"],
    },
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function gate(report, id) {
  return asObject(report.gates?.[id]);
}

function passed(report, id) {
  return gate(report, id).passed === true;
}

function artifact(gateValue) {
  return String(gateValue.artifact_path || gateValue.artifact || "").trim();
}

export function validateAssetAcquisitionReport(report, plan = null) {
  const errors = [];
  const warnings = [];
  const raw = asObject(report);
  const expectedPlan = asObject(plan);
  const requiredGateIds = expectedPlan.validation_contract?.required_gate_ids || [
    "search_claim",
    "permission_proof",
    "acquisition_attempt",
    "quarantine_scan",
    "manifest_validation",
    "visual_gate",
  ];

  if (raw.schema && raw.schema !== "roblox-asset-acquisition-report/v1") {
    errors.push(`report schema must be roblox-asset-acquisition-report/v1, got ${raw.schema}`);
  }
  if (!raw.gates || typeof raw.gates !== "object") {
    errors.push("gates object is required");
  }
  for (const gateId of requiredGateIds) {
    if (!passed(raw, gateId)) errors.push(`gate '${gateId}' must pass`);
  }

  const delivery = gate(raw, "direct_delivery_parse");
  const studioFallback = gate(raw, "studio_insert_fallback");
  if (delivery.passed !== true && studioFallback.passed !== true) {
    errors.push("either direct_delivery_parse or studio_insert_fallback must pass");
  }
  if (delivery.passed === false && !studioFallback.artifact_path) {
    warnings.push("failed direct delivery should include a studio_insert_fallback artifact path");
  }

  for (const gateId of ["acquisition_attempt", "quarantine_scan", "manifest_validation", "visual_gate"]) {
    const value = gate(raw, gateId);
    if (Object.keys(value).length && !artifact(value)) warnings.push(`gate '${gateId}' should record an artifact_path`);
  }

  const quarantined = Array.isArray(raw.quarantined_assets) ? raw.quarantined_assets : [];
  if (!quarantined.length) {
    errors.push("quarantined_assets array is required and must not be empty");
  }
  for (const item of quarantined) {
    const assetId = Number(item.asset_id ?? item.assetId);
    if (!Number.isFinite(assetId)) errors.push("every quarantined asset needs asset_id");
    if (item.has_scripts === true || item.hasScripts === true) errors.push(`${assetId || "asset"} still has scripts in quarantine`);
    if (item.remote_loaders === true || item.remoteLoaders === true) errors.push(`${assetId || "asset"} still has remote loaders in quarantine`);
    if (!item.permission_status && !item.permissionStatus) warnings.push(`${assetId || "asset"} should include permission_status`);
    if (!item.visual_status && !item.visualStatus) warnings.push(`${assetId || "asset"} should include visual_status`);
  }

  const assetBrainPaths = Array.isArray(raw.asset_brain_paths) ? raw.asset_brain_paths : [];
  for (const path of assetBrainPaths) {
    if (/\.(rbxm|rbxlx?|png|jpg|jpeg|webp)$/i.test(String(path))) {
      errors.push(`asset brain path must stay metadata-only: ${path}`);
    }
  }

  const blockers = Array.isArray(raw.open_blockers) ? raw.open_blockers : [];
  if (blockers.length) errors.push(`open blockers remain: ${blockers.join("; ")}`);

  return {
    schema: "roblox-asset-acquisition-validation/v1",
    passed: errors.length === 0,
    project: raw.project || expectedPlan.project || "unknown",
    slot: raw.slot || expectedPlan.slot || "unknown",
    counts: {
      required_gates: requiredGateIds.length,
      gates_passed: requiredGateIds.filter((gateId) => passed(raw, gateId)).length,
      quarantined_assets: quarantined.length,
      warnings: warnings.length,
      errors: errors.length,
    },
    errors,
    warnings,
  };
}

export function formatAssetAcquisitionPlan(plan) {
  const lines = [
    `Asset acquisition plan for '${plan.project}' slot=${plan.slot}`,
    `query=${plan.query || "(none)"} target=${plan.target_place} mode=${plan.delivery_mode}`,
    `candidates=${plan.candidate_asset_ids.length}`,
    "",
    "Policy:",
    ...Object.entries(plan.policy).map(([key, value]) => `- ${key}=${value}`),
    "",
    "Phases:",
  ];
  for (const phase of plan.phases) {
    lines.push(`- ${phase.id}: ${phase.goal}`);
  }
  lines.push("", "Artifacts:");
  for (const [key, value] of Object.entries(plan.artifacts)) {
    lines.push(`- ${key}: ${value}`);
  }
  return lines.join("\n");
}

export function formatAssetAcquisitionValidation(result) {
  const lines = [
    `${result.passed ? "PASS" : "FAIL"} asset acquisition '${result.project}' slot=${result.slot}`,
    `gates=${result.counts.gates_passed}/${result.counts.required_gates} quarantined=${result.counts.quarantined_assets} warnings=${result.counts.warnings} errors=${result.counts.errors}`,
  ];
  if (result.errors.length) lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}
