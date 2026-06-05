import assert from "node:assert";
import {
  buildAssetAcquisitionPlan,
  validateAssetAcquisitionReport,
} from "../src/assetAcquisition.js";

const plan = buildAssetAcquisitionPlan({
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  query: "roblox fern dinosaur nursery",
  assetIds: [101, 101, 202],
  targetPlace: "eggBreakers3.rbxl",
});

assert.equal(plan.schema, "roblox-asset-acquisition-plan/v1");
assert.deepEqual(plan.candidate_asset_ids, [101, 202], "candidate ids are deduplicated");
assert.ok(plan.phases.some((phase) => phase.id === "direct_delivery_parse"), "direct delivery phase exists");
assert.ok(plan.phases.some((phase) => phase.id === "studio_insert_fallback"), "Studio fallback phase exists");
assert.ok(plan.policy.asset_brain_is_metadata_only, "asset brain metadata-only policy is explicit");
assert.equal(plan.direct_delivery_requests.length, 2, "one direct delivery request is planned per candidate");
assert.equal(plan.direct_delivery_requests[0].asset_id, 101);
assert.ok(plan.direct_delivery_requests[0].outputs.receipt_path.includes("delivery-receipt"), "delivery request includes receipt path");

const report = {
  schema: "roblox-asset-acquisition-report/v1",
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  gates: {
    search_claim: { passed: true, artifact_path: "asset-brain/v1/claims/fern.json" },
    permission_proof: { passed: true, artifact_path: "asset-brain/v1/permissions/101.json" },
    acquisition_attempt: { passed: true, artifact_path: plan.artifacts.delivery_report },
    direct_delivery_parse: { passed: false, artifact_path: plan.artifacts.delivery_report },
    studio_insert_fallback: { passed: true, artifact_path: plan.artifacts.studio_fallback_report },
    quarantine_scan: { passed: true, artifact_path: `${plan.artifacts.quarantine_root}/scan.json` },
    manifest_validation: { passed: true, artifact_path: plan.artifacts.fragment_manifest },
    visual_gate: { passed: true, artifact_path: plan.artifacts.visual_gate_report },
  },
  quarantined_assets: [
    {
      asset_id: 101,
      has_scripts: false,
      remote_loaders: false,
      permission_status: "pass",
      visual_status: "player_angle_pass",
    },
  ],
  asset_brain_paths: [
    "asset-brain/v1/assets/by-id/101/101.json",
    "asset-brain/v1/permissions/101.json",
  ],
  open_blockers: [],
};

const validation = validateAssetAcquisitionReport(report, plan);
assert.equal(validation.passed, true, validation.errors.join("; "));

const directReceipt = {
  schema: "roblox-asset-delivery-receipt/v1",
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  asset_id: 101,
  version_number: null,
  status: "passed",
  passed: true,
  request: {
    endpoint: "Asset Delivery",
    method: "GET",
    base_url: "https://apis.roblox.com/asset-delivery-api/v1",
    path: "/assetId/101",
    url: "https://apis.roblox.com/asset-delivery-api/v1/assetId/101",
  },
  auth: {
    mode: "api_key",
    source_env: "ROBLOX_OPEN_CLOUD_API_KEY",
    header: "x-api-key",
    credential_present: true,
    redacted: true,
  },
  http: {
    status: 200,
    ok: true,
    content_type: "application/octet-stream",
  },
  output: {
    asset_path: `${plan.artifacts.quarantine_root}/assets/101.rbxm`,
    receipt_path: `${plan.artifacts.quarantine_root}/receipts/101.delivery-receipt.json`,
    bytes: 16,
    sha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    content_type: "application/octet-stream",
  },
  blockers: [],
};
const directDeliveryReport = {
  ...report,
  gates: {
    ...report.gates,
    acquisition_attempt: { passed: true, artifact_path: plan.artifacts.delivery_report },
    direct_delivery_parse: { passed: true, artifact_path: plan.artifacts.delivery_report },
    studio_insert_fallback: { passed: false },
  },
  asset_delivery_receipts: [directReceipt],
};
const directValidation = validateAssetAcquisitionReport(directDeliveryReport, plan);
assert.equal(directValidation.passed, true, directValidation.errors.join("; "));

const missingReceipt = validateAssetAcquisitionReport({
  ...directDeliveryReport,
  asset_delivery_receipts: [],
}, plan);
assert.equal(missingReceipt.passed, false, "passed direct delivery requires receipt evidence");
assert.ok(missingReceipt.errors.some((error) => error.includes("asset_delivery_receipts")), "missing receipt error is explicit");

const badBinaryBrain = validateAssetAcquisitionReport({
  ...report,
  asset_brain_paths: ["asset-brain/v1/assets/101.rbxm"],
}, plan);
assert.equal(badBinaryBrain.passed, false, "asset brain rejects binary outputs");
assert.ok(badBinaryBrain.errors.some((error) => error.includes("metadata-only")), "binary path error is explicit");

const badNoFallback = validateAssetAcquisitionReport({
  ...report,
  gates: {
    ...report.gates,
    studio_insert_fallback: { passed: false },
  },
}, plan);
assert.equal(badNoFallback.passed, false, "failed direct delivery requires Studio fallback");
assert.ok(badNoFallback.errors.some((error) => error.includes("studio_insert_fallback")), "fallback error is explicit");

const badScripts = validateAssetAcquisitionReport({
  ...report,
  quarantined_assets: [{ asset_id: 101, has_scripts: true, remote_loaders: false }],
}, plan);
assert.equal(badScripts.passed, false, "quarantine blocks scripted assets");
assert.ok(badScripts.errors.some((error) => error.includes("scripts")), "script quarantine error is explicit");

console.log("ASSET_ACQUISITION_OK plan and proof report contract validated");
