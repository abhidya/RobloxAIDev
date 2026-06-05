// Contract test for the reusable Roblox GameKit extraction.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const kitRoot = path.join(repoRoot, "packages", "roblox-game-kit");

async function readJson(relativePath) {
  const text = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(text);
}

async function readText(relativePath) {
  return await fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

const catalog = await readJson("packages/roblox-game-kit/module-catalog.json");
assert.equal(catalog.schema, "roblox-game-kit-module-catalog/v1", "catalog schema");
assert.ok(catalog.families.length >= 12, "catalog has broad module-family coverage");

const familyIds = new Set(catalog.families.map((family) => family.id));
for (const required of [
  "service-lifecycle",
  "remote-contracts",
  "remote-security",
  "profile-store",
  "economy-wallet",
  "score-and-timing",
  "room-session",
  "world-layout",
  "asset-audit",
  "config-registry",
  "life-sim",
  "client-ui",
  "test-harness",
]) {
  assert.ok(familyIds.has(required), `catalog includes ${required}`);
}

const modulePaths = [];
for (const family of catalog.families) {
  assert.ok(family.interface && family.interface.length > 20, `${family.id} has an interface description`);
  assert.ok(Array.isArray(family.sourceExamples) && family.sourceExamples.length > 0, `${family.id} has source examples`);
  for (const modulePath of family.modulePaths) {
    modulePaths.push(modulePath);
  }
}

assert.equal(new Set(modulePaths).size, modulePaths.length, "module paths are unique");
for (const modulePath of modulePaths) {
  const fullPath = path.join(kitRoot, modulePath);
  const text = await fs.readFile(fullPath, "utf8");
  assert.ok(text.startsWith("--!strict"), `${modulePath} starts strict`);
  assert.ok(/\breturn\b/.test(text), `${modulePath} returns a module`);
  assert.doesNotMatch(text, /\bTODO\b|\bHACK\b|temporary workaround|fallback if it fails|swallowed error/i, `${modulePath} avoids slop markers`);
}

const inventory = await readJson("packages/roblox-game-kit/inventory/source-library-inventory.json");
assert.equal(inventory.schema, "roblox-game-kit-source-library-inventory/v1", "inventory schema");
assert.equal(inventory.sourceProjects.length, 3, "inventory scans three source projects");
assert.ok(inventory.counts.files >= 100, "inventory captures the real source libraries");
for (const projectId of ["eggbreakers", "groantubehero", "robloxaidev-prophunt"]) {
  assert.ok(inventory.counts.byProject[projectId] > 0, `inventory has ${projectId} sources`);
}
for (const [familyId, count] of Object.entries(inventory.counts.byFamily)) {
  assert.ok(familyIds.has(familyId), `inventory family ${familyId} exists in catalog`);
  assert.ok(count > 0, `${familyId} has source records`);
}
for (const record of inventory.records) {
  assert.ok(record.project && record.relativePath && record.family, "inventory record has project/path/family");
  assert.ok(familyIds.has(record.family), `${record.relativePath} maps to catalog family ${record.family}`);
}

const docs = await readText("docs/reusable-roblox-game-kit.md");
for (const needle of [
  "Behavior Lock",
  "Cleanup Plan",
  "Fallback Findings",
  "Migration Passes",
  "Top Recommendation",
]) {
  assert.ok(docs.includes(needle), `reusable kit doc includes ${needle}`);
}

console.log(`GAME_KIT_CONTRACTS_OK modules=${modulePaths.length} sourceFiles=${inventory.counts.files}`);
