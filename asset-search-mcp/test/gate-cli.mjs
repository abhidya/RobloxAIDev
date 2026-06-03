import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const gateScript = path.join(root, "scripts", "validate-prop-hunt-gate.mjs");
const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-gate-cli-"));
process.env.ASSET_BRAIN_DIR = brainDir;

const store = new Store();
await store.ready();
const areas = ["medieval_market", "sci_fi_lab", "cozy_cabin"];
let nextAsset = 9000;
for (let i = 0; i < 20; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.hideable.cli_prop_${i + 1}`;
  await store.commitPalette("prophunt-cli", slot, assetId, `CLI Prop ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 2, y: 3 + (i % 2), z: 2 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 1,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "gate-cli-test",
  });
}
for (let i = 0; i < 4; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.setpiece.cli_anchor_${i + 1}`;
  await store.commitPalette("prophunt-cli", slot, assetId, `CLI Set Piece ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 12, y: 8, z: 10 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 3,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "gate-cli-test",
  });
}

const env = { ...process.env, ASSET_BRAIN_DIR: brainDir };
const pass = spawnSync("node", [gateScript, "--project", "prophunt-cli", "--json"], { cwd: root, env, encoding: "utf8" });
assert.equal(pass.status, 0, pass.stderr || pass.stdout);
const result = JSON.parse(pass.stdout);
assert.equal(result.passed, true, "CLI gate passes default Prop Hunt fixture");
assert.deepEqual(result.counts, { palette_assets: 24, areas: 3, hideable_total: 20, setpiece_total: 4 });

const fail = spawnSync("node", [gateScript, "--project", "missing-project"], { cwd: root, env, encoding: "utf8" });
assert.equal(fail.status, 1, "CLI exits nonzero for failing gate");
assert.ok(fail.stdout.includes("FAIL Prop Hunt asset gate"), "CLI prints failure report");

await fs.rm(brainDir, { recursive: true, force: true });
console.log("GATE CLI OK — persisted palette validates with default Prop Hunt thresholds");
