#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    fragments: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "merge-fragments") {
      args.command = arg;
    } else if (arg === "--place") {
      args.place = next;
      i += 1;
    } else if (arg === "--out") {
      args.out = next;
      i += 1;
    } else if (arg === "--fragment") {
      args.fragments.push(next);
      i += 1;
    } else if (arg === "--report") {
      args.report = next;
      i += 1;
    } else if (arg === "--replace-existing") {
      args.replaceExisting = true;
    } else if (arg === "--create-missing-targets") {
      args.createMissingTargets = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.command !== "merge-fragments" || !args.place || !args.out || !args.fragments.length || !args.report) {
  console.error("FAKE_RBX_DOM_COORDINATOR_FAIL invalid args");
  process.exit(2);
}

const summary = {
  adapter: "rbx_dom",
  input_place: args.place,
  output_place: args.out,
  reload_validated: true,
  fragments: args.fragments.map((fragment, index) => ({
    fragment_id: path.basename(fragment).replace(/\.manifest\.json$/i, ""),
    manifest_path: fragment,
    target_parent: "Workspace",
    order_key: String(index).padStart(3, "0"),
  })),
  warnings: [],
};

await mkdir(path.dirname(args.out), { recursive: true });
await writeFile(args.out, "fake-rbx-dom-place");
await mkdir(path.dirname(args.report), { recursive: true });
await writeFile(args.report, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
