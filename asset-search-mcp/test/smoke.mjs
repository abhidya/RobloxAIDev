// Smoke test: spin up the server as a real MCP client, list tools, and exercise
// search / curate / review / palette. Live search needs network to the Toolbox
// API; if unreachable the wiring is still validated (empty result set).
import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "src", "index.js");
const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-smoke-"));

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env, ASSET_BRAIN_DIR: brainDir },
});

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
const toolNames = tools.tools.map((t) => t.name);
console.log("TOOLS:", toolNames.join(", "));
for (const requiredTool of [
  "plan_ai_game_dev_loop",
  "validate_ai_game_dev_loop",
  "plan_project_template",
  "validate_project_template",
  "plan_game_asset_coverage",
  "preprocess_storyboard_asset_cache",
  "export_asset_brain_snapshot",
  "plan_headless_assembly",
  "validate_fragment_manifest",
  "plan_coordinator_merge",
  "validate_coordinator_merge",
  "plan_playable_space_review",
  "validate_playable_space_review",
  "plan_world_asset_family_sweep",
  "validate_world_asset_family_sweep",
  "plan_batch_visual_gate",
  "validate_batch_visual_gate",
  "plan_asset_acquisition",
  "validate_asset_acquisition",
  "plan_asset_delivery",
  "validate_asset_delivery_receipt",
  "record_inspection",
  "record_inspections",
  "get_inspection",
  "record_asset_permission",
  "record_asset_permissions",
  "get_asset_permission",
  "validate_publish_permissions",
  "validate_prop_hunt_gate",
]) {
  assert.ok(toolNames.includes(requiredTool), `${requiredTool} is listed`);
}

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  return r.content?.[0]?.text ?? "";
}

console.log("\n--- search_assets ---");
console.log((await call("search_assets", { query: "wooden barrel", max_results: 3 })).slice(0, 700));

console.log("\n--- plan_game_asset_coverage ---");
const coverageText = await call("plan_game_asset_coverage", {
  game: "party prop hunt",
  themes: ["underwater reef", "space station"],
  include_defaults: false,
});
assert.ok(coverageText.includes("lobby.portal.room_queue"), "coverage includes lobby portal");
assert.ok(coverageText.includes("underwater_reef.hideable.prop_pack"), "coverage includes underwater room props");
console.log(coverageText.slice(0, 900));

console.log("\n--- preprocess_storyboard_asset_cache ---");
const cachePlan = JSON.parse(await call("preprocess_storyboard_asset_cache", {
  project: "prophunt-smoke",
  game: "party prop hunt",
  themes: ["underwater reef"],
  include_defaults: false,
  warm_search_cache: false,
  max_slots: 8,
  format: "json",
}));
assert.equal(cachePlan.schema, "roblox-storyboard-cache-preprocess/v1", "cache preprocess schema");
assert.ok(cachePlan.slots.some((slot) => slot.slot === "lobby.portal.room_queue"), "cache preprocess includes lobby slots");
assert.ok(cachePlan.pagesLayout.manifest.includes("asset-brain/v1/manifest.json"), "cache preprocess returns Pages layout");
console.log(JSON.stringify({
  slots: cachePlan.slots.length,
  warmed: cachePlan.warmed.length,
  pages: cachePlan.pagesLayout.manifest,
}, null, 2));

console.log("\n--- plan_ai_game_dev_loop ---");
const loopPlan = JSON.parse(await call("plan_ai_game_dev_loop", {
  project: "groan-tube-hero",
  game: "concert defense rhythm arena",
  target_place: "GroanTubeHero.rbxl",
  themes: ["volcano concert arena"],
  assembly_profile: "concert_defense",
  review_mode: "player_angle",
  include_default_spaces: false,
  spaces: [{ id: "stage_circle", quadrants: ["front", "left"] }],
  max_fragments: 2,
  format: "json",
}));
assert.equal(loopPlan.schema, "roblox-ai-game-dev-loop/v1", "MCP e2e loop plan schema");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_headless_assembly"), "MCP e2e loop includes headless tool");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_asset_acquisition"), "MCP e2e loop includes acquisition tool");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_batch_visual_gate"), "MCP e2e loop includes batch visual gate");
assert.ok(loopPlan.phases.some((phase) => phase.id === "parser_writer_generation"), "MCP e2e loop includes parser/writer phase");
assert.ok(loopPlan.studio_adapter.cli.includes("run-studio-batch-visual-gate"), "MCP e2e loop includes Studio adapter CLI");
const loopBatchReport = {
  ...loopPlan.batch_visual_gate_plan.report_template,
  preflight: { passed: true, placeName: "GroanTubeHero.rbxl", placeId: 123 },
  screenshots: loopPlan.batch_visual_gate_plan.capture_batch.captures.map((shot) => ({
    ...shot.result_contract,
    passed: true,
    alt_text: `${shot.capture_id} planned proof`,
  })),
  verdict: "player_angle_signed_off",
};
const loopValidation = JSON.parse(await call("validate_ai_game_dev_loop", {
  plan: loopPlan,
  report: {
    schema: "roblox-ai-game-dev-loop-report/v1",
    project: "groan-tube-hero",
    gates: {
      asset_brain: { passed: true, artifact_path: "asset-brain/v1/manifest.json" },
      gamekit_build: { passed: true, artifact_path: "/tmp/RobloxGameKit.rbxlx" },
      parser_writer_generation: { passed: true, artifact_path: "docs/poc-results/ai-game-dev-poc-latest.json" },
      fragment_manifest_validation: { passed: true, artifact_path: "fragments/groantubehero.manifest.json" },
      custom_mcp_contract: {
        passed: true,
        tools: [
          "plan_ai_game_dev_loop",
          "validate_ai_game_dev_loop",
          "plan_project_template",
          "validate_project_template",
          "plan_asset_acquisition",
          "validate_asset_acquisition",
          "plan_asset_delivery",
          "validate_asset_delivery_receipt",
          "plan_world_asset_family_sweep",
          "validate_world_asset_family_sweep",
          "plan_batch_visual_gate",
          "validate_batch_visual_gate",
          "plan_coordinator_merge",
          "validate_coordinator_merge",
        ],
      },
      batch_visual_gate: {
        passed: true,
        artifact_path: "artifacts/visual-gates/groan-tube-hero/batch-report.json",
        batch_report: loopBatchReport,
      },
    },
    open_blockers: [],
  },
  format: "json",
}));
assert.equal(loopValidation.passed, true, loopValidation.errors.join("; "));
console.log(JSON.stringify({
  phases: loopPlan.phases.length,
  captures: loopPlan.batch_visual_gate_plan.capture_batch.captures.length,
  loopValidation: loopValidation.passed,
}, null, 2));

console.log("\n--- plan_project_template ---");
const templatePlan = JSON.parse(await call("plan_project_template", {
  project: "smoke-game",
  game: "Smoke Game",
  target_place: "SmokeGame.rbxl",
  themes: ["sky lobby"],
  output_root: "work/generated-games/smoke-game",
  format: "json",
}));
assert.equal(templatePlan.schema, "roblox-ai-game-project-template-plan/v1", "MCP project template plan schema");
assert.ok(templatePlan.files.some((file) => file.path === "asset-brain/v1/manifest.json"), "project template includes asset brain manifest");
const templateValidation = JSON.parse(await call("validate_project_template", {
  plan: templatePlan,
  report: {
    schema: "roblox-ai-game-project-template-report/v1",
    project: "smoke-game",
    output_root: "work/generated-games/smoke-game",
    written: templatePlan.files,
    gates: templatePlan.gates,
    safety: templatePlan.safety,
    passed: true,
    blockers: [],
  },
  format: "json",
}));
assert.equal(templateValidation.passed, false, "MCP template validator requires files to exist when a root is supplied");
assert.ok(templateValidation.errors.some((error) => error.includes("expected file not written")), "template validator reports missing files");

console.log("\n--- plan_asset_acquisition ---");
const acquisitionPlan = JSON.parse(await call("plan_asset_acquisition", {
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  query: "roblox fern dinosaur nursery",
  asset_ids: [101, 202],
  target_place: "eggBreakers3.rbxl",
  format: "json",
}));
assert.equal(acquisitionPlan.schema, "roblox-asset-acquisition-plan/v1", "MCP asset acquisition plan schema");
assert.ok(acquisitionPlan.phases.some((phase) => phase.id === "direct_delivery_parse"), "MCP acquisition includes direct delivery");
assert.ok(acquisitionPlan.phases.some((phase) => phase.id === "studio_insert_fallback"), "MCP acquisition includes Studio fallback");
assert.equal(acquisitionPlan.direct_delivery_requests.length, 2, "MCP acquisition includes per-asset delivery requests");
const deliveryRequest = JSON.parse(await call("plan_asset_delivery", {
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  asset_id: 101,
  format: "json",
}));
assert.equal(deliveryRequest.schema, "roblox-asset-delivery-request/v1", "MCP asset delivery request schema");
assert.ok(deliveryRequest.outputs.asset_path.includes("work/asset-acquisition"), "delivery request writes to quarantine");
const deliveryReceipt = {
  schema: "roblox-asset-delivery-receipt/v1",
  project: "eggbreakers",
  slot: "nursery_grove.dino_fern",
  asset_id: 101,
  version_number: null,
  status: "passed",
  passed: true,
  request: deliveryRequest.endpoint,
  auth: {
    mode: "api_key",
    source_env: "ROBLOX_OPEN_CLOUD_API_KEY",
    header: "x-api-key",
    credential_present: true,
    redacted: true,
  },
  http: { status: 200, ok: true, content_type: "application/octet-stream" },
  output: {
    asset_path: deliveryRequest.outputs.asset_path,
    receipt_path: deliveryRequest.outputs.receipt_path,
    bytes: 12,
    sha256: "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    content_type: "application/octet-stream",
  },
  blockers: [],
};
const deliveryValidation = JSON.parse(await call("validate_asset_delivery_receipt", {
  request: deliveryRequest,
  receipt: deliveryReceipt,
  format: "json",
}));
assert.equal(deliveryValidation.passed, true, deliveryValidation.errors.join("; "));
const acquisitionValidation = JSON.parse(await call("validate_asset_acquisition", {
  plan: acquisitionPlan,
  report: {
    schema: "roblox-asset-acquisition-report/v1",
    project: "eggbreakers",
    slot: "nursery_grove.dino_fern",
    gates: {
      search_claim: { passed: true, artifact_path: "asset-brain/v1/claims/fern.json" },
      permission_proof: { passed: true, artifact_path: "asset-brain/v1/permissions/101.json" },
      acquisition_attempt: { passed: true, artifact_path: acquisitionPlan.artifacts.delivery_report },
      direct_delivery_parse: { passed: false, artifact_path: acquisitionPlan.artifacts.delivery_report },
      studio_insert_fallback: { passed: true, artifact_path: acquisitionPlan.artifacts.studio_fallback_report },
      quarantine_scan: { passed: true, artifact_path: `${acquisitionPlan.artifacts.quarantine_root}/scan.json` },
      manifest_validation: { passed: true, artifact_path: acquisitionPlan.artifacts.fragment_manifest },
      visual_gate: { passed: true, artifact_path: acquisitionPlan.artifacts.visual_gate_report },
    },
    quarantined_assets: [{
      asset_id: 101,
      has_scripts: false,
      remote_loaders: false,
      permission_status: "pass",
      visual_status: "player_angle_pass",
    }],
    asset_brain_paths: ["asset-brain/v1/assets/by-id/101/101.json"],
    open_blockers: [],
  },
  format: "json",
}));
assert.equal(acquisitionValidation.passed, true, acquisitionValidation.errors.join("; "));
console.log(JSON.stringify({
  phases: acquisitionPlan.phases.length,
  acquisitionValidation: acquisitionValidation.passed,
}, null, 2));

console.log("\n--- plan_headless_assembly ---");
const headlessJson = JSON.parse(await call("plan_headless_assembly", {
  project: "prophunt",
  target_place: "Place1.rbxl",
  themes: ["underwater reef", "space station"],
  include_lobby: true,
  max_fragments: 3,
  format: "json",
}));
assert.equal(headlessJson.mode, "headless-fragment-fanout", "headless assembly plan mode");
assert.ok(headlessJson.agent_work_packets.some((packet) => packet.fragment_id.includes("lobby_shell")), "headless plan includes lobby packet");
assert.ok(headlessJson.coordinator_merge_steps.some((step) => step.includes("referents")), "headless plan includes referent merge steps");
assert.equal(headlessJson.coordinator_merge_plan.schema, "roblox-headless-coordinator-merge-plan/v1", "headless plan includes coordinator merge plan");
const coordinatorPlan = JSON.parse(await call("plan_coordinator_merge", {
  adapter: "rbx_dom",
  place: "work/headless-poc/Place1.headless-working.rbxl",
  out: "work/headless-poc/Place1.rbx-dom.rbxl",
  fragments: ["work/headless-poc/generated-headless-marker.manifest.json"],
  format: "json",
}));
assert.equal(coordinatorPlan.adapter, "rbx_dom", "MCP coordinator planner supports rbx-dom adapter");
const coordinatorValidation = JSON.parse(await call("validate_coordinator_merge", {
  plan: coordinatorPlan,
  report: {
    schema: "roblox-headless-coordinator-report/v1",
    adapter: "rbx_dom",
    passed: true,
    status: "passed",
    output: {
      place_path: coordinatorPlan.outputs.place_path,
      reload_validated: true,
    },
    identity_policy: coordinatorPlan.identity_policy,
    fragments: [{ manifest_path: coordinatorPlan.inputs.fragments[0] }],
    process: { exit_code: 0 },
    blockers: [],
  },
  format: "json",
}));
assert.equal(coordinatorValidation.passed, true, coordinatorValidation.errors.join("; "));
console.log(JSON.stringify({
  packets: headlessJson.agent_work_packets.map((packet) => packet.fragment_id),
  validation: headlessJson.validation_commands,
}, null, 2));
const concertHeadlessJson = JSON.parse(await call("plan_headless_assembly", {
  project: "groan-tube-hero",
  target_place: "GroanTubeHero.rbxl",
  themes: ["volcano concert arena"],
  include_lobby: true,
  max_fragments: 2,
  assembly_profile: "concert_defense",
  format: "json",
}));
assert.equal(concertHeadlessJson.assembly_profile, "concert_defense", "MCP headless plan supports concert profile");
assert.ok(
  concertHeadlessJson.agent_work_packets.some((packet) => packet.target_parent === "Workspace.GTH_WorldV2"),
  "concert profile targets WorldV2"
);

console.log("\n--- validate_fragment_manifest ---");
const manifestJson = JSON.parse(await call("validate_fragment_manifest", {
  format: "json",
  manifest: {
    version: "roblox-fragment-manifest/v1",
    fragment_id: "smoke_lobby",
    target_parent: "Workspace",
    order_key: "000-lobby",
    single_root: true,
    root_name: "SmokeLobby",
    source_digest: "sha256:smoke",
    asset_ids: [12345],
    identity_policy: {
      referents: "coordinator_remap",
      unique_ids: "strip",
      history_ids: "strip",
    },
  },
}));
assert.equal(manifestJson.passed, true, "safe manifest passes");
const badManifestText = await call("validate_fragment_manifest", {
  manifest: {
    fragment_id: "bad",
    target_parent: "Workspace",
    order_key: "999-bad",
    roots: ["A", "B"],
    source_digest: "sha256:bad",
    asset_ids: [111],
    identity_policy: { referents: "agent_preserve", unique_ids: "preserve" },
    scripts: [{ path: "Bad/Script", source: "require(123456789)" }],
  },
});
assert.ok(badManifestText.startsWith("FAIL"), "unsafe manifest fails");
assert.ok(badManifestText.includes("require(assetId)"), "unsafe manifest reports numeric require");
console.log(badManifestText.split("\n").slice(0, 5).join("\n"));

console.log("\n--- plan_playable_space_review ---");
const reviewPlan = JSON.parse(await call("plan_playable_space_review", {
  project: "prophunt",
  format: "json",
}));
assert.ok(reviewPlan.spaces.some((space) => space.id === "lobby"), "playable-space plan includes lobby");
assert.ok(reviewPlan.captures.some((shot) => shot.kind === "player_height_quadrant"), "playable-space plan includes player-height quadrants");
console.log(JSON.stringify({
  spaces: reviewPlan.spaces.map((space) => space.id),
  captures: reviewPlan.captures.length,
}, null, 2));
const playerAnglePlan = JSON.parse(await call("plan_playable_space_review", {
  project: "eggbreakers",
  review_mode: "player_angle",
  include_defaults: false,
  spaces: [{ id: "nursery_grove", quadrants: ["spawn", "food"] }],
  format: "json",
}));
assert.equal(playerAnglePlan.review_mode, "player_angle", "MCP plan supports scoped player-angle mode");
assert.ok(playerAnglePlan.captures.every((shot) => shot.kind === "player_height_quadrant"), "scoped MCP plan only emits player-height shots");

console.log("\n--- validate_playable_space_review ---");
const reviewReport = {
  project: "prophunt",
  spaces_reviewed: reviewPlan.spaces.map((space) => space.id),
  screenshots: reviewPlan.captures.map((shot) => ({
    capture_id: shot.capture_id,
    space_id: shot.space_id,
    kind: shot.kind,
    quadrant: shot.quadrant,
    ui_state: shot.ui_state,
    passed: true,
  })),
  findings: [],
  fixes: [],
  verdict: "signed_off",
};
const reviewValidation = JSON.parse(await call("validate_playable_space_review", {
  report: reviewReport,
  plan: reviewPlan,
  format: "json",
}));
assert.equal(reviewValidation.passed, true, "complete visual report passes");
const badReviewText = await call("validate_playable_space_review", {
  report: {
    project: "prophunt",
    spaces_reviewed: ["lobby"],
    screenshots: [{ capture_id: "only_lobby_entry", space_id: "lobby", kind: "entry" }],
    findings: [{ id: "bad", space_id: "cozy_cabin", severity: "blocker", status: "open", description: "bad view" }],
    verdict: "signed_off",
  },
  plan: reviewPlan,
});
assert.ok(badReviewText.startsWith("FAIL"), "incomplete visual review fails");
assert.ok(badReviewText.includes("unresolved blocker"), "visual review reports unresolved blocker");
console.log(badReviewText.split("\n").slice(0, 7).join("\n"));

console.log("\n--- plan_world_asset_family_sweep ---");
const familyPlan = JSON.parse(await call("plan_world_asset_family_sweep", {
  project: "eggbreakers",
  target_place: "eggBreakers3.rbxl",
  families: [{
    family_id: "fern_food_and_ground_cover",
    source_asset_id: 7979002756,
    slot: "fern_plains.herbivore_food",
    live_instance_count: 12,
  }],
  format: "json",
}));
assert.equal(familyPlan.schema, "roblox-world-asset-family-sweep-plan/v1", "MCP family sweep plan schema");
assert.ok(familyPlan.capture_batch.captures.some((shot) => shot.kind === "live_player_height_after"), "family sweep requires live proof");
const familyShots = familyPlan.capture_batch.captures.map((shot) => ({
  capture_id: shot.capture_id,
  family_id: shot.family_id,
  kind: shot.kind,
  phase: shot.phase,
  image_path: shot.expected_image_path,
  passed: true,
}));
const familyValidation = JSON.parse(await call("validate_world_asset_family_sweep", {
  plan: familyPlan,
  report: {
    schema: "roblox-world-asset-family-sweep-report/v1",
    project: "eggbreakers",
    target_place: "eggBreakers3.rbxl",
    family_reports: [{
      family_id: "fern_food_and_ground_cover",
      status: "pass",
      screenshot_verdict: "pass",
      inventory: { live_instance_count: 12 },
      clean_clone: { created: true },
      canonical: {
        up: "Y+",
        forward: "Z- toward path",
        scale_policy: "preserve source scale",
        grounding_offset_studs: 0,
        pivot_policy: "PrimaryPart at visual base",
      },
      propagation: { live_instances_total: 12, fixed_live_instances: 12, skipped_non_visual_instances: 0 },
      cleanup: { clean_clone_removed: true, temporary_models_remaining: 0 },
      screenshots: familyShots,
      findings: [],
      blockers: [],
      inspection_recorded: true,
    }],
    temporary_cleanup: { probes_remaining: 0 },
    verdict: "signed_off",
  },
  format: "json",
}));
assert.equal(familyValidation.passed, true, familyValidation.errors.join("; "));
const badFamilyText = await call("validate_world_asset_family_sweep", {
  plan: familyPlan,
  report: {
    schema: "roblox-world-asset-family-sweep-report/v1",
    project: "eggbreakers",
    target_place: "eggBreakers3.rbxl",
    family_reports: [{
      family_id: "fern_food_and_ground_cover",
      status: "pass",
      screenshot_verdict: "pass",
      inventory: { live_instance_count: 12 },
      clean_clone: { created: true },
      canonical: { up: "Y+", forward: "Z-", scale_policy: "preserve", grounding_offset_studs: 0, pivot_policy: "base" },
      propagation: { live_instances_total: 12, fixed_live_instances: 1, skipped_non_visual_instances: 0 },
      cleanup: { clean_clone_removed: false, temporary_models_remaining: 1 },
      screenshots: familyShots.filter((shot) => shot.kind !== "live_player_height_after"),
      findings: [],
      blockers: [],
      inspection_recorded: false,
    }],
    verdict: "signed_off",
  },
});
assert.ok(badFamilyText.startsWith("FAIL"), "temp-only family sweep fails");
assert.ok(badFamilyText.includes("live_player_height_after"), "family sweep reports missing live proof");
console.log(JSON.stringify({
  families: familyPlan.families.length,
  captures: familyPlan.capture_batch.captures.length,
  validation: familyValidation.passed,
}, null, 2));

console.log("\n--- plan_batch_visual_gate ---");
const batchPlan = JSON.parse(await call("plan_batch_visual_gate", {
  project: "groan-tube-hero",
  target_place: "GroanTubeHero.rbxl",
  review_mode: "player_angle",
  include_defaults: false,
  spaces: [{ id: "stage_circle", quadrants: ["front", "left"] }],
  format: "json",
}));
assert.equal(batchPlan.schema, "roblox-studio-batch-visual-gate/v1", "batch visual gate schema");
assert.equal(batchPlan.capture_batch.serial, true, "batch visual gate is serial");
assert.ok(batchPlan.studio_preflight.code.includes("placeName"), "batch visual gate includes active-place preflight");
const batchReport = {
  ...batchPlan.report_template,
  preflight: { passed: true, placeName: "GroanTubeHero.rbxl" },
  screenshots: batchPlan.capture_batch.captures.map((shot) => ({
    ...shot.result_contract,
    passed: true,
    alt_text: `${shot.capture_id} planned screenshot`,
  })),
  verdict: "player_angle_signed_off",
};
const batchValidation = JSON.parse(await call("validate_batch_visual_gate", {
  batch_report: batchReport,
  plan: batchPlan,
  format: "json",
}));
assert.equal(batchValidation.passed, true, batchValidation.errors.join("; "));
console.log(JSON.stringify({
  captures: batchPlan.capture_batch.captures.length,
  serialSteps: batchPlan.agent_call_reduction.serial_studio_steps,
}, null, 2));

console.log("\n--- curate_assets ---");
console.log(
  (await call("curate_assets", {
    slots: [{ slot: "barrel", query: "medieval barrel" }],
    per_slot: 2,
  })).slice(0, 500)
);

console.log("\n--- review_asset + palette ---");
console.log(await call("review_asset", { asset_id: 12345, verdict: "keep", notes: "smoke test", slot: "barrel" }));
console.log(await call("record_inspection", {
  asset_id: 12345,
  slot: "medieval_market.hideable.barrel",
  size_studs: { x: 2, y: 3, z: 2 },
  has_scripts: false,
  script_count: 0,
  base_part_count: 1,
  anchored_capable: true,
  primary_part: true,
  visual_risks: ["needs player-angle recapture after scale fix"],
  visual_risk_score: 4,
  screenshot_verdict: "fix",
  source: "smoke",
}));
console.log(await call("record_asset_permission", {
  asset_id: 12345,
  access: "grantable",
  grantable_by_us: true,
  experience_has_access: true,
  publish_policy: "allow",
  studio_insert_probe: "pass",
  save_reopen_probe: "pass",
  dependencies: [{ asset_id: 1234501, type: "Mesh", access: "open_use", experience_has_access: true, status: "pass" }],
  evidence: ["smoke-dashboard-export", "smoke-save-reopen"],
  source: "smoke",
}));
console.log(await call("commit_palette", {
  project: "prophunt-smoke",
  slot: "medieval_market.hideable.barrel",
  asset_id: 12345,
  name: "Barrel",
  require_publish_permission: true,
  publish_permission_mode: "grantable_only",
  require_studio_probe: true,
  require_save_reopen: true,
}));
console.log(await call("record_inspections", {
  inspections: [{
    asset_id: 34567,
    slot: "medieval_market.hideable.crate",
    size_studs: { x: 3, y: 3, z: 3 },
    has_scripts: false,
    script_count: 0,
    base_part_count: 1,
    anchored_capable: true,
    primary_part: true,
    source: "smoke-bulk",
  }],
}));
console.log(await call("record_asset_permissions", {
  permissions: [{
    asset_id: 23456,
    access: "open_use",
    grantable_by_us: false,
    experience_has_access: true,
    publish_policy: "allow_external_open_use",
    studio_insert_probe: "pass",
    dependencies: [],
    source: "smoke-bulk-permission",
  }],
}));
console.log(await call("commit_palette", {
  project: "prophunt-smoke",
  slot: "medieval_market.setpiece.market_stall",
  asset_id: 23456,
  name: "Market Stall",
  require_publish_permission: true,
  publish_permission_mode: "grantable_or_open_use",
  require_studio_probe: true,
}));
const refusedCommit = await call("commit_palette", {
  project: "prophunt-smoke",
  slot: "medieval_market.hideable.bad_permission",
  asset_id: 99999,
  name: "No Permission",
  require_publish_permission: true,
  publish_permission_mode: "grantable_only",
});
assert.ok(refusedCommit.startsWith("Refused to commit"), "strict palette commit refuses missing permission proof");
console.log(await call("record_inspection", {
  asset_id: 23456,
  slot: "medieval_market.setpiece.market_stall",
  size_studs: { x: 12, y: 8, z: 10 },
  has_scripts: false,
  script_count: 0,
  base_part_count: 3,
  anchored_capable: true,
  primary_part: true,
  source: "smoke",
}));
console.log(await call("get_palette", { project: "prophunt-smoke" }));
const permissionJson = JSON.parse(await call("get_asset_permission", {
  asset_id: 12345,
  publish_permission_mode: "grantable_only",
  require_studio_probe: true,
  require_save_reopen: true,
}));
assert.equal(permissionJson.evaluation.passed, true, "asset permission evaluates as publish-ready");
const publishGateJson = JSON.parse(await call("validate_publish_permissions", {
  project: "prophunt-smoke",
  publish_permission_mode: "grantable_or_open_use",
  require_studio_probe: true,
  format: "json",
}));
assert.equal(publishGateJson.passed, true, "palette publish permission gate passes");
const paletteCurate = await call("curate_assets", {
  project: "prophunt-smoke",
  include_palette: true,
  slots: [{ slot: "medieval_market.hideable.barrel", query: "query that should not be needed for committed palette fallback" }],
  per_slot: 1,
});
assert.ok(paletteCurate.includes("PALETTE:medieval_market.hideable.barrel"), "curate can surface committed palette fallback");
assert.ok(paletteCurate.includes("diagnostics:"), "curate includes diagnostics");
const gateText = await call("validate_prop_hunt_gate", {
  project: "prophunt-smoke",
  min_areas: 1,
  min_hideable_total: 1,
  min_setpiece_total: 1,
});
assert.ok(gateText.startsWith("PASS"), "text gate passes");
console.log(gateText);
const gateJson = JSON.parse(await call("validate_prop_hunt_gate", {
  project: "prophunt-smoke",
  min_areas: 1,
  min_hideable_total: 1,
  min_setpiece_total: 1,
  format: "json",
}));
assert.equal(gateJson.passed, true, "json gate passes");
assert.equal(gateJson.counts.hideable_total, 1, "json gate returns counts");

console.log("\n--- export_asset_brain_snapshot ---");
const snapshot = JSON.parse(await call("export_asset_brain_snapshot", {
  project: "prophunt-smoke",
  include_search_cache: false,
  format: "json",
}));
assert.equal(snapshot.schema, "roblox-asset-brain-snapshot/v1", "snapshot schema");
assert.ok(snapshot.assets.some((asset) => asset.assetId === 12345), "snapshot includes inspected asset");
assert.equal(snapshot.assets.find((asset) => asset.assetId === 12345).visual.screenshotVerdict, "fix", "snapshot includes visual metadata");
assert.equal(snapshot.assets.find((asset) => asset.assetId === 12345).publishReadiness.passed, true, "snapshot includes publish readiness");
console.log(JSON.stringify({
  assets: snapshot.counts.assets,
  paletteAssets: snapshot.counts.paletteAssets,
  publishPermissions: snapshot.counts.publishPermissions,
  pages: snapshot.pagesLayout.manifest,
}, null, 2));

await client.close();
await fs.rm(brainDir, { recursive: true, force: true });
console.log("\nSMOKE OK");
process.exit(0);
