import assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAssetDeliveryRequest,
  executeAssetDeliveryRequest,
  validateAssetDeliveryReceipt,
} from "../src/assetDelivery.js";
import * as assetDeliveryModule from "../src/assetDelivery.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "asset-delivery-"));
const payload = Buffer.from("fake-rbxm-bytes");
const requests = [];

async function runNode(args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn("node", args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const server = createServer((req, res) => {
  requests.push({
    url: req.url,
    apiKey: req.headers["x-api-key"],
    authorization: req.headers.authorization,
  });
  if (req.url === "/asset-delivery-api/v1/assetId/404") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "missing" }));
    return;
  }
  if (req.headers["x-api-key"] !== "test-open-cloud-key") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/octet-stream" });
  res.end(payload);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/asset-delivery-api/v1`;

try {
  const request = buildAssetDeliveryRequest({
    project: "eggbreakers",
    slot: "nursery_grove.dino_fern",
    assetId: 123,
    versionNumber: 7,
    quarantineRoot: path.join(tempDir, "quarantine"),
    baseUrl,
  });
  assert.equal(request.schema, "roblox-asset-delivery-request/v1");
  assert.equal(request.endpoint.path, "/assetId/123/version/7");
  assert.ok(request.outputs.asset_path.endsWith("123-v7.rbxm"));

  const receipt = await executeAssetDeliveryRequest(request, {
    env: { ROBLOX_OPEN_CLOUD_API_KEY: "test-open-cloud-key" },
  });
  assert.equal(receipt.schema, "roblox-asset-delivery-receipt/v1");
  assert.equal(receipt.passed, true, receipt.blockers.join("; "));
  assert.equal(receipt.auth.mode, "api_key");
  assert.equal(receipt.output.bytes, payload.length);
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(receipt.output.sha256), "receipt records sha256 digest");
  assert.equal(await fs.readFile(receipt.output.asset_path, "utf8"), payload.toString("utf8"));
  const receiptJson = await fs.readFile(receipt.output.receipt_path, "utf8");
  assert.ok(!receiptJson.includes("test-open-cloud-key"), "receipt must not leak API key");
  // Credential seam: only the redacted receipt crosses the boundary. The live
  // headers stay inside the authenticated request, and the live-headers resolver
  // is no longer part of the module interface.
  assert.ok(!JSON.stringify(receipt).includes("test-open-cloud-key"), "in-memory receipt must not carry the credential across the seam");
  assert.equal(typeof assetDeliveryModule.resolveAssetDeliveryAuth, "undefined", "live-headers resolver is no longer exported");
  const validation = validateAssetDeliveryReceipt(receipt, request);
  assert.equal(validation.passed, true, validation.errors.join("; "));
  assert.equal(requests.at(-1).url, "/asset-delivery-api/v1/assetId/123/version/7");
  assert.equal(requests.at(-1).apiKey, "test-open-cloud-key");

  const missingAuthReceipt = await executeAssetDeliveryRequest({
    ...request,
    asset_id: 124,
    endpoint: {
      ...request.endpoint,
      path: "/assetId/124",
      url: `${baseUrl}/assetId/124`,
    },
    outputs: {
      ...request.outputs,
      asset_path: path.join(tempDir, "missing-auth", "124.rbxm"),
      receipt_path: path.join(tempDir, "missing-auth", "124.delivery-receipt.json"),
    },
  }, { env: {} });
  assert.equal(missingAuthReceipt.passed, false, "missing auth does not fetch");
  assert.equal(validateAssetDeliveryReceipt(missingAuthReceipt, request).passed, false, "missing auth receipt fails validation");

  const cliOut = path.join(tempDir, "cli-quarantine");
  const cli = await runNode([
    path.join(root, "scripts", "run-asset-delivery.mjs"),
    "--project",
    "eggbreakers",
    "--slot",
    "nursery_grove.dino_fern",
    "--asset-id",
    "456",
    "--quarantine-root",
    cliOut,
    "--base-url",
    baseUrl,
    "--api-key-env",
    "TEST_ROBLOX_OPEN_CLOUD_API_KEY",
    "--json",
  ], {
    cwd: root,
    env: {
      ...process.env,
      TEST_ROBLOX_OPEN_CLOUD_API_KEY: "test-open-cloud-key",
    },
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.schema, "roblox-asset-delivery-run/v1");
  assert.equal(cliResult.validation.passed, true, cliResult.validation.errors.join("; "));
  assert.equal(cliResult.receipt.asset_id, 456);
  assert.ok(!cli.stdout.includes("test-open-cloud-key"), "CLI JSON must not print the API key");
  assert.equal(requests.at(-1).url, "/asset-delivery-api/v1/assetId/456");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("ASSET_DELIVERY_OK authenticated fetch, quarantine write, redacted receipt, and CLI validated");
