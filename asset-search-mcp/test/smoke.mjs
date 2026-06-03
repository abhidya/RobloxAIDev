// Smoke test: spin up the server as a real MCP client, list tools, and exercise
// search / curate / review / palette. Live search needs network to the Toolbox
// API; if unreachable the wiring is still validated (empty result set).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "src", "index.js");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env, ASSET_BRAIN_DIR: "/tmp/brain-test" },
});

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  return r.content?.[0]?.text ?? "";
}

console.log("\n--- search_assets ---");
console.log((await call("search_assets", { query: "wooden barrel", max_results: 3 })).slice(0, 700));

console.log("\n--- curate_assets ---");
console.log(
  (await call("curate_assets", {
    slots: [{ slot: "barrel", query: "medieval barrel" }],
    per_slot: 2,
  })).slice(0, 500)
);

console.log("\n--- review_asset + palette ---");
console.log(await call("review_asset", { asset_id: 12345, verdict: "keep", notes: "smoke test", slot: "barrel" }));
console.log(await call("commit_palette", { project: "prophunt", slot: "medieval.barrel", asset_id: 12345, name: "Barrel" }));
console.log(await call("get_palette", { project: "prophunt" }));

await client.close();
console.log("\nSMOKE OK");
process.exit(0);
