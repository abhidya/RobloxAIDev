import assert from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const manifestPath = path.join(repoRoot, "asset-brain", "v1", "manifest.json");
const mergedPath = path.join(repoRoot, "asset-brain", "v1", "merged", "cross-project-asset-brain.json");
const indexPath = path.join(repoRoot, "asset-brain", "v1", "indexes", "merged-project-assets.ndjson");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const merged = JSON.parse(await fs.readFile(mergedPath, "utf8"));
const indexLines = (await fs.readFile(indexPath, "utf8")).trim().split(/\r?\n/);
const indexRecords = indexLines.map((line) => JSON.parse(line));

assert.equal(manifest.schema, "robloxaidev-cross-project-asset-brain/v1");
assert.equal(merged.schema, manifest.schema);
assert.ok(manifest.counts.sourceAreas >= 4, "cross-project sources are present");
assert.ok(manifest.counts.uniqueAssetIds >= 100, "merged brain has substantial asset memory");
assert.equal(indexRecords.length, merged.assetRecords.length, "NDJSON mirrors merged asset records");

for (const project of ["eggbreakers", "groan-tube-hero", "prophunt"]) {
  assert.ok(
    indexRecords.some((record) => record.project === project),
    `${project} records are included`
  );
}

for (const learningId of [
  "headless_first_studio_later",
  "studio_is_serial_and_active_place_gated",
  "asset_family_not_single_clone",
]) {
  assert.ok(
    manifest.hardLearnings.some((learning) => learning.id === learningId),
    `${learningId} learning is preserved`
  );
}

console.log("ASSET BRAIN MERGE ARTIFACTS OK");
