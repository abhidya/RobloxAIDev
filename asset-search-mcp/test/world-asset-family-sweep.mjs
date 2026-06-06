import assert from "node:assert";
import {
  buildWorldAssetFamilySweepPlan,
  validateWorldAssetFamilySweep,
} from "../src/worldAssetFamilySweep.js";

const plan = buildWorldAssetFamilySweepPlan({
  project: "eggbreakers",
  targetPlace: "eggBreakers3.rbxl",
  families: [
    {
      family_id: "fern_food_and_ground_cover",
      source_asset_id: 7979002756,
      slot: "fern_plains.herbivore_food",
      live_instance_count: 12,
      locations: ["Workspace.Map.FernPlains"],
    },
    {
      family_id: "staged_and_imported_dinosaurs",
      source_asset_id: 248223518,
      slot: "npc.predator.dino",
      live_instance_count: 4,
      locations: ["Workspace.NPCs", "Workspace.ImportedAssetLibrary"],
    },
  ],
});

assert.equal(plan.schema, "roblox-world-asset-family-sweep-plan/v1");
assert.equal(plan.families.length, 2);
assert.equal(plan.capture_batch.serial, true, "family sweep captures are serial");
assert.equal(plan.capture_batch.captures.length, 26, "each family gets before/after clean views plus live proof");
assert.ok(plan.capture_batch.captures.some((capture) => capture.kind === "live_player_height_after"), "plan requires in-world player-height proof");

function screenshotsFor(familyId) {
  return plan.capture_batch.captures
    .filter((capture) => capture.family_id === familyId)
    .map((capture) => ({
      capture_id: capture.capture_id,
      family_id: capture.family_id,
      kind: capture.kind,
      phase: capture.phase,
      image_path: capture.expected_image_path,
      passed: true,
    }));
}

function familyReport(familyId, total) {
  return {
    family_id: familyId,
    status: "pass",
    screenshot_verdict: "pass",
    inventory: { live_instance_count: total },
    clean_clone: { created: true, path: `Workspace.AssetValidation/${familyId}` },
    canonical: {
      up: "Y+",
      forward: "Z- toward player path",
      scale_policy: "preserve source scale unless bounds exceed player camera",
      grounding_offset_studs: 0,
      pivot_policy: "PrimaryPart at visual base",
    },
    propagation: {
      live_instances_total: total,
      fixed_live_instances: total,
      skipped_non_visual_instances: 0,
    },
    cleanup: {
      clean_clone_removed: true,
      temporary_models_remaining: 0,
    },
    screenshots: screenshotsFor(familyId),
    findings: [],
    blockers: [],
    inspection_recorded: true,
  };
}

const goodReport = {
  schema: "roblox-world-asset-family-sweep-report/v1",
  project: "eggbreakers",
  target_place: "eggBreakers3.rbxl",
  family_reports: [
    familyReport("fern_food_and_ground_cover", 12),
    familyReport("staged_and_imported_dinosaurs", 4),
  ],
  temporary_cleanup: { probes_remaining: 0 },
  verdict: "signed_off",
};
const validation = validateWorldAssetFamilySweep(goodReport, plan);
assert.equal(validation.passed, true, validation.errors.join("; "));
assert.equal(validation.counts.families_passed, 2);

const tempOnlyReport = {
  ...goodReport,
  family_reports: [{
    ...familyReport("fern_food_and_ground_cover", 12),
    propagation: {
      live_instances_total: 12,
      fixed_live_instances: 1,
      skipped_non_visual_instances: 0,
    },
    cleanup: {
      clean_clone_removed: false,
      temporary_models_remaining: 1,
    },
    screenshots: screenshotsFor("fern_food_and_ground_cover").filter((shot) => shot.kind !== "live_player_height_after"),
  }],
};
const badValidation = validateWorldAssetFamilySweep(tempOnlyReport, {
  ...plan,
  families: [plan.families[0]],
});
assert.equal(badValidation.passed, false, "fixing only the clean clone must fail");
assert.ok(badValidation.errors.some((error) => error.includes("propagate")), "missing propagation is explicit");
assert.ok(badValidation.errors.some((error) => error.includes("clean clone must be removed")), "temp clone cleanup is explicit");
assert.ok(badValidation.errors.some((error) => error.includes("live_player_height_after")), "missing live player-height proof is explicit");

const noPlanValidation = validateWorldAssetFamilySweep({
  ...goodReport,
  family_reports: [familyReport("fern_food_and_ground_cover", 12)],
});
assert.equal(noPlanValidation.passed, true, noPlanValidation.errors.join("; "));

console.log("WORLD_ASSET_FAMILY_SWEEP_OK plan and validator reject temp-only asset fixes");
