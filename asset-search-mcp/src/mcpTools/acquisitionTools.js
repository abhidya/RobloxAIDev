import { z } from "zod";
import {
  buildAssetAcquisitionPlan,
  formatAssetAcquisitionPlan,
  formatAssetAcquisitionValidation,
  validateAssetAcquisitionReport,
} from "../assetAcquisition.js";
import {
  buildAssetDeliveryRequest,
  formatAssetDeliveryRequest,
  formatAssetDeliveryValidation,
  validateAssetDeliveryReceipt,
} from "../assetDelivery.js";

export function registerAcquisitionTools(server, { text }) {
  server.tool(
    "plan_asset_acquisition",
    "Plan the explicit Roblox asset acquisition seam: search/claim, publish-permission proof, direct asset delivery parse, Studio insertion fallback, quarantine scan, fragment manifest validation, and visual proof before palette promotion.",
    {
      project: z.string().optional().describe("Project/cache name."),
      slot: z.string().optional().describe("Palette or storyboard slot being acquired."),
      query: z.string().optional().describe("Creator Store query for the slot."),
      asset_ids: z.array(z.number()).optional().describe("Known candidate asset ids to include."),
      target_place: z.string().optional().describe("Target place for Studio fallback and visual gate."),
      delivery_mode: z.enum(["direct_or_studio_fallback", "direct_only", "studio_only"]).optional(),
      require_publish_permission: z.boolean().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildAssetAcquisitionPlan({
        project: args.project || "roblox-ai-game",
        slot: args.slot || "unassigned.asset",
        query: args.query || "",
        assetIds: args.asset_ids || [],
        targetPlace: args.target_place || "Place1.rbxl",
        deliveryMode: args.delivery_mode || "direct_or_studio_fallback",
        requirePublishPermission: args.require_publish_permission !== false,
      });
      return text(args.format === "json" ? JSON.stringify(plan, null, 2) : formatAssetAcquisitionPlan(plan));
    }
  );

  server.tool(
    "validate_asset_acquisition",
    "Validate the proof report for an asset acquisition packet. Requires search/claim, permission proof, a direct-delivery or Studio-fallback path, quarantine scan, fragment manifest validation, visual proof, and metadata-only asset-brain outputs.",
    {
      report: z.record(z.any()),
      plan: z.record(z.any()).optional().describe("Optional plan from plan_asset_acquisition(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const result = validateAssetAcquisitionReport(args.report, args.plan);
      return text(args.format === "json" ? JSON.stringify(result, null, 2) : formatAssetAcquisitionValidation(result));
    }
  );

  server.tool(
    "plan_asset_delivery",
    "Plan one authenticated Open Cloud Asset Delivery request for a candidate asset. The request writes downloaded bytes to quarantine and records only a redacted receipt.",
    {
      project: z.string().optional().describe("Project/cache name."),
      slot: z.string().optional().describe("Storyboard or palette slot."),
      asset_id: z.number().describe("Roblox asset id to retrieve."),
      version_number: z.number().optional().describe("Optional asset version number."),
      quarantine_root: z.string().optional().describe("Output root for downloaded bytes and receipt."),
      base_url: z.string().optional().describe("Asset Delivery API base URL; override only for tests/proxies."),
      api_key_env: z.string().optional().describe("Environment variable containing a Roblox Open Cloud API key."),
      bearer_env: z.string().optional().describe("Environment variable containing an OAuth bearer token."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const request = buildAssetDeliveryRequest({
        project: args.project || "roblox-ai-game",
        slot: args.slot || "unassigned.asset",
        assetId: args.asset_id,
        versionNumber: args.version_number,
        quarantineRoot: args.quarantine_root,
        baseUrl: args.base_url,
        apiKeyEnv: args.api_key_env,
        bearerEnv: args.bearer_env,
      });
      return text(args.format === "json" ? JSON.stringify(request, null, 2) : formatAssetDeliveryRequest(request));
    }
  );

  server.tool(
    "validate_asset_delivery_receipt",
    "Validate an authenticated Asset Delivery receipt before downloaded bytes can leave quarantine. Requires redacted auth proof, 2xx delivery, sha256 digest, non-empty bytes, and no asset-brain binary paths.",
    {
      receipt: z.record(z.any()),
      request: z.record(z.any()).optional().describe("Optional request from plan_asset_delivery(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const result = validateAssetDeliveryReceipt(args.receipt, args.request);
      return text(args.format === "json" ? JSON.stringify(result, null, 2) : formatAssetDeliveryValidation(result));
    }
  );
}
