#!/usr/bin/env node
import {
  buildProjectTemplatePlan,
  formatProjectTemplatePlan,
  formatProjectTemplateValidation,
  materializeProjectTemplate,
  publicProjectTemplatePlan,
  validateProjectTemplateReport,
} from "../src/projectTemplate.js";

function parseArgs(argv) {
  const args = {
    themes: [],
    format: "text",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--project") {
      if (!next) throw new Error("--project requires a name");
      args.project = next;
      i += 1;
    } else if (arg === "--game") {
      if (!next) throw new Error("--game requires a title");
      args.game = next;
      i += 1;
    } else if (arg === "--target-place") {
      if (!next) throw new Error("--target-place requires a place file name");
      args.targetPlace = next;
      i += 1;
    } else if (arg === "--theme") {
      if (!next) throw new Error("--theme requires a value");
      args.themes.push(next);
      i += 1;
    } else if (arg === "--out-root") {
      if (!next) throw new Error("--out-root requires a path");
      args.outputRoot = next;
      i += 1;
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
  node asset-search-mcp/scripts/generate-project-template.mjs --project <slug> [options]

Options:
  --project <slug>        Required project slug/title
  --game <title>          Display game title
  --target-place <file>   Target place name (default: Place1.rbxl)
  --theme <theme>         Repeatable room/world theme
  --out-root <path>       Output root (default: work/generated-games/<project>)
  --dry-run               Print the plan without writing files
  --json                  Print JSON
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.project) throw new Error("--project is required");

  const plan = buildProjectTemplatePlan(args);
  if (args.dryRun) {
    const publicPlan = publicProjectTemplatePlan(plan);
    console.log(args.format === "json" ? JSON.stringify(publicPlan, null, 2) : formatProjectTemplatePlan(publicPlan));
    process.exit(0);
  }

  const report = await materializeProjectTemplate(plan);
  const validation = await validateProjectTemplateReport(report, plan);
  const result = {
    schema: "roblox-ai-game-project-template-run/v1",
    plan: publicProjectTemplatePlan(plan),
    report,
    validation,
  };
  console.log(args.format === "json" ? JSON.stringify(result, null, 2) : formatProjectTemplateValidation(validation));
  if (!validation.passed) process.exitCode = 1;
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage());
  process.exitCode = 2;
}
