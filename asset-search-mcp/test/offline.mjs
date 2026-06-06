// Offline tests: parsing/ranking/curation/expansion (toolbox) + the shared-brain
// dedup logic (rejections, claims, off-theme filtering). No network.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAsset, scoreAsset, expandQuery } from "../src/toolbox.js";
import { Store, diversify, filterByTerms } from "../src/store.js";
import { buildGameAssetCoverage } from "../src/gameCoverage.js";
import {
  buildHeadlessAssemblyPlan,
  validateFragmentManifest,
} from "../src/headlessPipeline.js";
import {
  buildPlayableSpaceReviewPlan,
  validatePlayableSpaceReview,
} from "../src/playableSpaceReview.js";
import {
  buildWorldAssetFamilySweepPlan,
  validateWorldAssetFamilySweep,
} from "../src/worldAssetFamilySweep.js";
import {
  buildBatchVisualGatePlan,
  validateBatchVisualGateReport,
} from "../src/visualBatchGate.js";
import {
  buildAiGameDevLoopPlan,
  validateAiGameDevLoopReport,
} from "../src/aiGameDevLoop.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "../src/propHuntGate.js";

// ---- toolbox parsing/ranking ----
const sample = {
  asset: { id: 5585023058, name: "Crate with Tarp", description: "A nicely textured wooden crate.", assetTypeId: 10,
    instanceCounts: { meshPart: 2, decal: 1, script: 0 }, objectMeshSummary: { triangles: 1200, vertices: 800 }, hasScripts: false },
  creator: { name: "PartyInABox2", verified: true },
  creatorStoreProduct: { purchasable: true },
  voting: { voteCount: 42, upVotePercent: 95 },
};
const a = normalizeAsset("Model", sample);
assert.equal(a.id, 5585023058); assert.equal(a.verified, true); assert.equal(a.triangles, 1200);
const expected = Math.log(42) * 10 + 95 * 0.45 + 20 + 5 + 5;
assert.ok(Math.abs(a.score - expected) < 1e-6, "score formula");

const curated = diversify([{id:1,creator:"X",score:9},{id:2,creator:"X",score:8},{id:3,creator:"X",score:7},{id:4,creator:"Y",score:6}], 5, 2);
assert.deepEqual(curated.map((c)=>c.id), [1,2,4], "max 2 per creator");
assert.ok(expandQuery("medieval barrel").length >= 5, "extensive expansion");

// ---- off-theme filtering ----
const themed = filterByTerms(
  [{name:"Medieval Barrel"},{name:"Low Poly Palm Tree"},{name:"Sci-Fi Neon Crate"},{name:"Wooden Cart"}],
  ["palm","sci-fi","neon"]
);
assert.deepEqual(themed.map((x)=>x.name), ["Medieval Barrel","Wooden Cart"], "off-theme names dropped");

// ---- skill asset coverage planner ----
const coverage = buildGameAssetCoverage({
  game: "party prop hunt",
  themes: ["underwater reef", "space station"],
  includeDefaults: false,
});
const coverageSlots = coverage.slots.map((slot) => slot.slot);
assert.ok(coverage.systems.some((system) => system.includes("Spawn")), "generic Roblox spawn system covered");
assert.ok(coverage.systems.some((system) => system.includes("capacity-limited")), "room matchmaking covered");
assert.ok(coverage.systems.some((system) => system.includes("leave-queue")), "room leave-queue UX covered");
assert.ok(coverageSlots.includes("lobby.portal.room_queue"), "lobby portal slot covered");
assert.ok(coverageSlots.includes("underwater_reef.hideable.prop_pack"), "underwater hideable slot covered");
assert.ok(coverageSlots.includes("underwater_reef.avatar.form"), "underwater fish/morph slot covered");
assert.ok(coverageSlots.includes("space_station.room.arena_shell"), "space room slot covered");

// ---- headless fragment assembly planning + manifest validation ----
const headlessPlan = buildHeadlessAssemblyPlan({
  project: "prophunt",
  targetPlace: "Place1.rbxl",
  themes: ["underwater reef", "space station"],
  maxFragments: 3,
});
assert.equal(headlessPlan.mode, "headless-fragment-fanout", "headless plan mode");
assert.equal(headlessPlan.assembly_profile, "prop_hunt", "prop hunt profile remains default");
assert.ok(headlessPlan.endpoints.some((endpoint) => endpoint.url.includes("toolbox-service/v2/assets:search")), "Creator Store search endpoint documented");
assert.ok(headlessPlan.endpoints.some((endpoint) => endpoint.url.includes("assetdelivery.roblox.com")), "Asset Delivery endpoint documented");
assert.ok(headlessPlan.agent_work_packets.some((packet) => packet.fragment_id.includes("lobby_shell")), "lobby fragment packet generated");
assert.ok(headlessPlan.agent_work_packets.some((packet) => packet.theme === "underwater reef"), "underwater fragment packet generated");
assert.ok(headlessPlan.fragment_contract.required_fields.includes("source_digest"), "fragment contract requires digest");
assert.ok(headlessPlan.coordinator_merge_steps.some((step) => step.includes("remap all referents")), "coordinator owns referent remap");
assert.equal(headlessPlan.coordinator_merge_plan.schema, "roblox-headless-coordinator-merge-plan/v1", "headless plan includes coordinator adapter contract");
assert.ok(headlessPlan.coordinator_adapters.some((adapter) => adapter.adapter === "rbx_dom"), "headless plan exposes rbx-dom adapter seam");

const concertHeadlessPlan = buildHeadlessAssemblyPlan({
  project: "groan-tube-hero",
  targetPlace: "GroanTubeHero.rbxl",
  themes: ["volcano concert arena", "brainrot monster horde"],
  maxFragments: 3,
  assemblyProfile: "concert_defense",
});
assert.equal(concertHeadlessPlan.assembly_profile, "concert_defense", "concert defense profile recorded");
assert.ok(
  concertHeadlessPlan.agent_work_packets.some((packet) => packet.target_parent === "Workspace.GTH_WorldV2"),
  "concert defense packets target WorldV2 instead of PropHuntRooms"
);
assert.ok(
  concertHeadlessPlan.studio_gate.some((step) => step.includes("active Studio instance")),
  "concert defense Studio gate requires active-place confirmation"
);

const goodManifest = validateFragmentManifest({
  version: "roblox-fragment-manifest/v1",
  fragment_id: "underwater_room",
  target_parent: "Workspace.PropHuntRooms",
  order_key: "100-underwater",
  single_root: true,
  root_name: "UnderwaterRoom",
  source_digest: "sha256:abc123",
  asset_ids: [12345, "67890"],
  external_anchors: ["Workspace.RoomSpawns.Underwater"],
  identity_policy: {
    referents: "coordinator_remap",
    unique_ids: "strip",
    history_ids: "strip",
  },
  scripts: [{ path: "UnderwaterRoom/ClientCue", source: "print('ready')" }],
});
assert.equal(goodManifest.passed, true, goodManifest.errors.join("; "));
assert.equal(goodManifest.normalized.identity_policy.referents, "coordinator_remap", "referent policy normalized");

const badManifest = validateFragmentManifest({
  fragment_id: "bad_room",
  target_parent: "Workspace.PropHuntRooms",
  order_key: "999-bad",
  roots: ["A", "B"],
  source_digest: "abc123",
  asset_ids: [12345],
  preserve_referents: true,
  identity_policy: {
    referents: "agent_preserve",
    unique_ids: "preserve",
  },
  scripts: [{ path: "Bad/Script", source: "local m = require(123456789)" }],
});
assert.equal(badManifest.passed, false, "unsafe fragment manifest fails");
assert.ok(badManifest.errors.some((error) => error.includes("coordinator_remap")), "bad referent policy rejected");
assert.ok(badManifest.errors.some((error) => error.includes("single_root")), "multi-root fragment rejected");
assert.ok(badManifest.errors.some((error) => error.includes("require(assetId)")), "numeric require rejected");

// ---- playable-space visual review plan + validation ----
const visualPlan = buildPlayableSpaceReviewPlan({ project: "prophunt" });
assert.ok(visualPlan.spaces.some((space) => space.id === "lobby"), "visual review includes lobby");
assert.ok(visualPlan.spaces.some((space) => space.id === "medieval_market"), "visual review includes medieval room");
assert.ok(visualPlan.captures.some((shot) => shot.kind === "player_height_quadrant" && shot.quadrant === "nw"), "visual review requires quadrant player shot");
assert.ok(visualPlan.captures.some((shot) => shot.kind === "ui_state" && shot.ui_state === "hiding"), "visual review includes round UI states");

const goodVisualReport = {
  project: "prophunt",
  spaces_reviewed: visualPlan.spaces.map((space) => space.id),
  screenshots: visualPlan.captures.map((shot) => ({
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
const goodVisual = validatePlayableSpaceReview(goodVisualReport, visualPlan);
assert.equal(goodVisual.passed, true, goodVisual.errors.join("; "));
assert.equal(goodVisual.counts.spaces_required, 4, "visual review requires all default spaces");

const playerAnglePlan = buildPlayableSpaceReviewPlan({
  project: "eggbreakers",
  reviewMode: "player_angle",
  includeDefaults: false,
  spaces: [{ id: "nursery_grove", name: "Nursery Grove", quadrants: ["spawn", "food", "water"] }],
});
assert.equal(playerAnglePlan.review_mode, "player_angle", "player-angle review mode recorded");
assert.ok(playerAnglePlan.captures.every((shot) => shot.kind === "player_height_quadrant"), "player-angle mode only requires player-height screenshots");
assert.equal(playerAnglePlan.captures.length, 3, "player-angle mode emits one shot per requested quadrant");
const playerAngleReport = {
  project: "eggbreakers",
  spaces_reviewed: ["nursery_grove"],
  screenshots: playerAnglePlan.captures.map((shot) => ({
    capture_id: shot.capture_id,
    space_id: shot.space_id,
    kind: shot.kind,
    quadrant: shot.quadrant,
    passed: true,
  })),
  findings: [],
  fixes: [],
  verdict: "player_angle_signed_off",
};
const scopedVisual = validatePlayableSpaceReview(playerAngleReport, playerAnglePlan);
assert.equal(scopedVisual.passed, true, scopedVisual.errors.join("; "));
assert.equal(scopedVisual.review_mode, "player_angle", "scoped signoff keeps player-angle mode");

const inferredCustomVisual = validatePlayableSpaceReview({
  project: "eggbreakers",
  review_mode: "player_angle",
  spaces_reviewed: ["nursery_grove"],
  screenshots: [
    { capture_id: "eggbreakers_nursery_grove_spawn_player", space_id: "nursery_grove", kind: "player_height_quadrant", quadrant: "spawn", passed: true },
    { capture_id: "eggbreakers_nursery_grove_food_player", space_id: "nursery_grove", kind: "player_height_quadrant", quadrant: "food", passed: true },
  ],
  findings: [],
  fixes: [],
  verdict: "player_angle_signed_off",
});
assert.equal(inferredCustomVisual.passed, true, inferredCustomVisual.errors.join("; "));
assert.equal(inferredCustomVisual.counts.spaces_required, 1, "custom no-plan report does not fall back to default Prop Hunt spaces");

const badVisual = validatePlayableSpaceReview({
  project: "prophunt",
  spaces_reviewed: ["lobby"],
  screenshots: [{ capture_id: "only_lobby_entry", space_id: "lobby", kind: "entry" }],
  findings: [{ id: "cab-dark-blocker", space_id: "cozy_cabin", severity: "blocker", status: "open", description: "Cabin entry blocked by dark object" }],
  verdict: "signed_off",
}, visualPlan);
assert.equal(badVisual.passed, false, "incomplete visual review fails");
assert.ok(badVisual.errors.some((error) => error.includes("missing player-height quadrant")), "missing quadrant screenshot rejected");
assert.ok(badVisual.errors.some((error) => error.includes("unresolved blocker")), "unresolved blocker rejected");

// ---- world asset-family sweep plan + validation ----
const familySweepPlan = buildWorldAssetFamilySweepPlan({
  project: "eggbreakers",
  targetPlace: "eggBreakers3.rbxl",
  families: [
    { family_id: "fern_food_and_ground_cover", source_asset_id: 7979002756, live_instance_count: 12 },
  ],
});
assert.equal(familySweepPlan.schema, "roblox-world-asset-family-sweep-plan/v1", "family sweep schema recorded");
assert.equal(familySweepPlan.capture_batch.serial, true, "family sweep captures are serial");
assert.ok(familySweepPlan.capture_batch.captures.some((capture) => capture.kind === "live_player_height_after"), "family sweep requires live player-height proof");
const familyScreenshots = familySweepPlan.capture_batch.captures.map((capture) => ({
  capture_id: capture.capture_id,
  family_id: capture.family_id,
  kind: capture.kind,
  phase: capture.phase,
  image_path: capture.expected_image_path,
  passed: true,
}));
const familySweepReport = {
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
      forward: "Z- toward player path",
      scale_policy: "preserve source scale",
      grounding_offset_studs: 0,
      pivot_policy: "PrimaryPart at visual base",
    },
    propagation: { live_instances_total: 12, fixed_live_instances: 12, skipped_non_visual_instances: 0 },
    cleanup: { clean_clone_removed: true, temporary_models_remaining: 0 },
    screenshots: familyScreenshots,
    findings: [],
    blockers: [],
    inspection_recorded: true,
  }],
  temporary_cleanup: { probes_remaining: 0 },
  verdict: "signed_off",
};
const familySweepValidation = validateWorldAssetFamilySweep(familySweepReport, familySweepPlan);
assert.equal(familySweepValidation.passed, true, familySweepValidation.errors.join("; "));
const badFamilySweep = validateWorldAssetFamilySweep({
  ...familySweepReport,
  family_reports: [{
    ...familySweepReport.family_reports[0],
    propagation: { live_instances_total: 12, fixed_live_instances: 1, skipped_non_visual_instances: 0 },
    cleanup: { clean_clone_removed: false, temporary_models_remaining: 1 },
    screenshots: familyScreenshots.filter((screenshot) => screenshot.kind !== "live_player_height_after"),
    inspection_recorded: false,
  }],
}, familySweepPlan);
assert.equal(badFamilySweep.passed, false, "temp-only family sweep fails");
assert.ok(badFamilySweep.errors.some((error) => error.includes("live_player_height_after")), "family sweep rejects missing live screenshot");

// ---- Studio batch visual gate planning + collated report validation ----
const batchGate = buildBatchVisualGatePlan({
  project: "groan-tube-hero",
  targetPlace: "GroanTubeHero.rbxl",
  reviewMode: "player_angle",
  includeDefaults: false,
  spaces: [{
    id: "stage_circle",
    name: "Stage Circle",
    center: { x: 0, y: 6, z: 0 },
    size: { x: 80, y: 24, z: 80 },
    quadrants: ["front", "left"],
  }],
});
assert.equal(batchGate.schema, "roblox-studio-batch-visual-gate/v1", "batch visual gate schema recorded");
assert.equal(batchGate.capture_batch.serial, true, "batch captures are serial");
assert.ok(batchGate.studio_preflight.code.includes("placeName"), "batch preflight checks active place");
assert.ok(batchGate.capture_batch.captures.every((shot) => shot.studio_mcp_steps.length === 2), "each batch capture sets camera then screenshots");
assert.ok(batchGate.capture_batch.captures.every((shot) => shot.expected_image_path.endsWith(".png")), "batch captures declare image paths");

const batchReport = {
  ...batchGate.report_template,
  preflight: {
    passed: true,
    placeName: "GroanTubeHero.rbxl",
    placeId: 123,
  },
  screenshots: batchGate.capture_batch.captures.map((shot) => ({
    ...shot.result_contract,
    passed: true,
    alt_text: `${shot.capture_id} shows the planned view`,
  })),
  verdict: "player_angle_signed_off",
};
const batchValidation = validateBatchVisualGateReport(batchReport, batchGate);
assert.equal(batchValidation.passed, true, batchValidation.errors.join("; "));
assert.equal(batchValidation.counts.planned_captures, 2, "batch validation counts planned captures");

const badBatchValidation = validateBatchVisualGateReport({
  ...batchReport,
  preflight: { passed: false },
}, batchGate);
assert.equal(badBatchValidation.passed, false, "failed active-place preflight blocks batch signoff");
assert.ok(badBatchValidation.errors.some((error) => error.includes("preflight")), "preflight error is explicit");

// ---- full AI game-dev loop plan + validation ----
const loopPlan = buildAiGameDevLoopPlan({
  project: "groan-tube-hero",
  game: "concert defense rhythm arena",
  targetPlace: "GroanTubeHero.rbxl",
  themes: ["volcano concert arena"],
  assemblyProfile: "concert_defense",
  reviewMode: "player_angle",
  includeDefaultSpaces: false,
  spaces: [{ id: "stage_circle", quadrants: ["front", "left"] }],
  maxFragments: 2,
});
assert.equal(loopPlan.schema, "roblox-ai-game-dev-loop/v1", "e2e loop plan schema");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_headless_assembly"), "e2e loop includes headless MCP support");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_asset_acquisition"), "e2e loop includes asset acquisition MCP support");
assert.ok(loopPlan.custom_mcp.supporting_tools.includes("plan_batch_visual_gate"), "e2e loop includes gated Studio MCP support");
assert.ok(loopPlan.phases.some((phase) => phase.id === "parser_writer_generation"), "e2e loop includes parser/writer phase");
assert.ok(loopPlan.phases.some((phase) => phase.id === "gated_studio_batch"), "e2e loop includes gated Studio phase");
assert.ok(loopPlan.studio_adapter.cli.includes("run-studio-batch-visual-gate"), "e2e loop includes executable Studio adapter CLI");
assert.ok(loopPlan.phases.find((phase) => phase.id === "gamekit_source").modules.includes("RemoteBridge"), "e2e loop starts from GameKit modules");

const loopBatchPlan = loopPlan.batch_visual_gate_plan;
const loopBatchReport = {
  ...loopBatchPlan.report_template,
  preflight: { passed: true, placeName: "GroanTubeHero.rbxl", placeId: 123 },
  screenshots: loopBatchPlan.capture_batch.captures.map((shot) => ({
    ...shot.result_contract,
    passed: true,
    alt_text: `${shot.capture_id} proves the planned player view`,
  })),
  verdict: "player_angle_signed_off",
};
const loopReport = {
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
};
const loopValidation = validateAiGameDevLoopReport(loopReport, loopPlan);
assert.equal(loopValidation.passed, true, loopValidation.errors.join("; "));
const badLoopValidation = validateAiGameDevLoopReport({
  ...loopReport,
  gates: {
    ...loopReport.gates,
    custom_mcp_contract: { passed: true, tools: ["plan_ai_game_dev_loop"] },
  },
}, loopPlan);
assert.equal(badLoopValidation.passed, false, "custom MCP proof must include loop, acquisition, delivery, and visual-gate tools");
assert.ok(badLoopValidation.errors.some((error) => error.includes("validate_ai_game_dev_loop")), "missing e2e validator is explicit");

// ---- shared-brain: rejections + claims + annotation ----
const dir = path.join(os.tmpdir(), "brain-offline-" + Date.now());
process.env.ASSET_BRAIN_DIR = dir;
const store = new Store();
await store.ready();

await store.addReview(111, { verdict: "reject", notes: "oversized" });
assert.ok(store.isRejected(111), "reject recorded");
assert.ok(store.rejectedIdSet().has(111), "rejected set includes 111");
assert.ok(!store.isRejected(222), "222 not rejected");

const r1 = await store.claimAssets("game", "barrel", [222, 333], "agentA");
assert.deepEqual(r1.claimed.sort(), [222,333], "agentA claims 222,333");
const r2 = await store.claimAssets("game", "crate", [333, 444], "agentB");
assert.deepEqual(r2.claimed, [444], "agentB only gets 444 (333 taken)");
assert.equal(r2.skipped[0].id, 333, "333 skipped as claimed");
assert.equal(store.isClaimed(333), "barrel", "333 claimed by barrel slot");
assert.ok(store.claimedIdSet().has(222) && store.claimedIdSet().has(444), "claimed set");

const ann = store.annotate(111);
assert.equal(ann.rejected, true, "annotate shows rejected");
assert.equal(store.annotate(222).claimedBy, "barrel", "annotate shows claimer");

// commit implies claim
await store.commitPalette("game", "well", 555, "Stone Well");
assert.equal(store.isClaimed(555), "well", "commit auto-claims");
assert.equal(store.getPalette("game").well.assetId, 555, "palette stored");

// Studio inspection facts persist separately from reviews and are used by gates.
await store.recordInspection(555, {
  slot: "well",
  sizeStuds: { x: 10, y: 8, z: 10 },
  hasScripts: false,
  scriptCount: 0,
  basePartCount: 4,
  anchoredCapable: true,
  primaryPart: true,
  issues: [],
  visualRisks: ["needs player-angle recapture after scale fix"],
  visualRiskScore: 4,
  screenshotVerdict: "fix",
  source: "offline",
});
assert.equal(store.getInspection(555).sizeStuds.x, 10, "inspection stored");
assert.equal(store.getInspection(555).screenshotVerdict, "fix", "visual inspection verdict stored");
assert.equal(store.getInspection(555).visualRiskScore, 4, "visual risk score stored");
await store.recordInspection(556, {
  slot: "batch-a",
  sizeStuds: { x: 2, y: 2, z: 2 },
  hasScripts: false,
  scriptCount: 0,
  basePartCount: 1,
  anchoredCapable: true,
  primaryPart: true,
  source: "offline-batch-shape",
});
assert.equal(store.getInspection(556).primaryPart, true, "second inspection stored");

// publish permissions: strict release palettes require explicit target access proof.
await store.recordPublishPermission(555, {
  access: "grantable",
  grantableByUs: true,
  experienceHasAccess: true,
  publishPolicy: "allow",
  studioInsertProbe: "pass",
  saveReopenProbe: "pass",
  dependencies: [
    { assetId: 55501, type: "Mesh", access: "open_use", experienceHasAccess: true, status: "pass" },
  ],
  evidence: ["offline-dashboard-export", "offline-studio-probe"],
  source: "offline",
});
assert.equal(store.evaluatePublishPermission(555, { mode: "grantable_only", requireStudioProbe: true, requireSaveReopen: true }).passed, true, "grantable asset passes strict publish gate");

await store.recordPublishPermission(556, {
  access: "open_use",
  grantableByUs: false,
  experienceHasAccess: true,
  publishPolicy: "allow_external_open_use",
  studioInsertProbe: "pass",
  dependencies: [],
  source: "offline",
});
assert.equal(store.evaluatePublishPermission(556, { mode: "grantable_or_open_use", requireStudioProbe: true }).passed, true, "open-use asset can pass dependency mode");
assert.equal(store.evaluatePublishPermission(556, { mode: "grantable_only" }).passed, false, "open-use asset fails grantable-only mode");
assert.equal(store.evaluatePublishPermission(557).passed, false, "missing permission record fails publish gate");

// persistence: a fresh Store sees the same state
const store2 = new Store();
await store2.ready();
assert.ok(store2.isRejected(111) && store2.isClaimed(333) === "barrel", "state persisted across instances");
assert.equal(store2.getInspection(555).basePartCount, 4, "inspection persisted");
assert.equal(store2.getPublishPermission(555).access, "grantable", "publish permission persisted");

const publishGate = store.validatePalettePublishPermissions("game", { mode: "grantable_only", requireStudioProbe: true, requireSaveReopen: true });
assert.equal(publishGate.passed, true, publishGate.errors.join("; "));

await store.commitPalette("permission-fail", "bad.unknown", 557, "Unknown Permission Asset");
const failedPublishGate = store.validatePalettePublishPermissions("permission-fail", { mode: "grantable_only" });
assert.equal(failedPublishGate.passed, false, "missing publish proof fails palette permission gate");
assert.ok(failedPublishGate.errors.some((error) => error.includes("missing publish permission record")), "publish gate explains missing permission proof");

// ---- Prop Hunt asset gate: palette + StudioMCP inspection facts ----
const areas = ["medieval_market", "sci_fi_lab", "cozy_cabin"];
let nextAsset = 1000;
for (let i = 0; i < 20; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.hideable.prop_${i + 1}`;
  await store.commitPalette("prophunt", slot, assetId, `Prop ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 2 + (i % 3), y: 3, z: 2 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 1,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "offline",
  });
}
for (let i = 0; i < 4; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.setpiece.anchor_${i + 1}`;
  await store.commitPalette("prophunt", slot, assetId, `Set Piece ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 16, y: 10, z: 12 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 3,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "offline",
  });
}

const gate = validatePropHuntGate({
  project: "prophunt",
  palette: store.getPalette("prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
});
assert.equal(gate.passed, true, formatPropHuntGateReport(gate));
assert.deepEqual(gate.counts, { palette_assets: 24, areas: 3, hideable_total: 20, setpiece_total: 4 }, "default Prop Hunt counts");

const badId = nextAsset++;
await store.commitPalette("bad-prophunt", "medieval_market.hideable.bad_barrel", badId, "Bad Barrel");
await store.recordInspection(badId, {
  slot: "medieval_market.hideable.bad_barrel",
  sizeStuds: { x: 12, y: 2, z: 2 },
  hasScripts: true,
  scriptCount: 1,
  basePartCount: 1,
  anchoredCapable: true,
  primaryPart: true,
});
const badGate = validatePropHuntGate({
  project: "bad-prophunt",
  palette: store.getPalette("bad-prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
  options: { min_areas: 1, min_hideable_total: 1, min_setpiece_total: 0 },
});
assert.equal(badGate.passed, false, "bad gate fails");
assert.ok(badGate.errors.some((e) => e.includes("outside 1-8 studs")), "oversized hideable rejected");
assert.ok(badGate.errors.some((e) => e.includes("has scripts")), "scripted hideable rejected");

await store.commitPalette("unclassified-prophunt", "medieval_market.ambience.song", nextAsset++, "Song");
const unclassifiedGate = validatePropHuntGate({
  project: "unclassified-prophunt",
  palette: store.getPalette("unclassified-prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
  options: { min_areas: 1, min_hideable_total: 0, min_setpiece_total: 0, require_inspections: false },
});
assert.equal(unclassifiedGate.counts.areas, 0, "unclassified slots do not satisfy area count");
assert.equal(unclassifiedGate.passed, false, "unclassified-only palette fails area gate");

await fs.rm(dir, { recursive: true, force: true });
console.log("OFFLINE OK — parsing, ranking, curation, game/headless/visual coverage, off-theme filter, rejections, claims, inspections, publish permissions, Prop Hunt gate, persistence");
