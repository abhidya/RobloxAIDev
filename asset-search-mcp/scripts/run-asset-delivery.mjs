#!/usr/bin/env node
import {
  buildAssetDeliveryRequest,
  executeAssetDeliveryRequest,
  formatAssetDeliveryRequest,
  formatAssetDeliveryValidation,
  validateAssetDeliveryReceipt,
} from "../src/assetDelivery.js";

function parseArgs(argv) {
  const args = {
    format: "text",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--project") {
      if (!next) throw new Error("--project requires a value");
      args.project = next;
      i += 1;
    } else if (arg === "--slot") {
      if (!next) throw new Error("--slot requires a value");
      args.slot = next;
      i += 1;
    } else if (arg === "--asset-id") {
      if (!next) throw new Error("--asset-id requires a numeric id");
      args.assetId = Number(next);
      i += 1;
    } else if (arg === "--version") {
      if (!next) throw new Error("--version requires a numeric version");
      args.versionNumber = Number(next);
      i += 1;
    } else if (arg === "--quarantine-root") {
      if (!next) throw new Error("--quarantine-root requires a path");
      args.quarantineRoot = next;
      i += 1;
    } else if (arg === "--base-url") {
      if (!next) throw new Error("--base-url requires a URL");
      args.baseUrl = next;
      i += 1;
    } else if (arg === "--api-key-env") {
      if (!next) throw new Error("--api-key-env requires an environment variable name");
      args.apiKeyEnv = next;
      i += 1;
    } else if (arg === "--bearer-env") {
      if (!next) throw new Error("--bearer-env requires an environment variable name");
      args.bearerEnv = next;
      i += 1;
    } else if (arg === "--timeout-ms") {
      if (!next) throw new Error("--timeout-ms requires a number");
      args.timeoutMs = Number(next);
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--json") {
      args.format = "json";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return `Usage:
  node asset-search-mcp/scripts/run-asset-delivery.mjs --asset-id <id> [options]

Options:
  --project <name>           Project/cache name
  --slot <slot>              Storyboard or palette slot
  --asset-id <id>            Required Roblox asset id
  --version <number>         Optional asset version number
  --quarantine-root <path>   Output root for bytes and receipt
  --base-url <url>           Asset Delivery API base URL
                             (default: https://apis.roblox.com/asset-delivery-api/v1)
  --api-key-env <name>       API key environment variable
                             (default: ROBLOX_OPEN_CLOUD_API_KEY)
  --bearer-env <name>        OAuth bearer token environment variable
                             (default: ROBLOX_OPEN_CLOUD_ACCESS_TOKEN)
  --timeout-ms <number>      Fetch timeout in milliseconds
  --dry-run                  Print the redacted request without fetching
  --json                     Print JSON
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.assetId) throw new Error("--asset-id is required");

  const request = buildAssetDeliveryRequest(args);
  if (args.dryRun) {
    console.log(args.format === "json" ? JSON.stringify(request, null, 2) : formatAssetDeliveryRequest(request));
    process.exit(0);
  }

  const receipt = await executeAssetDeliveryRequest(request, {
    apiKeyEnv: args.apiKeyEnv,
    bearerEnv: args.bearerEnv,
    timeoutMs: args.timeoutMs,
  });
  const validation = validateAssetDeliveryReceipt(receipt, request);
  const result = {
    schema: "roblox-asset-delivery-run/v1",
    request,
    receipt,
    validation,
  };
  console.log(args.format === "json" ? JSON.stringify(result, null, 2) : formatAssetDeliveryValidation(validation));
  if (!validation.passed) process.exitCode = 1;
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
