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
  "plan_game_asset_coverage",
  "preprocess_storyboard_asset_cache",
  "export_asset_brain_snapshot",
  "plan_headless_assembly",
  "validate_fragment_manifest",
  "plan_playable_space_review",
  "validate_playable_space_review",
  "record_inspection",
  "record_inspections",
  "get_inspection",
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

console.log("\n--- curate_assets ---");
console.log(
  (await call("curate_assets", {
    slots: [{ slot: "barrel", query: "medieval barrel" }],
    per_slot: 2,
  })).slice(0, 500)
);

console.log("\n--- review_asset + palette ---");
console.log(await call("review_asset", { asset_id: 12345, verdict: "keep", notes: "smoke test", slot: "barrel" }));
console.log(await call("commit_palette", { project: "prophunt-smoke", slot: "medieval_market.hideable.barrel", asset_id: 12345, name: "Barrel" }));
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
console.log(await call("commit_palette", { project: "prophunt-smoke", slot: "medieval_market.setpiece.market_stall", asset_id: 23456, name: "Market Stall" }));
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
console.log(JSON.stringify({
  assets: snapshot.counts.assets,
  paletteAssets: snapshot.counts.paletteAssets,
  pages: snapshot.pagesLayout.manifest,
}, null, 2));

await client.close();
await fs.rm(brainDir, { recursive: true, force: true });
console.log("\nSMOKE OK");
process.exit(0);
