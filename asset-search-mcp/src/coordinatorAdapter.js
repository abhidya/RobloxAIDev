import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const COORDINATOR_ADAPTERS = new Set(["lune", "rbx_dom"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAdapter(value) {
  const normalized = String(value || "lune").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return COORDINATOR_ADAPTERS.has(normalized) ? normalized : "lune";
}

function mergeFlags({ replaceExisting, createMissingTargets }) {
  return [
    replaceExisting ? "--replace-existing" : null,
    createMissingTargets ? "--create-missing-targets" : null,
  ].filter(Boolean);
}

function luneCommand({ place, out, fragments, replaceExisting, createMissingTargets, luneCommand }) {
  return {
    command: luneCommand || "lune",
    args: [
      "run",
      "scripts/headless_fragment_merge.luau",
      "--place",
      place,
      "--out",
      out,
      ...fragments.flatMap((fragment) => ["--fragment", fragment]),
      ...mergeFlags({ replaceExisting, createMissingTargets }),
      "--json",
    ],
  };
}

function rbxDomCommand({ place, out, fragments, replaceExisting, createMissingTargets, reportPath, rbxDomCommand, rbxDomArgs }) {
  return {
    command: rbxDomCommand || "rbx-dom-coordinator",
    args: [
      ...asArray(rbxDomArgs),
      "merge-fragments",
      "--place",
      place,
      "--out",
      out,
      ...fragments.flatMap((fragment) => ["--fragment", fragment]),
      ...mergeFlags({ replaceExisting, createMissingTargets }),
      "--report",
      reportPath,
    ],
  };
}

export function buildCoordinatorMergePlan({
  adapter = "lune",
  place = "work/headless-poc/Place1.headless-working.rbxl",
  out = "work/headless-poc/Place1.headless-merged.rbxl",
  fragments = ["work/headless-poc/generated-headless-marker.manifest.json"],
  replaceExisting = false,
  createMissingTargets = false,
  reportPath,
  luneCommand: luneCommandName,
  rbxDomCommand: rbxDomCommandName,
  rbxDomArgs = [],
} = {}) {
  const normalizedAdapter = normalizeAdapter(adapter);
  const fragmentList = asArray(fragments).map(String).filter(Boolean);
  const outputReportPath = reportPath || `${out}.coordinator-report.json`;
  const command = normalizedAdapter === "rbx_dom"
    ? rbxDomCommand({
      place,
      out,
      fragments: fragmentList,
      replaceExisting,
      createMissingTargets,
      reportPath: outputReportPath,
      rbxDomCommand: rbxDomCommandName,
      rbxDomArgs,
    })
    : luneCommand({
      place,
      out,
      fragments: fragmentList,
      replaceExisting,
      createMissingTargets,
      luneCommand: luneCommandName,
    });

  return {
    schema: "roblox-headless-coordinator-merge-plan/v1",
    adapter: normalizedAdapter,
    purpose: "Merge validated Roblox model fragments into a copied place through a replaceable coordinator adapter.",
    inputs: {
      place,
      fragments: fragmentList,
      replace_existing: !!replaceExisting,
      create_missing_targets: !!createMissingTargets,
    },
    outputs: {
      place_path: out,
      report_path: outputReportPath,
    },
    identity_policy: {
      referents: "coordinator_remap",
      unique_ids: "strip_or_coordinator_generate",
      history_ids: "strip_or_coordinator_generate",
      parent_links: "coordinator_assigns_after_import",
    },
    adapters: {
      lune: {
        status: "implemented",
        command: "lune run scripts/headless_fragment_merge.luau",
        role: "Current proven Luau-native place/model read-mutate-write path.",
      },
      rbx_dom: {
        status: "external_command_adapter",
        command_env: "RBX_DOM_COORDINATOR_CMD",
        role: "Production Rust/rbx-dom merge engine seam with the same report contract.",
      },
    },
    command,
    validation_contract: {
      schema: "roblox-headless-coordinator-report/v1",
      required: ["passed", "adapter", "output.place_path", "output.reload_validated", "fragments"],
    },
  };
}

function tail(text, max = 4000) {
  const value = String(text || "");
  return value.length <= max ? value : value.slice(value.length - max);
}

function firstJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exit_code: error.code === "ENOENT" ? 127 : 1,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exit_code: exitCode, signal, stdout, stderr });
    });
  });
}

function reportFromProcess(plan, processResult) {
  const parsed = firstJsonObject(processResult.stdout) || {};
  const passed = processResult.exit_code === 0;
  const fragments = Array.isArray(parsed.fragments) ? parsed.fragments : plan.inputs.fragments.map((fragment) => ({
    manifest_path: fragment,
  }));
  return {
    schema: "roblox-headless-coordinator-report/v1",
    adapter: parsed.adapter || plan.adapter,
    passed,
    status: passed ? "passed" : "failed",
    input: {
      place: parsed.input_place || plan.inputs.place,
      fragments: plan.inputs.fragments,
    },
    output: {
      place_path: parsed.output_place || parsed.output?.place_path || plan.outputs.place_path,
      report_path: plan.outputs.report_path,
      reload_validated: parsed.reload_validated === true || (plan.adapter === "lune" && passed),
    },
    identity_policy: plan.identity_policy,
    fragments,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    process: {
      command: plan.command.command,
      args: plan.command.args,
      exit_code: processResult.exit_code,
      signal: processResult.signal,
      stdout_tail: tail(processResult.stdout),
      stderr_tail: tail(processResult.stderr),
      error: processResult.error || null,
    },
    blockers: passed ? [] : [processResult.error || `coordinator exited with ${processResult.exit_code}`],
  };
}

export async function executeCoordinatorMergePlan(plan, options = {}) {
  const mergePlan = asObject(plan);
  const command = asObject(mergePlan.command);
  const processResult = await runCommand(command.command, asArray(command.args), options);
  const report = reportFromProcess(mergePlan, processResult);
  if (mergePlan.outputs?.report_path) {
    await mkdir(path.dirname(mergePlan.outputs.report_path), { recursive: true });
    await writeFile(mergePlan.outputs.report_path, `${JSON.stringify(report, null, 2)}\n`);
  }
  const validation = validateCoordinatorMergeReport(report, mergePlan);
  return {
    schema: "roblox-headless-coordinator-run/v1",
    plan: mergePlan,
    report,
    validation,
  };
}

export function validateCoordinatorMergeReport(report, plan = null) {
  const errors = [];
  const warnings = [];
  const raw = asObject(report);
  const expected = asObject(plan);
  const adapter = String(raw.adapter || expected.adapter || "lune").trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (raw.schema !== "roblox-headless-coordinator-report/v1") {
    errors.push("report schema must be roblox-headless-coordinator-report/v1");
  }
  if (!COORDINATOR_ADAPTERS.has(adapter)) errors.push(`unsupported coordinator adapter '${raw.adapter}'`);
  if (raw.passed !== true || raw.status !== "passed") errors.push("coordinator report must have passed=true and status='passed'");
  if (raw.process && raw.process.exit_code !== 0) errors.push(`coordinator process exit_code must be 0, got ${raw.process.exit_code}`);
  if (!raw.output?.place_path) errors.push("output.place_path is required");
  if (/asset-brain[\\/]/i.test(String(raw.output?.place_path || ""))) {
    errors.push("coordinator output place must not be written under asset-brain");
  }
  if (raw.output?.reload_validated !== true) errors.push("output.reload_validated must be true");
  const fragments = asArray(raw.fragments);
  const expectedFragments = asArray(expected.inputs?.fragments);
  if (!fragments.length) errors.push("fragments array is required and must not be empty");
  if (expectedFragments.length && fragments.length !== expectedFragments.length) {
    errors.push(`fragment count ${fragments.length} does not match planned ${expectedFragments.length}`);
  }
  const policy = asObject(raw.identity_policy);
  if (policy.referents !== "coordinator_remap") errors.push("identity_policy.referents must be coordinator_remap");
  if (!String(policy.unique_ids || "").includes("coordinator") && !String(policy.unique_ids || "").includes("strip")) {
    warnings.push("identity_policy.unique_ids should mention strip or coordinator generation");
  }
  const blockers = asArray(raw.blockers);
  if (blockers.length) errors.push(`coordinator blockers remain: ${blockers.join("; ")}`);

  return {
    schema: "roblox-headless-coordinator-validation/v1",
    passed: errors.length === 0,
    adapter,
    errors,
    warnings,
    counts: {
      fragments: fragments.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function formatCoordinatorMergePlan(plan) {
  return [
    `Coordinator merge plan adapter=${plan.adapter}`,
    `place=${plan.inputs.place}`,
    `out=${plan.outputs.place_path}`,
    `fragments=${plan.inputs.fragments.length}`,
    `command=${plan.command.command} ${plan.command.args.join(" ")}`,
    `report=${plan.outputs.report_path}`,
  ].join("\n");
}

export function formatCoordinatorMergeValidation(result) {
  const lines = [
    `${result.passed ? "PASS" : "FAIL"} coordinator merge adapter=${result.adapter}`,
    `fragments=${result.counts.fragments} warnings=${result.counts.warnings} errors=${result.counts.errors}`,
  ];
  if (result.errors.length) lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}
