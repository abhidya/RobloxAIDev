import assert from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFragmentManifest } from "../src/headlessPipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const fixtureDir = path.join(root, "fixtures", "fragment-manifests");

async function readFixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureDir, name), "utf8"));
}

const jsGenerated = await readFixture("js-generated-room.json");
const luneEmitted = await readFixture("lune-emitted-room.json");
const jsResult = validateFragmentManifest(jsGenerated);
const luneResult = validateFragmentManifest(luneEmitted);

assert.equal(jsResult.passed, true, jsResult.errors.join("; "));
assert.equal(luneResult.passed, true, luneResult.errors.join("; "));

for (const result of [jsResult, luneResult]) {
  assert.deepEqual(Object.keys(result.normalized).sort(), [
    "asset_ids",
    "external_anchors",
    "fragment_id",
    "identity_policy",
    "order_key",
    "roots",
    "single_root",
    "source_digest",
    "target_parent",
    "version",
  ].sort(), "normalized manifest only exposes canonical fields");
}

assert.equal(jsResult.normalized.fragment_id, luneResult.normalized.fragment_id);
assert.equal(jsResult.normalized.target_parent, luneResult.normalized.target_parent);
assert.equal(jsResult.normalized.order_key, luneResult.normalized.order_key);
assert.equal(jsResult.normalized.source_digest, luneResult.normalized.source_digest);
assert.deepEqual(jsResult.normalized.asset_ids.map(String), luneResult.normalized.asset_ids.map(String));
assert.deepEqual(jsResult.normalized.external_anchors, luneResult.normalized.external_anchors);

assert.equal(jsResult.normalized.identity_policy.referents, "coordinator_remap");
assert.equal(luneResult.normalized.identity_policy.referents, "coordinator");
assert.ok(
  ["strip", "coordinator_generate"].includes(luneResult.normalized.identity_policy.unique_ids),
  "Luau-emitted alias fixture normalizes to an allowed UniqueId policy"
);

console.log("FRAGMENT_MANIFEST_FIXTURES_OK js and lune aliases validate through one schema");
