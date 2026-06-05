import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeMockStudioBatchVisualGate,
  executeStudioMcpBatchVisualGate,
} from "../src/studioBatchAdapter.js";
import { buildBatchVisualGatePlan, validateBatchVisualGateReport } from "../src/visualBatchGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-batch-adapter-"));
const artifactRoot = path.join(tempDir, "visual-gate");

const plan = buildBatchVisualGatePlan({
  project: "groan-tube-hero",
  targetPlace: "GroanTubeHero.rbxl",
  reviewMode: "player_angle",
  includeDefaults: false,
  spaces: [{ id: "stage_circle", quadrants: ["front", "left"] }],
  artifactRoot,
});

const result = executeMockStudioBatchVisualGate(plan, {
  activePlaceName: "GroanTubeHero.rbxl",
  placeId: 123,
});
assert.equal(result.schema, "roblox-studio-batch-adapter-result/v1");
assert.equal(result.transport, "mock");
assert.equal(result.validation.passed, true, result.validation.errors.join("; "));
assert.equal(result.report.preflight.passed, true);
assert.equal(result.report.screenshots.length, plan.capture_batch.captures.length);
assert.ok(result.execution_log.some((step) => step.tool === "screen_capture"), "mock transport records screenshot steps");

const mismatch = executeMockStudioBatchVisualGate(plan, {
  activePlaceName: "WrongPlace.rbxl",
});
assert.equal(mismatch.validation.passed, false, "active-place mismatch blocks the adapter report");
assert.ok(mismatch.validation.errors.some((error) => error.includes("preflight")), "mismatch reports preflight failure");

const failedScreenshot = {
  ...result.report,
  screenshots: [
    {
      ...result.report.screenshots[0],
      passed: false,
    },
    ...result.report.screenshots.slice(1),
  ],
};
const failedScreenshotValidation = validateBatchVisualGateReport(failedScreenshot, plan);
assert.equal(failedScreenshotValidation.passed, false, "failed screenshot blocks batch validation");
assert.ok(
  failedScreenshotValidation.errors.some((error) => error.includes("did not pass visual review")),
  "failed screenshot error is explicit",
);

const planPath = path.join(tempDir, "plan.json");
const reportPath = path.join(tempDir, "out", "batch-report.json");
await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
const cli = spawnSync("node", [
  path.join(root, "scripts", "run-studio-batch-visual-gate.mjs"),
  "--plan",
  planPath,
  "--out",
  reportPath,
  "--active-place",
  "GroanTubeHero.rbxl",
  "--place-id",
  "123",
  "--json",
], { cwd: root, encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const cliResult = JSON.parse(cli.stdout);
assert.equal(cliResult.validation.passed, true, cliResult.validation.errors.join("; "));
assert.equal(cliResult.artifacts.report_path, reportPath);
for (const file of [
  reportPath,
  path.join(tempDir, "out", "batch-manifest.json"),
  path.join(tempDir, "out", "alt-text.json"),
  path.join(tempDir, "out", "execution-log.json"),
]) {
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0, `${file} should be written`);
}

const studioMcpResult = await executeStudioMcpBatchVisualGate(plan, {
  command: "node",
  args: [path.join(root, "test", "fake-studio-mcp.mjs")],
  studioId: "fake-studio-1",
});
assert.equal(studioMcpResult.schema, "roblox-studio-batch-adapter-result/v1");
assert.equal(studioMcpResult.transport, "studio_mcp_stdio");
assert.equal(studioMcpResult.validation.passed, true, studioMcpResult.validation.errors.join("; "));
assert.equal(studioMcpResult.report.preflight.passed, true);
assert.equal(studioMcpResult.report.screenshots.length, plan.capture_batch.captures.length);
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "set_active_studio"), "stdio adapter selects requested Studio instance");
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "execute_luau"), "stdio adapter runs Luau preflight/camera steps");
assert.ok(studioMcpResult.execution_log.some((step) => step.tool === "screen_capture"), "stdio adapter calls screen_capture");
for (const shot of studioMcpResult.report.screenshots) {
  const stat = await fs.stat(shot.image_path);
  assert.ok(stat.size > 0, `${shot.image_path} should be written from MCP image data`);
}

const liveReportPath = path.join(tempDir, "live", "batch-report.json");
const liveCli = spawnSync("node", [
  path.join(root, "scripts", "run-studio-batch-visual-gate.mjs"),
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
    FAKE_STUDIO_PLACE_NAME: "GroanTubeHero.rbxl",
    FAKE_STUDIO_PLACE_ID: "123",
  },
});
assert.equal(liveCli.status, 0, liveCli.stderr || liveCli.stdout);
const liveResult = JSON.parse(liveCli.stdout);
assert.equal(liveResult.transport, "studio_mcp_stdio");
assert.equal(liveResult.validation.passed, true, liveResult.validation.errors.join("; "));
assert.ok(liveResult.execution_log.some((step) => step.tool === "set_active_studio"), "stdio transport selects requested Studio instance");
assert.ok(liveResult.execution_log.some((step) => step.tool === "screen_capture"), "stdio transport calls screen_capture");
for (const shot of liveResult.report.screenshots) {
  const stat = await fs.stat(shot.image_path);
  assert.ok(stat.size > 0, `${shot.image_path} should be written from MCP image data`);
}

await fs.rm(tempDir, { recursive: true, force: true });
console.log("STUDIO_BATCH_ADAPTER_OK mock and stdio MCP transports emitted validated proof bundles");
