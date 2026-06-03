// Smoke test: spin up the server as a real MCP client, list tools, and exercise
// search / curate / review / palette. Live search needs network to the Toolbox
// API; if unreachable the wiring is still validated (empty result set).
import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "src", "index.js");
const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-smoke-"));

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env, ASSET_BRAIN_DIR: brainDir },
});

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
const toolNames = tools.tools.map((t) => t.name);
console.log("TOOLS:", toolNames.join(", "));
for (const requiredTool of ["plan_game_asset_coverage", "record_inspection", "record_inspections", "get_inspection", "validate_prop_hunt_gate"]) {
  assert.ok(toolNames.includes(requiredTool), `${requiredTool} is listed`);
}

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  return r.content?.[0]?.text ?? "";
}

console.log("\n--- search_assets ---");
console.log((await call("search_assets", { query: "wooden barrel", max_results: 3 })).slice(0, 700));

console.log("\n--- plan_game_asset_coverage ---");
const coverageText = await call("plan_game_asset_coverage", {
  game: "party prop hunt",
  themes: ["underwater reef", "space station"],
  include_defaults: false,
});
assert.ok(coverageText.includes("lobby.portal.room_queue"), "coverage includes lobby portal");
assert.ok(coverageText.includes("underwater_reef.hideable.prop_pack"), "coverage includes underwater room props");
console.log(coverageText.slice(0, 900));

console.log("\n--- curate_assets ---");
console.log(
  (await call("curate_assets", {
    slots: [{ slot: "barrel", query: "medieval barrel" }],
    per_slot: 2,
  })).slice(0, 500)
);

console.log("\n--- review_asset + palette ---");
console.log(await call("review_asset", { asset_id: 12345, verdict: "keep", notes: "smoke test", slot: "barrel" }));
console.log(await call("commit_palette", { project: "prophunt-smoke", slot: "medieval_market.hideable.barrel", asset_id: 12345, name: "Barrel" }));
console.log(await call("record_inspection", {
  asset_id: 12345,
  slot: "medieval_market.hideable.barrel",
  size_studs: { x: 2, y: 3, z: 2 },
  has_scripts: false,
  script_count: 0,
  base_part_count: 1,
  anchored_capable: true,
  primary_part: true,
  source: "smoke",
}));
console.log(await call("record_inspections", {
  inspections: [{
    asset_id: 34567,
    slot: "medieval_market.hideable.crate",
    size_studs: { x: 3, y: 3, z: 3 },
    has_scripts: false,
    script_count: 0,
    base_part_count: 1,
    anchored_capable: true,
    primary_part: true,
    source: "smoke-bulk",
  }],
}));
console.log(await call("commit_palette", { project: "prophunt-smoke", slot: "medieval_market.setpiece.market_stall", asset_id: 23456, name: "Market Stall" }));
console.log(await call("record_inspection", {
  asset_id: 23456,
  slot: "medieval_market.setpiece.market_stall",
  size_studs: { x: 12, y: 8, z: 10 },
  has_scripts: false,
  script_count: 0,
  base_part_count: 3,
  anchored_capable: true,
  primary_part: true,
  source: "smoke",
}));
console.log(await call("get_palette", { project: "prophunt-smoke" }));
const gateText = await call("validate_prop_hunt_gate", {
  project: "prophunt-smoke",
  min_areas: 1,
  min_hideable_total: 1,
  min_setpiece_total: 1,
});
assert.ok(gateText.startsWith("PASS"), "text gate passes");
console.log(gateText);
const gateJson = JSON.parse(await call("validate_prop_hunt_gate", {
  project: "prophunt-smoke",
  min_areas: 1,
  min_hideable_total: 1,
  min_setpiece_total: 1,
  format: "json",
}));
assert.equal(gateJson.passed, true, "json gate passes");
assert.equal(gateJson.counts.hideable_total, 1, "json gate returns counts");

await client.close();
await fs.rm(brainDir, { recursive: true, force: true });
console.log("\nSMOKE OK");
process.exit(0);
