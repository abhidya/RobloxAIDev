import assert from "node:assert";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoordinatorMergePlan,
  executeCoordinatorMergePlan,
  validateCoordinatorMergeReport,
} from "../src/coordinatorAdapter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coordinator-adapter-"));

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
  const fragment = path.join(tempDir, "room.manifest.json");
  const place = path.join(tempDir, "input.rbxl");
  const out = path.join(tempDir, "out", "candidate.rbxl");
  await fs.writeFile(fragment, "{}\n");
  await fs.writeFile(place, "fake-place");

  const lunePlan = buildCoordinatorMergePlan({
    adapter: "lune",
    place,
    out,
    fragments: [fragment],
    replaceExisting: true,
  });
  assert.equal(lunePlan.schema, "roblox-headless-coordinator-merge-plan/v1");
  assert.equal(lunePlan.adapter, "lune");
  assert.deepEqual(lunePlan.command.args.slice(0, 2), ["run", "scripts/headless_fragment_merge.luau"]);
  assert.ok(lunePlan.command.args.includes("--json"), "Lune adapter requests JSON output");
  assert.equal(lunePlan.identity_policy.referents, "coordinator_remap");

  const rbxPlan = buildCoordinatorMergePlan({
    adapter: "rbx_dom",
    place,
    out,
    fragments: [fragment],
    reportPath: path.join(tempDir, "reports", "coordinator.json"),
    rbxDomCommand: "node",
    rbxDomArgs: [path.join(root, "test", "fake-rbx-dom-coordinator.mjs")],
    replaceExisting: true,
  });
  assert.equal(rbxPlan.adapter, "rbx_dom");
  assert.equal(rbxPlan.command.command, "node");
  assert.ok(rbxPlan.command.args.includes("merge-fragments"), "rbx-dom adapter uses merge-fragments subcommand");

  const run = await executeCoordinatorMergePlan(rbxPlan, { cwd: root });
  assert.equal(run.schema, "roblox-headless-coordinator-run/v1");
  assert.equal(run.validation.passed, true, run.validation.errors.join("; "));
  assert.equal(run.report.output.reload_validated, true);
  assert.equal(await fs.readFile(out, "utf8"), "fake-rbx-dom-place");
  const reportText = await fs.readFile(rbxPlan.outputs.report_path, "utf8");
  assert.ok(reportText.includes("rbx_dom"), "external adapter writes a report artifact");

  const cli = await runNode([
    path.join(root, "scripts", "run-headless-coordinator.mjs"),
    "--adapter",
    "rbx_dom",
    "--place",
    place,
    "--out",
    path.join(tempDir, "out", "cli-candidate.rbxl"),
    "--fragment",
    fragment,
    "--report",
    path.join(tempDir, "reports", "cli-coordinator.json"),
    "--rbx-dom-command",
    "node",
    "--rbx-dom-arg",
    path.join(root, "test", "fake-rbx-dom-coordinator.mjs"),
    "--json",
  ], { cwd: root });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.validation.passed, true, cliResult.validation.errors.join("; "));

  const badValidation = validateCoordinatorMergeReport({
    ...run.report,
    output: { ...run.report.output, reload_validated: false },
  }, rbxPlan);
  assert.equal(badValidation.passed, false, "reload validation is required");
  assert.ok(badValidation.errors.some((error) => error.includes("reload_validated")), "reload error is explicit");

  const badAdapter = validateCoordinatorMergeReport({
    ...run.report,
    adapter: "agent_local_merge",
  }, rbxPlan);
  assert.equal(badAdapter.passed, false, "unsupported adapters are rejected");
  assert.ok(badAdapter.errors.some((error) => error.includes("unsupported coordinator adapter")), "unsupported adapter error is explicit");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("COORDINATOR_ADAPTER_OK lune plan and rbx-dom command adapter contract validated");
