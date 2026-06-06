import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeMockStudioWorldAssetFamilySweep,
  executeStudioMcpWorldAssetFamilySweep,
} from "../src/studioWorldAssetFamilyAdapter.js";
import { buildWorldAssetFamilySweepPlan, validateWorldAssetFamilySweep } from "../src/worldAssetFamilySweep.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-world-family-adapter-"));
const artifactRoot = path.join(tempDir, "family-sweep");

const plan = buildWorldAssetFamilySweepPlan({
  project: "eggbreakers",
  targetPlace: "eggBreakers3.rbxl",
  families: [
    {
      family_id: "fern_food_and_ground_cover",
      source_asset_id: 7979002756,
      slot: "fern_plains.herbivore_food",
      live_instance_count: 12,
      clean_stage_center: { x: 0, y: 4, z: 0 },
      live_view_center: { x: 120, y: 4, z: 15 },
    },
  ],
  artifactRoot,
});

const result = executeMockStudioWorldAssetFamilySweep(plan, {
  activePlaceName: "eggBreakers3.rbxl",
  placeId: 456,
});
assert.equal(result.schema, "roblox-studio-world-family-adapter-result/v1");
assert.equal(result.transport, "mock");
assert.equal(result.validation.passed, true, result.validation.errors.join("; "));
assert.equal(result.report.preflight.passed, true);
assert.equal(result.report.family_reports.length, 1);
assert.equal(result.report.family_reports[0].screenshots.length, plan.capture_batch.captures.length);
assert.ok(result.execution_log.some((step) => step.tool === "screen_capture"), "mock transport records screenshot steps");

const mismatch = executeMockStudioWorldAssetFamilySweep(plan, {
  activePlaceName: "WrongPlace.rbxl",
});
assert.equal(mismatch.validation.passed, false, "active-place mismatch blocks the family sweep report");
assert.ok(mismatch.validation.errors.some((error) => error.includes("preflight")), "mismatch reports preflight failure");

const failedCaptureId = plan.capture_batch.captures[0].capture_id;
const failed = executeMockStudioWorldAssetFamilySweep(plan, {
  activePlaceName: "eggBreakers3.rbxl",
  failCaptures: [failedCaptureId],
});
assert.equal(failed.validation.passed, false, "failed capture blocks family validation");
assert.ok(failed.validation.errors.some((error) => error.includes("propagate")), "failed capture leaves propagation incomplete");

const badFinding = validateWorldAssetFamilySweep({
  ...result.report,
  family_reports: [{
    ...result.report.family_reports[0],
    findings: [{ severity: "major", status: "open", description: "" }],
  }],
}, plan);
assert.equal(badFinding.passed, false, "blank finding blocks family sweep validation");
assert.ok(badFinding.errors.some((error) => error.includes("title/description")), "blank finding error is explicit");

const planPath = path.join(tempDir, "plan.json");
const reportPath = path.join(tempDir, "out", "family-sweep-report.json");
await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
const cli = spawnSync("node", [
  path.join(root, "scripts", "run-studio-world-asset-family-sweep.mjs"),
  "--plan",
  planPath,
  "--out",
  reportPath,
  "--active-place",
  "eggBreakers3.rbxl",
  "--place-id",
  "456",
  "--json",
], { cwd: root, encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const cliResult = JSON.parse(cli.stdout);
assert.equal(cliResult.validation.passed, true, cliResult.validation.errors.join("; "));
assert.equal(cliResult.artifacts.report_path, reportPath);
for (const file of [
  reportPath,
  path.join(tempDir, "out", "family-sweep-manifest.json"),
  path.join(tempDir, "out", "alt-text.json"),
  path.join(tempDir, "out", "execution-log.json"),
]) {
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0, `${file} should be written`);
}

const studioMcpResult = await executeStudioMcpWorldAssetFamilySweep(plan, {
  command: "node",
  args: [path.join(root, "test", "fake-studio-mcp.mjs")],
  studioId: "fake-studio-1",
});
assert.equal(studioMcpResult.schema, "roblox-studio-world-family-adapter-result/v1");
assert.equal(studioMcpResult.transport, "studio_mcp_stdio");
assert.equal(studioMcpResult.validation.passed, true, studioMcpResult.validation.errors.join("; "));
assert.equal(studioMcpResult.report.preflight.passed, true);
assert.equal(studioMcpResult.report.family_reports[0].screenshots.length, plan.capture_batch.captures.length);
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "set_active_studio"), "stdio adapter selects requested Studio instance");
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "execute_luau"), "stdio adapter runs Luau preflight/camera steps");
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "screen_capture"), "stdio adapter calls screen_capture");
for (const shot of studioMcpResult.report.family_reports[0].screenshots) {
  const stat = await fs.stat(shot.image_path);
  assert.ok(stat.size > 0, `${shot.image_path} should be written from MCP image data`);
}

const liveReportPath = path.join(tempDir, "live", "family-sweep-report.json");
const liveCli = spawnSync("node", [
  path.join(root, "scripts", "run-studio-world-asset-family-sweep.mjs"),
  "--plan",
  planPath,
  "--out",
  liveReportPath,
  "--transport",
  "studio_mcp_stdio",
  "--studio-mcp-command",
  "node",
  "--studio-mcp-arg",
  path.join(root, "test", "fake-studio-mcp.mjs"),
  "--studio-id",
  "fake-studio-1",
  "--json",
], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    FAKE_STUDIO_PLACE_NAME: "eggBreakers3.rbxl",
    FAKE_STUDIO_PLACE_ID: "456",
  },
});
assert.equal(liveCli.status, 0, liveCli.stderr || liveCli.stdout);
const liveResult = JSON.parse(liveCli.stdout);
assert.equal(liveResult.transport, "studio_mcp_stdio");
assert.equal(liveResult.validation.passed, true, liveResult.validation.errors.join("; "));
assert.ok(liveResult.execution_log.some((step) => step.tool === "set_active_studio"), "stdio transport selects requested Studio instance");
assert.ok(liveResult.execution_log.some((step) => step.tool === "screen_capture"), "stdio transport calls screen_capture");
for (const shot of liveResult.report.family_reports[0].screenshots) {
  const stat = await fs.stat(shot.image_path);
  assert.ok(stat.size > 0, `${shot.image_path} should be written from MCP image data`);
}

await fs.rm(tempDir, { recursive: true, force: true });
console.log("STUDIO_WORLD_FAMILY_ADAPTER_OK mock and stdio MCP transports emitted validated family proof bundles");
