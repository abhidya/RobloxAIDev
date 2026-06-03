#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  buildPlayableSpaceReviewPlan,
  formatPlayableSpaceReviewValidation,
  validatePlayableSpaceReview,
} from "../src/playableSpaceReview.js";

function parseArgs(argv) {
  const args = { format: "text", project: "prophunt" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--file") {
      if (!next) throw new Error("--file requires a path");
      args.file = next;
      i += 1;
    } else if (arg === "--project") {
      if (!next) throw new Error("--project requires a name");
      args.project = next;
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
  return `Usage: node scripts/validate-playable-space-review.mjs --file report.json [options]

Options:
  --file <path>       JSON report or { report, plan } wrapper to validate
  --project <name>    Project name when the report omits one (default: prophunt)
  --json              Print JSON instead of text
`;
}

function unwrapPayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.report) {
    return {
      report: payload.report,
      plan: payload.plan || payload.report.plan,
    };
  }
  return {
    report: payload,
    plan: payload?.plan,
  };
}

function buildPlanFor(report, explicitPlan, project) {
  if (explicitPlan) return explicitPlan;
  const spaces = Array.isArray(report?.spaces) ? report.spaces : [];
  return buildPlayableSpaceReviewPlan({
    project: report?.project || project,
    spaces,
    includeDefaults: spaces.length === 0,
  });
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.file) throw new Error("--file is required");

  const payload = JSON.parse(await readFile(args.file, "utf8"));
  const { report, plan } = unwrapPayload(payload);
  const reviewPlan = buildPlanFor(report, plan, args.project);
  const result = validatePlayableSpaceReview(report, reviewPlan);

  console.log(args.format === "json" ? JSON.stringify(result, null, 2) : formatPlayableSpaceReviewValidation(result));
  process.exit(result.passed ? 0 : 1);
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
