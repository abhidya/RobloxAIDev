import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerPlanningTools } from "../src/mcpTools/planningTools.js";
import { registerPolicyTools } from "../src/mcpTools/policyTools.js";
import { registerAcquisitionTools } from "../src/mcpTools/acquisitionTools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// A server stand-in that records registrations. Each cluster registers through
// the shared registry, so this verifies the registrar wiring without the SDK.
function recordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, spec, handler) {
      assert.ok(!tools.has(name), `duplicate tool ${name}`);
      tools.set(name, { spec, handler });
    },
  };
}

function assertWellFormed(tools) {
  for (const [name, { spec, handler }] of tools) {
    assert.ok(name.startsWith("roblox_"), `tool ${name} must be roblox_-prefixed`);
    assert.equal(typeof spec.title, "string", `${name} needs a title`);
    assert.equal(typeof spec.description, "string", `${name} needs a description`);
    assert.ok(spec.inputSchema && typeof spec.inputSchema === "object", `${name} needs an inputSchema`);
    assert.ok(spec.annotations && typeof spec.annotations.readOnlyHint === "boolean", `${name} needs annotation hints`);
    assert.equal(typeof handler, "function", `${name} needs a handler`);
  }
}

// --- cluster registration (fake server, no SDK) ------------------------------
const planning = recordingServer();
registerPlanningTools(planning);
assert.equal(planning.tools.size, 15, "planning cluster registers 15 tools");
assertWellFormed(planning.tools);

const policy = recordingServer();
registerPolicyTools(policy, { store: {} });
assert.equal(policy.tools.size, 6, "policy cluster registers 6 tools");
assertWellFormed(policy.tools);

const acquisition = recordingServer();
registerAcquisitionTools(acquisition);
assert.equal(acquisition.tools.size, 4, "acquisition cluster registers 4 tools");
assertWellFormed(acquisition.tools);

// --- the shared response envelope flows through the registrar -----------------
{
  const plan = acquisition.tools.get("roblox_plan_asset_acquisition");
  const textResult = await plan.handler({});
  assert.equal(textResult.content[0].type, "text", "text mode renders a text block");
  assert.equal(textResult.structuredContent.schema, "roblox-asset-acquisition-plan/v1", "structuredContent carries the plan");
  assert.ok(!textResult.content[0].text.startsWith("{"), "text mode renders human text, not raw JSON");

  const jsonResult = await plan.handler({ format: "json" });
  assert.ok(jsonResult.content[0].text.startsWith("{"), "json mode renders the structured payload as text");
  assert.equal(jsonResult.structuredContent.schema, "roblox-asset-acquisition-plan/v1");

  const coverage = await planning.tools.get("roblox_plan_game_asset_coverage").handler({});
  assert.ok(coverage.structuredContent, "planning handlers return structuredContent through rendered()");
}

// --- end-to-end: boot the real server and list its tools ---------------------
{
  const transport = new StdioClientTransport({ command: "node", args: [path.join(root, "src", "index.js")] });
  const client = new Client({ name: "tool-registration-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.length >= 40, `server exposes the full tool surface (got ${names.length})`);
    assert.ok(names.every((name) => name.startsWith("roblox_")), "every tool is roblox_-prefixed");
    for (const expected of [
      "roblox_search_assets",
      "roblox_plan_ai_game_dev_loop",
      "roblox_validate_publish_permissions",
      "roblox_plan_asset_delivery",
    ]) {
      assert.ok(names.includes(expected), `server registers ${expected}`);
    }

    // validate_* tools declare a typed verdict outputSchema. Call one and
    // confirm the server validates structuredContent against it (the call would
    // error if the verdict shape did not match the declared output schema).
    const validation = await client.callTool({
      name: "roblox_validate_fragment_manifest",
      arguments: { manifest: { schema: "roblox-fragment-manifest/v1" } },
    });
    assert.ok(!validation.isError, "validator call succeeds against its outputSchema");
    assert.equal(typeof validation.structuredContent?.passed, "boolean", "typed verdict structuredContent is returned");
    assert.ok(Array.isArray(validation.structuredContent.errors), "verdict carries an errors array");
  } finally {
    await client.close();
  }
}

console.log("TOOL_REGISTRATION_OK clusters register through the shared registry and the booted server lists the full roblox_ tool surface");
