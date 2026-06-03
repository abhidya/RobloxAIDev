#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { Store } from "../src/store.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "../src/propHuntGate.js";

function parseArgs(argv) {
  const args = { file: null, project: null, brainDir: null, validate: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--file") { args.file = next; i += 1; }
    else if (arg === "--project") { args.project = next; i += 1; }
    else if (arg === "--brain-dir") { args.brainDir = next; i += 1; }
    else if (arg === "--no-validate") args.validate = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage: node scripts/import-prop-hunt-gate.mjs --file <audit.json> [options]

Options:
  --file <path>       JSON fixture containing project and entries
  --project <name>    Override fixture project
  --brain-dir <path>  Override ASSET_BRAIN_DIR for this import
  --no-validate       Import without printing the gate report
`;
}

function inspectionFor(entry) {
  return {
    slot: entry.slot,
    size_studs: entry.size_studs,
    has_scripts: Boolean(entry.has_scripts),
    script_count: Number(entry.script_count || 0),
    base_part_count: Number(entry.base_part_count || 0),
    anchored_capable: entry.anchored_capable !== false,
    primary_part: entry.primary_part === true,
    issues: Array.isArray(entry.issues) ? entry.issues : [],
    reviewer: entry.reviewer || "place1-import",
    source: entry.source || "studio-audit-fixture",
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(usage());
    process.exit(args.help ? 0 : 2);
  }
  if (args.brainDir) process.env.ASSET_BRAIN_DIR = args.brainDir;

  const fixture = JSON.parse(await fs.readFile(args.file, "utf8"));
  const project = args.project || fixture.project || "prophunt";
  const entries = Array.isArray(fixture.entries) ? fixture.entries : [];
  if (!entries.length) throw new Error("Fixture must include a non-empty entries array.");

  const store = new Store();
  await store.ready();
  for (const entry of entries) {
    if (!entry.slot || !entry.asset_id) throw new Error(`Invalid fixture entry: ${JSON.stringify(entry)}`);
    await store.commitPalette(project, entry.slot, entry.asset_id, entry.name || null);
    await store.recordInspection(entry.asset_id, inspectionFor(entry));
  }

  console.log(`Imported ${entries.length} Prop Hunt gate entries into '${project}'.`);
  if (args.validate) {
    const result = validatePropHuntGate({
      project,
      palette: store.getPalette(project),
      getInspection: (id) => store.getInspection(id),
      getReviews: (id) => store.getReviews(id),
    });
    console.log(formatPropHuntGateReport(result));
    process.exit(result.passed ? 0 : 1);
  }
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
