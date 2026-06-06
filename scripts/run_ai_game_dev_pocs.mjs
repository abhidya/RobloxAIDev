#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, "docs", "poc-results", "ai-game-dev-poc-latest.json");
const scratchDir = path.join(repoRoot, "work", "headless-poc");
const sourcePlace = path.join(repoRoot, "Place1.rbxl");
const workingPlace = path.join(scratchDir, "Place1.headless-working.rbxl");

function tail(text, max = 4000) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(text.length - max);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(id, command, args, options = {}) {
  const startedAt = new Date();
  const started = Date.now();
  const result = {
    id,
    command,
    args,
    cwd: options.cwd || repoRoot,
    required: options.required !== false,
    status: "running",
    started_at: startedAt.toISOString(),
  };

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: result.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      result.status = error.code === "ENOENT" ? "missing_command" : "error";
      result.error = error.message;
      result.duration_ms = Date.now() - started;
      result.stdout_tail = tail(stdout);
      result.stderr_tail = tail(stderr);
      resolve(result);
    });
    child.on("close", (code, signal) => {
      result.status = code === 0 ? "passed" : "failed";
      result.exit_code = code;
      result.signal = signal;
      result.duration_ms = Date.now() - started;
      result.stdout_tail = tail(stdout);
      result.stderr_tail = tail(stderr);
      resolve(result);
    });
  });
}

function skipped(id, reason, options = {}) {
  return {
    id,
    command: null,
    args: [],
    cwd: repoRoot,
    required: options.required !== false,
    status: "skipped",
    reason,
    started_at: new Date().toISOString(),
    duration_ms: 0,
    stdout_tail: "",
    stderr_tail: "",
  };
}

async function main() {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(scratchDir, { recursive: true });

  const commands = [];
  const add = async (id, command, args, options) => {
    console.log(`\n[POC] ${id}: ${command} ${args.join(" ")}`);
    const result = await runCommand(id, command, args, options);
    commands.push(result);
    return result;
  };

  await add("asset_brain_merge", "node", ["scripts/merge_asset_brain_sources.mjs"]);
  await add("asset_brain_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:asset-brain"]);
  await add("batch_visual_gate_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:offline"]);
  await add("studio_batch_adapter_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:studio-adapter"]);
  await add("fragment_fixture_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:fragment-fixtures"]);
  await add("coordinator_adapter_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:coordinator-adapter"]);
  await add("asset_delivery_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:asset-delivery"]);
  await add("asset_acquisition_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:asset-acquisition"]);
  await add("prompt_doc_contract", "npm", ["--prefix", "asset-search-mcp", "run", "test:prompt-contracts"]);

  const luneVersion = await runCommand("lune_version", "lune", ["--version"], { required: false });
  commands.push(luneVersion);
  const canRunHeadless = luneVersion.status === "passed" && await exists(sourcePlace);

  if (canRunHeadless) {
    await fs.copyFile(sourcePlace, workingPlace);
    await add("headless_place_insert", "lune", ["run", "scripts/headless_place_insert_poc.luau"]);
    await add("headless_place_verify", "lune", [
      "run",
      "scripts/headless_place_verify_poc.luau",
      "work/headless-poc/Place1.headless-mutated.rbxl",
    ]);
    await add("headless_fragment_merge", "node", [
      "asset-search-mcp/scripts/run-headless-coordinator.mjs",
      "--adapter",
      "lune",
      "--place",
      "work/headless-poc/Place1.headless-working.rbxl",
      "--out",
      "work/headless-poc/Place1.headless-merged.rbxl",
      "--fragment",
      "work/headless-poc/generated-headless-marker.manifest.json",
      "--replace-existing",
      "--json",
    ]);
    await add("headless_fragment_verify", "lune", [
      "run",
      "scripts/headless_place_verify_poc.luau",
      "work/headless-poc/Place1.headless-merged.rbxl",
    ]);
  } else if (luneVersion.status !== "passed") {
    commands.push(skipped("headless_generation", "lune command is not available", { required: false }));
  } else {
    commands.push(skipped("headless_generation", "Place1.rbxl fixture is missing", { required: false }));
  }

  const requiredFailures = commands.filter((entry) => entry.required && entry.status !== "passed");
  const report = {
    schema: "roblox-ai-game-dev-poc-report/v1",
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    scratch_dir: "work/headless-poc",
    scratch_policy: "ignored Roblox binaries and screenshots stay outside source control",
    verdict: requiredFailures.length === 0 ? "passed" : "failed",
    commands,
    assertions: {
      asset_brain_merge: commands.some((entry) => entry.id === "asset_brain_merge" && entry.status === "passed"),
      asset_brain_contract: commands.some((entry) => entry.id === "asset_brain_contract" && entry.status === "passed"),
      batch_visual_gate_contract: commands.some((entry) => entry.id === "batch_visual_gate_contract" && entry.status === "passed"),
      studio_batch_adapter_contract: commands.some((entry) => entry.id === "studio_batch_adapter_contract" && entry.status === "passed"),
      fragment_fixture_contract: commands.some((entry) => entry.id === "fragment_fixture_contract" && entry.status === "passed"),
      coordinator_adapter_contract: commands.some((entry) => entry.id === "coordinator_adapter_contract" && entry.status === "passed"),
      asset_delivery_contract: commands.some((entry) => entry.id === "asset_delivery_contract" && entry.status === "passed"),
      asset_acquisition_contract: commands.some((entry) => entry.id === "asset_acquisition_contract" && entry.status === "passed"),
      prompt_doc_contract: commands.some((entry) => entry.id === "prompt_doc_contract" && entry.status === "passed"),
      headless_generation:
        commands.some((entry) => entry.id === "headless_fragment_verify" && entry.status === "passed")
        || commands.some((entry) => entry.id === "headless_generation" && entry.status === "skipped"),
    },
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nPOC_REPORT ${path.relative(repoRoot, reportPath)} verdict=${report.verdict}`);

  if (requiredFailures.length > 0) {
    console.error(`POC_FAILURES ${requiredFailures.map((entry) => entry.id).join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
