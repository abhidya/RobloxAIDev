import assert from "node:assert";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProjectTemplatePlan,
  materializeProjectTemplate,
  publicProjectTemplatePlan,
  validateProjectTemplateReport,
} from "../src/projectTemplate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-template-"));

async function runNode(args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn("node", args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

try {
  const outputRoot = path.join(tempDir, "dino-dash");
  const plan = buildProjectTemplatePlan({
    project: "Dino Dash",
    game: "Dino Dash",
    targetPlace: "DinoDash.rbxl",
    themes: ["nursery grove", "fossil cave"],
    outputRoot,
  });
  assert.equal(plan.schema, "roblox-ai-game-project-template-plan/v1");
  assert.equal(plan.project, "dino-dash");
  assert.ok(plan.files.some((file) => file.path === "asset-brain/v1/manifest.json"), "plan includes asset brain manifest");
  assert.ok(plan.gates.includes("plan_asset_delivery"), "plan includes asset delivery gate");
  assert.ok(plan.gates.includes("plan_coordinator_merge"), "plan includes coordinator gate");
  assert.ok(plan.gates.includes("validate_project_template"), "plan includes template self-validation gate");
  assert.ok(plan.gates.includes("plan_batch_visual_gate"), "plan includes Studio visual gate");

  const publicPlan = publicProjectTemplatePlan(plan);
  assert.equal(publicPlan._contents, undefined, "public plan hides file contents");
  const report = await materializeProjectTemplate(plan);
  const validation = await validateProjectTemplateReport(report, plan);
  assert.equal(validation.passed, true, validation.errors.join("; "));
  const noPlanValidation = await validateProjectTemplateReport(report);
  assert.equal(noPlanValidation.passed, true, noPlanValidation.errors.join("; "));
  const readme = await fs.readFile(path.join(outputRoot, "README.md"), "utf8");
  assert.ok(readme.includes("run-headless-coordinator"), "README prewires coordinator command");
  const brain = JSON.parse(await fs.readFile(path.join(outputRoot, "asset-brain/v1/manifest.json"), "utf8"));
  assert.equal(brain.policy.metadataOnly, true, "asset brain starts metadata-only");
  const gitignore = await fs.readFile(path.join(outputRoot, ".gitignore"), "utf8");
  assert.ok(gitignore.includes("*.rbxl"), "gitignore blocks Roblox binaries");
  await fs.stat(path.join(outputRoot, "src/server/init.server.luau"));
  await fs.stat(path.join(outputRoot, "src/client/init.client.luau"));

  const badReport = {
    ...report,
    written: report.written.filter((file) => file.path !== "README.md"),
  };
  const badValidation = await validateProjectTemplateReport(badReport, plan);
  assert.equal(badValidation.passed, false, "missing planned files fail validation");
  assert.ok(badValidation.errors.some((error) => error.includes("README.md")), "missing README error is explicit");

  const cliRoot = path.join(tempDir, "cli-game");
  const cli = await runNode([
    path.join(root, "scripts", "generate-project-template.mjs"),
    "--project",
    "CLI Game",
    "--game",
    "CLI Game",
    "--target-place",
    "CliGame.rbxl",
    "--theme",
    "sky lobby",
    "--out-root",
    cliRoot,
    "--json",
  ], { cwd: root });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.schema, "roblox-ai-game-project-template-run/v1");
  assert.equal(cliResult.validation.passed, true, cliResult.validation.errors.join("; "));
  assert.ok((await fs.readFile(path.join(cliRoot, "docs/e2e-loop.md"), "utf8")).includes("validate_ai_game_dev_loop"));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("PROJECT_TEMPLATE_OK plan, materialize, validate, and CLI generated a gated Roblox AI game skeleton");
