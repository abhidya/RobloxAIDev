#!/usr/bin/env node
import {
  buildCoordinatorMergePlan,
  executeCoordinatorMergePlan,
  formatCoordinatorMergePlan,
  formatCoordinatorMergeValidation,
} from "../src/coordinatorAdapter.js";

function parseArgs(argv) {
  const args = {
    adapter: "lune",
    fragments: [],
    rbxDomArgs: [],
    format: "text",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--adapter") {
      if (!next) throw new Error("--adapter requires lune or rbx_dom");
      args.adapter = next;
      i += 1;
    } else if (arg === "--place") {
      if (!next) throw new Error("--place requires a path");
      args.place = next;
      i += 1;
    } else if (arg === "--out") {
      if (!next) throw new Error("--out requires a path");
      args.out = next;
      i += 1;
    } else if (arg === "--fragment") {
      if (!next) throw new Error("--fragment requires a manifest path");
      args.fragments.push(next);
      i += 1;
    } else if (arg === "--report") {
      if (!next) throw new Error("--report requires a path");
      args.reportPath = next;
      i += 1;
    } else if (arg === "--lune-command") {
      if (!next) throw new Error("--lune-command requires a command");
      args.luneCommand = next;
      i += 1;
    } else if (arg === "--rbx-dom-command") {
      if (!next) throw new Error("--rbx-dom-command requires a command");
      args.rbxDomCommand = next;
      i += 1;
    } else if (arg === "--rbx-dom-arg") {
      if (!next) throw new Error("--rbx-dom-arg requires a value");
      args.rbxDomArgs.push(next);
      i += 1;
    } else if (arg === "--replace-existing") {
      args.replaceExisting = true;
    } else if (arg === "--create-missing-targets") {
      args.createMissingTargets = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--json") {
      args.format = "json";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return `Usage:
  node asset-search-mcp/scripts/run-headless-coordinator.mjs --place <input.rbxl> --out <output.rbxl> --fragment <manifest.json> [options]

Options:
  --adapter <name>           lune or rbx_dom (default: lune)
  --place <path>             Copied source place
  --out <path>               Candidate output place
  --fragment <path>          Repeatable fragment manifest path
  --report <path>            Coordinator report path
  --lune-command <cmd>       Lune command override
  --rbx-dom-command <cmd>    rbx-dom coordinator command
  --rbx-dom-arg <arg>        Repeatable argument before rbx-dom flags
  --replace-existing         Replace existing roots by fragment id/root name
  --create-missing-targets   Create missing target folders
  --dry-run                  Print the merge plan without executing
  --json                     Print JSON
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.place) throw new Error("--place is required");
  if (!args.out) throw new Error("--out is required");
  if (!args.fragments.length) throw new Error("at least one --fragment is required");

  const plan = buildCoordinatorMergePlan({
    adapter: args.adapter,
    place: args.place,
    out: args.out,
    fragments: args.fragments,
    reportPath: args.reportPath,
    luneCommand: args.luneCommand,
    rbxDomCommand: args.rbxDomCommand || process.env.RBX_DOM_COORDINATOR_CMD,
    rbxDomArgs: args.rbxDomArgs,
    replaceExisting: args.replaceExisting,
    createMissingTargets: args.createMissingTargets,
  });

  if (args.dryRun) {
    console.log(args.format === "json" ? JSON.stringify(plan, null, 2) : formatCoordinatorMergePlan(plan));
    process.exit(0);
  }

  const result = await executeCoordinatorMergePlan(plan, { cwd: process.cwd() });
  console.log(args.format === "json" ? JSON.stringify(result, null, 2) : formatCoordinatorMergeValidation(result.validation));
  if (!result.validation.passed) process.exitCode = 1;
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage());
  process.exitCode = 2;
}
