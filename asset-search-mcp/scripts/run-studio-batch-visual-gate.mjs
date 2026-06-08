#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  executeMockStudioBatchVisualGate,
  executeStudioMcpBatchVisualGate,
  formatStudioBatchAdapterResult,
} from "../src/studioBatchAdapter.js";

function parseArgs(argv) {
  const args = {
    format: "text",
    transport: "mock",
    placeId: 0,
    studioMcpArgs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--plan") {
      if (!next) throw new Error("--plan requires a path");
      args.plan = next;
      i += 1;
    } else if (arg === "--out") {
      if (!next) throw new Error("--out requires a path");
      args.out = next;
      i += 1;
    } else if (arg === "--active-place") {
      if (!next) throw new Error("--active-place requires a place name");
      args.activePlace = next;
      i += 1;
    } else if (arg === "--place-id") {
      if (!next) throw new Error("--place-id requires a number");
      args.placeId = Number(next);
      i += 1;
    } else if (arg === "--transport") {
      if (!next) throw new Error("--transport requires mock or studio_mcp_stdio");
      args.transport = next;
      i += 1;
    } else if (arg === "--studio-mcp-command") {
      if (!next) throw new Error("--studio-mcp-command requires a command path");
      args.studioMcpCommand = next;
      i += 1;
    } else if (arg === "--studio-mcp-arg") {
      if (!next) throw new Error("--studio-mcp-arg requires a value");
      args.studioMcpArgs.push(next);
      i += 1;
    } else if (arg === "--studio-id") {
      if (!next) throw new Error("--studio-id requires an id");
      args.studioId = next;
      i += 1;
    } else if (arg === "--studio-name") {
      if (!next) throw new Error("--studio-name requires a name");
      args.studioName = next;
      i += 1;
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
  return `Usage: node scripts/run-studio-batch-visual-gate.mjs --plan batch-plan.json [options]

Options:
  --plan <path>          JSON plan from roblox_plan_batch_visual_gate(format='json')
  --out <path>           Batch report path (default: <artifact_root>/batch-report.json)
  --active-place <name>  Mock active Studio place name (default: plan target_place)
  --place-id <id>        Mock place id
  --transport <mode>     mock or studio_mcp_stdio
  --studio-mcp-command <cmd>
                         Studio MCP command for studio_mcp_stdio
                         (default: /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP)
  --studio-mcp-arg <arg> Repeatable Studio MCP command argument
  --studio-id <id>       Optional Studio instance id to set active
  --studio-name <name>   Optional Studio instance name to set active
  --json                 Print JSON instead of text
`;
}

function unwrapPlan(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.plan || payload.batch_visual_gate_plan || payload;
  }
  return payload;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.plan) throw new Error("--plan is required");

  const plan = unwrapPlan(JSON.parse(await readFile(args.plan, "utf8")));
  const result = args.transport === "mock"
    ? executeMockStudioBatchVisualGate(plan, {
      activePlaceName: args.activePlace,
      placeId: args.placeId,
    })
    : args.transport === "studio_mcp_stdio"
      ? await executeStudioMcpBatchVisualGate(plan, {
        command: args.studioMcpCommand || process.env.STUDIO_MCP_COMMAND || "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
        args: args.studioMcpArgs,
        activePlaceName: args.activePlace,
        placeId: args.placeId,
        studioId: args.studioId,
        studioName: args.studioName,
      })
      : null;
  if (!result) throw new Error("--transport must be mock or studio_mcp_stdio");
  const reportPath = args.out || path.join(result.artifact_root || "artifacts/visual-gates/mock", "batch-report.json");
  const root = path.dirname(reportPath);

  await writeJson(reportPath, result.report);
  await writeJson(path.join(root, "batch-manifest.json"), {
    schema: "roblox-studio-batch-manifest/v1",
    report_path: reportPath,
    captures: result.report.screenshots.map((shot) => ({
      capture_id: shot.capture_id,
      image_path: shot.image_path,
      passed: shot.passed,
    })),
  });
  await writeJson(path.join(root, "alt-text.json"), {
    schema: "roblox-studio-batch-alt-text/v1",
    captures: result.report.screenshots.map((shot) => ({
      capture_id: shot.capture_id,
      alt_text: shot.alt_text,
    })),
  });
  await writeJson(path.join(root, "execution-log.json"), result.execution_log);

  const payload = {
    ...result,
    artifacts: {
      report_path: reportPath,
      manifest_path: path.join(root, "batch-manifest.json"),
      alt_text_path: path.join(root, "alt-text.json"),
      execution_log_path: path.join(root, "execution-log.json"),
    },
  };
  console.log(args.format === "json" ? JSON.stringify(payload, null, 2) : formatStudioBatchAdapterResult(payload));
  process.exit(result.validation.passed ? 0 : 1);
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
