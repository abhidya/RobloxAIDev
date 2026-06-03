import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const brainDir = mkdtempSync(path.join(os.tmpdir(), "asset-brain-fixture-"));
const env = { ...process.env, ASSET_BRAIN_DIR: brainDir };

try {
  const importResult = spawnSync("node", [
    "scripts/import-prop-hunt-gate.mjs",
    "--file",
    "fixtures/place1-prop-hunt-gate.json",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(importResult.status, 0, importResult.stderr || importResult.stdout);
  assert.match(importResult.stdout, /PASS Prop Hunt asset gate/);

  const gateResult = spawnSync("node", [
    "scripts/validate-prop-hunt-gate.mjs",
    "--project",
    "prophunt",
    "--json",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(gateResult.status, 0, gateResult.stderr || gateResult.stdout);

  const gate = JSON.parse(gateResult.stdout);
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.counts, {
    palette_assets: 24,
    areas: 3,
    hideable_total: 20,
    setpiece_total: 4,
  });
  console.log("FIXTURE IMPORT OK — Place1 Prop Hunt gate evidence validates");
} finally {
  rmSync(brainDir, { recursive: true, force: true });
}
