import { z } from "zod";
import {
  buildAssetAcquisitionPlan,
  formatAssetAcquisitionPlan,
  formatAssetAcquisitionValidation,
  validateAssetAcquisitionReport,
} from "../assetAcquisition.js";

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
}
