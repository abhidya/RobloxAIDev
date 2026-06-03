#!/usr/bin/env node
import { Store } from "../src/store.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "../src/propHuntGate.js";

function parseArgs(argv) {
  const args = { project: "prophunt", format: "text" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--json") args.format = "json";
    else if (arg === "--project") { args.project = next; i += 1; }
    else if (arg === "--min-areas") { args.min_areas = Number(next); i += 1; }
    else if (arg === "--min-hideables") { args.min_hideable_total = Number(next); i += 1; }
    else if (arg === "--min-setpieces") { args.min_setpiece_total = Number(next); i += 1; }
    else if (arg === "--min-hideables-per-area") { args.min_hideable_per_area = Number(next); i += 1; }
    else if (arg === "--min-setpieces-per-area") { args.min_setpiece_per_area = Number(next); i += 1; }
    else if (arg === "--min-hideable-studs") { args.min_hideable_studs = Number(next); i += 1; }
    else if (arg === "--max-hideable-studs") { args.max_hideable_studs = Number(next); i += 1; }
    else if (arg === "--allow-missing-inspections") args.require_inspections = false;
    else if (arg === "--allow-missing-primary-part") args.require_primary_part = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage: node scripts/validate-prop-hunt-gate.mjs [options]

Options:
  --project <name>                 Palette project to validate (default: prophunt)
  --json                           Print JSON instead of text
  --min-areas <n>                  Required classified areas
  --min-hideables <n>              Required hideable props
  --min-setpieces <n>              Required set pieces
  --min-hideables-per-area <n>     Required hideables in every classified area
  --min-setpieces-per-area <n>     Required set pieces in every classified area
  --min-hideable-studs <n>         Minimum hideable max dimension
  --max-hideable-studs <n>         Maximum hideable max dimension
  --allow-missing-inspections      Do not require recorded StudioMCP inspections
  --allow-missing-primary-part     Do not require primary_part=true for hideables
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const store = new Store();
  await store.ready();
  const { project, format, help, ...options } = args;
  const result = validatePropHuntGate({
    project,
    palette: store.getPalette(project),
    getInspection: (id) => store.getInspection(id),
    getReviews: (id) => store.getReviews(id),
    options,
  });

  console.log(format === "json" ? JSON.stringify(result, null, 2) : formatPropHuntGateReport(result));
  process.exit(result.passed ? 0 : 1);
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
