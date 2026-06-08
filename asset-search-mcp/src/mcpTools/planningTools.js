import { z } from "zod";
import { ANNOTATIONS, createToolRegistrar, planSchema, rendered, reportSchema, verdictOutputSchema } from "./registry.js";
import { buildGameAssetCoverage, formatGameAssetCoverage } from "../gameCoverage.js";
import {
  buildHeadlessAssemblyPlan,
  formatFragmentManifestReport,
  formatHeadlessAssemblyPlan,
  validateFragmentManifest,
} from "../headlessPipeline.js";
import {
  buildCoordinatorMergePlan,
  formatCoordinatorMergePlan,
  formatCoordinatorMergeValidation,
  validateCoordinatorMergeReport,
} from "../coordinatorAdapter.js";
import {
  buildPlayableSpaceReviewPlan,
  formatPlayableSpaceReviewPlan,
  formatPlayableSpaceReviewValidation,
  validatePlayableSpaceReview,
} from "../playableSpaceReview.js";
import {
  buildWorldAssetFamilySweepPlan,
  formatWorldAssetFamilySweepPlan,
  formatWorldAssetFamilySweepValidation,
  validateWorldAssetFamilySweep,
} from "../worldAssetFamilySweep.js";
import {
  buildBatchVisualGatePlan,
  formatBatchVisualGatePlan,
  formatBatchVisualGateValidation,
  validateBatchVisualGateReport,
} from "../visualBatchGate.js";
import {
  buildAiGameDevLoopPlan,
  formatAiGameDevLoopPlan,
  formatAiGameDevLoopValidation,
  validateAiGameDevLoopReport,
} from "../aiGameDevLoop.js";
import {
  buildProjectTemplatePlan,
  formatProjectTemplatePlan,
  formatProjectTemplateValidation,
  publicProjectTemplatePlan,
  validateProjectTemplateReport,
} from "../projectTemplate.js";

const pointSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const playableSpaceSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  center: pointSchema.optional(),
  size: pointSchema.optional(),
  entry: pointSchema.optional(),
  look_at: pointSchema.optional(),
  quadrants: z.array(z.string()).optional(),
  ui_states: z.array(z.string()).optional(),
});
const assetFamilySchema = z.object({
  family_id: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  source_asset_id: z.union([z.string(), z.number()]).optional(),
  asset_id: z.union([z.string(), z.number()]).optional(),
  slot: z.string().optional(),
  family_key: z.string().optional(),
  mesh_id: z.string().optional(),
  staged_model_path: z.string().optional(),
  live_instance_count: z.number().optional(),
  instances: z.number().optional(),
  count: z.number().optional(),
  locations: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export function registerPlanningTools(server) {
  // All planning/validation tools are deterministic local computations:
  // read-only, idempotent, no external world interaction.
  const tool = createToolRegistrar(server, ANNOTATIONS.READ_LOCAL);
  // validate_* tools additionally declare the typed verdict output shape.
  const validatorTool = createToolRegistrar(server, ANNOTATIONS.READ_LOCAL, { outputSchema: verdictOutputSchema });

  tool(
    "roblox_plan_ai_game_dev_loop",
    "Plan the AI game-dev loop",
    "Plan the full AI Roblox game-dev loop: asset brain coverage/curation, reusable GameKit source adoption, Roblox file parser/writer generation, headless fragment merge, custom MCP validation, and gated Studio batch screenshots. This is the top-level custom MCP tool for reducing agent churn across the whole game design loop.",
    {
      project: z.string().optional().describe("Project or game slug."),
      game: z.string().optional().describe("Short game idea or title."),
      target_place: z.string().optional().describe("Source place file to copy/mutate before Studio validation."),
      themes: z.array(z.string()).optional().describe("Room/world themes to cover."),
      include_defaults: z.boolean().optional(),
      include_lobby: z.boolean().optional(),
      max_themes: z.number().int().min(1).max(12).optional(),
      max_fragments: z.number().int().min(1).max(12).optional(),
      assembly_profile: z.enum(["prop_hunt", "concert_defense", "metadata_evidence"]).optional(),
      review_mode: z.enum(["full", "player_angle"]).optional(),
      spaces: z.array(playableSpaceSchema).optional(),
      include_default_spaces: z.boolean().optional(),
      artifact_root: z.string().optional(),
      max_captures: z.number().int().min(1).max(200).optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildAiGameDevLoopPlan({
        project: args.project || "roblox-ai-game",
        game: args.game || args.project || "Roblox AI game",
        targetPlace: args.target_place || "Place1.rbxl",
        themes: args.themes || [],
        includeDefaults: args.include_defaults !== false,
        includeLobby: args.include_lobby !== false,
        maxThemes: args.max_themes ?? 6,
        maxFragments: args.max_fragments ?? 6,
        assemblyProfile: args.assembly_profile,
        reviewMode: args.review_mode || "player_angle",
        spaces: args.spaces || [],
        includeDefaultSpaces: args.include_default_spaces !== false,
        artifactRoot: args.artifact_root,
        maxCaptures: args.max_captures,
      });
      return rendered(plan, args.format, formatAiGameDevLoopPlan);
    }
  );

  tool(
    "roblox_plan_project_template",
    "Plan a project template",
    "Plan a new Roblox AI game repo skeleton with asset brain metadata, prompt lanes, Rojo source stubs, POC script, and the asset delivery/coordinator/Studio gate commands prewired.",
    {
      project: z.string().optional(),
      game: z.string().optional(),
      target_place: z.string().optional(),
      themes: z.array(z.string()).optional(),
      output_root: z.string().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildProjectTemplatePlan({
        project: args.project || "roblox-ai-game",
        game: args.game || args.project || "Roblox AI Game",
        targetPlace: args.target_place || "Place1.rbxl",
        themes: args.themes || [],
        outputRoot: args.output_root,
      });
      const publicPlan = publicProjectTemplatePlan(plan);
      return rendered(publicPlan, args.format, formatProjectTemplatePlan);
    }
  );

  validatorTool(
    "roblox_validate_project_template",
    "Validate a project template report",
    "Validate a generated Roblox AI game project template report. Requires the planned files, metadata-only asset brain, prompt lanes, POC script, and prewired proof gates.",
    {
      report: reportSchema,
      plan: planSchema.optional().describe("Optional public plan from roblox_plan_project_template(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = await validateProjectTemplateReport(args.report, args.plan);
      return rendered(out, args.format, formatProjectTemplateValidation);
    }
  );

  validatorTool(
    "roblox_validate_ai_game_dev_loop",
    "Validate the AI game-dev loop report",
    "Validate a proof report for the full AI Roblox game-dev loop. Requires asset brain, GameKit build, parser/writer generation, fragment validation, custom MCP contract proof, and a passing gated Studio batch visual report.",
    {
      report: reportSchema,
      plan: planSchema.optional().describe("Optional plan from roblox_plan_ai_game_dev_loop(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validateAiGameDevLoopReport(args.report, args.plan);
      return rendered(out, args.format, formatAiGameDevLoopValidation);
    }
  );

  tool(
    "roblox_plan_game_asset_coverage",
    "Plan game asset coverage",
    "Create a generic Roblox game asset coverage plan for the asset-driven skill: lobby spawn, NPCs, portals, upgrade shop, leaderboard/cosmetics, and capacity-limited themed room packs. Use this before roblox_curate_assets so new rooms such as underwater, space, haunted, or jungle are grounded in searchable Creator Store slots instead of hand-built placeholders.",
    {
      game: z.string().optional().describe("Short game idea or title."),
      themes: z.array(z.string()).optional().describe("Room themes to cover, e.g. ['underwater reef', 'space station']."),
      include_defaults: z.boolean().optional().describe("Add default expansion themes when true (default true)."),
      include_lobby: z.boolean().optional().describe("Include lobby/social shell slots when true (default true)."),
      max_themes: z.number().int().min(1).max(12).optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const coverage = buildGameAssetCoverage({
        game: args.game || "Roblox game",
        themes: args.themes || [],
        includeDefaults: args.include_defaults !== false,
        includeLobby: args.include_lobby !== false,
        maxThemes: args.max_themes ?? 6,
      });
      return rendered(coverage, args.format, formatGameAssetCoverage);
    }
  );

  tool(
    "roblox_plan_headless_assembly",
    "Plan headless assembly",
    "Create the headless fan-out/fan-in assembly plan for parallel Roblox game agents. Returns agent fragment packets, the referent-safe manifest contract, asset/search/download/publish endpoints, coordinator merge steps, Rojo/Lune validation commands, and the Studio visual gate. Use assembly_profile='concert_defense' for GroanTubeHero/WorldV2-style concert arenas instead of Prop Hunt room parents.",
    {
      project: z.string().optional().describe("Project or game name (default: prophunt)."),
      target_place: z.string().optional().describe("Source place file to copy before mutation (default: Place1.rbxl)."),
      themes: z.array(z.string()).optional().describe("Themed room packets to generate, e.g. ['underwater reef','space station']."),
      include_lobby: z.boolean().optional().describe("Include the persistent lobby fragment packet (default true)."),
      max_fragments: z.number().int().min(1).max(12).optional(),
      assembly_profile: z.enum(["prop_hunt", "concert_defense", "metadata_evidence"]).optional().describe("Fragment target profile. Defaults to prop_hunt, but GroanTubeHero-like project names infer concert_defense."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildHeadlessAssemblyPlan({
        project: args.project || "prophunt",
        targetPlace: args.target_place || "Place1.rbxl",
        themes: args.themes || [],
        includeLobby: args.include_lobby !== false,
        maxFragments: args.max_fragments ?? 6,
        assemblyProfile: args.assembly_profile,
      });
      return rendered(plan, args.format, formatHeadlessAssemblyPlan);
    }
  );

  validatorTool(
    "roblox_validate_fragment_manifest",
    "Validate a fragment manifest",
    "Validate an agent-produced rbxm fragment manifest before a coordinator merges it into a Roblox place. Enforces one-root fragments, coordinator-owned referent remapping, strip/regenerate UniqueId policy, declared asset ids/external anchors, and blocks risky script loaders such as require(assetId), InsertService:LoadAsset, loadstring, and HttpService requests.",
    {
      manifest: reportSchema,
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validateFragmentManifest(args.manifest);
      return rendered(out, args.format, formatFragmentManifestReport);
    }
  );

  tool(
    "roblox_plan_coordinator_merge",
    "Plan a coordinator merge",
    "Plan a replaceable headless Roblox coordinator merge. Adapter 'lune' wraps the proven Lune script; adapter 'rbx_dom' targets an external production rbx-dom coordinator command with the same report contract.",
    {
      adapter: z.enum(["lune", "rbx_dom"]).optional(),
      place: z.string().optional().describe("Copied source place path."),
      out: z.string().optional().describe("Candidate output place path."),
      fragments: z.array(z.string()).optional().describe("Fragment manifest paths."),
      replace_existing: z.boolean().optional(),
      create_missing_targets: z.boolean().optional(),
      report_path: z.string().optional(),
      lune_command: z.string().optional(),
      rbx_dom_command: z.string().optional(),
      rbx_dom_args: z.array(z.string()).optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildCoordinatorMergePlan({
        adapter: args.adapter,
        place: args.place,
        out: args.out,
        fragments: args.fragments,
        replaceExisting: args.replace_existing,
        createMissingTargets: args.create_missing_targets,
        reportPath: args.report_path,
        luneCommand: args.lune_command,
        rbxDomCommand: args.rbx_dom_command,
        rbxDomArgs: args.rbx_dom_args,
      });
      return rendered(plan, args.format, formatCoordinatorMergePlan);
    }
  );

  validatorTool(
    "roblox_validate_coordinator_merge",
    "Validate a coordinator merge report",
    "Validate a headless coordinator merge report from the Lune or rbx-dom adapter. Requires passed process proof, reload validation, coordinator-owned identity policy, non-empty fragments, and non-asset-brain output paths.",
    {
      report: reportSchema,
      plan: planSchema.optional().describe("Optional plan from roblox_plan_coordinator_merge(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validateCoordinatorMergeReport(args.report, args.plan);
      return rendered(out, args.format, formatCoordinatorMergeValidation);
    }
  );

  tool(
    "roblox_plan_playable_space_review",
    "Plan a playable-space review",
    "Create a Studio screenshot plan for Roblox playable-space signoff. Covers lobby, portals, rooms, player-height quadrants, reverse shots, UI states, and the visual rubric. Use review_mode='player_angle' for scoped asset-fix passes that only need player-height screenshots.",
    {
      project: z.string().optional().describe("Project name for capture ids (default: prophunt)."),
      review_mode: z.enum(["full", "player_angle"]).optional().describe("full = overhead/entry/player/reverse/UI. player_angle = scoped player-height quadrant screenshots for asset fixes."),
      spaces: z.array(playableSpaceSchema).optional().describe("Optional custom playable spaces. Defaults to Place1 Prop Hunt lobby + 3 rooms."),
      include_defaults: z.boolean().optional().describe("Use default Prop Hunt spaces when spaces is empty (default true)."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildPlayableSpaceReviewPlan({
        project: args.project || "prophunt",
        spaces: args.spaces || [],
        includeDefaults: args.include_defaults !== false,
        reviewMode: args.review_mode || "full",
        format: args.format || "text",
      });
      return rendered(plan, args.format, formatPlayableSpaceReviewPlan);
    }
  );

  tool(
    "roblox_plan_world_asset_family_sweep",
    "Plan a world asset-family sweep",
    "Plan a strict Roblox world asset-family verification pass for repeated imported/staged assets that are sideways, face-down, floating, buried, mis-scaled, or inconsistently placed. The plan enforces one family at a time, clean-spot clone screenshots before/after fixes, live player-height proof, propagation to all live visual instances, roblox_record_inspection metadata, and temporary clone cleanup.",
    {
      project: z.string().optional(),
      target_place: z.string().optional(),
      families: z.array(assetFamilySchema).optional(),
      artifact_root: z.string().optional(),
      max_families: z.number().int().min(1).max(100).optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildWorldAssetFamilySweepPlan({
        project: args.project || "roblox-game",
        targetPlace: args.target_place || "Place1.rbxl",
        families: args.families || [],
        artifactRoot: args.artifact_root,
        maxFamilies: args.max_families ?? 24,
      });
      return rendered(plan, args.format, formatWorldAssetFamilySweepPlan);
    }
  );

  validatorTool(
    "roblox_validate_world_asset_family_sweep",
    "Validate a world asset-family sweep report",
    "Validate a Roblox world asset-family sweep report. Fails when clean clone before/after screenshots are missing, live player-height proof is missing, canonical up/forward/scale/grounding/pivot metadata is missing, fixes were not propagated to all live visual instances, roblox_record_inspection proof is missing, blockers remain, or temporary validation clones were not removed.",
    {
      report: reportSchema,
      plan: planSchema.optional().describe("Optional plan from roblox_plan_world_asset_family_sweep(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validateWorldAssetFamilySweep(args.report, args.plan);
      return rendered(out, args.format, formatWorldAssetFamilySweepValidation);
    }
  );

  validatorTool(
    "roblox_validate_playable_space_review",
    "Validate a playable-space review report",
    "Validate a Roblox playable-space visual review report. Fails when spaces are missing, player-height quadrant screenshots are missing, required screenshot kinds are skipped, or major/blocker findings remain unresolved. A supplied custom plan is authoritative; without one, custom/scoped reports are inferred from the report before falling back to the default Prop Hunt plan.",
    {
      report: reportSchema,
      plan: planSchema.optional().describe("Optional plan from roblox_plan_playable_space_review(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validatePlayableSpaceReview(args.report, args.plan);
      return rendered(out, args.format, formatPlayableSpaceReviewValidation);
    }
  );

  tool(
    "roblox_plan_batch_visual_gate",
    "Plan a batch visual gate",
    "Create a serial StudioMCP batch screenshot gate from a playable-space review plan. The returned packet includes active-place preflight Luau, deterministic camera steps, screen_capture requests, collation paths, accessibility fields, and a report template so a Studio wrapper can capture all views with minimal agent calls.",
    {
      project: z.string().optional().describe("Project name for capture ids (default: prophunt)."),
      target_place: z.string().optional().describe("Expected active Studio place name/file, e.g. GroanTubeHero.rbxl or eggBreakers3.rbxl."),
      review_mode: z.enum(["full", "player_angle"]).optional(),
      spaces: z.array(playableSpaceSchema).optional().describe("Optional custom playable spaces. Defaults to Place1 Prop Hunt spaces."),
      include_defaults: z.boolean().optional().describe("Use default Prop Hunt spaces when spaces is empty (default true)."),
      adapter: z.enum(["studio_mcp_proxy", "manual_studio_mcp"]).optional().describe("Studio execution adapter contract."),
      artifact_root: z.string().optional().describe("Where the wrapper should write screenshots and the collated manifest."),
      max_captures: z.number().int().min(1).max(200).optional().describe("Optional cap for smoke runs."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const plan = buildBatchVisualGatePlan({
        project: args.project || "prophunt",
        targetPlace: args.target_place || "Place1.rbxl",
        reviewMode: args.review_mode || "full",
        spaces: args.spaces || [],
        includeDefaults: args.include_defaults !== false,
        adapter: args.adapter,
        artifactRoot: args.artifact_root,
        maxCaptures: args.max_captures,
      });
      return rendered(plan, args.format, formatBatchVisualGatePlan);
    }
  );

  validatorTool(
    "roblox_validate_batch_visual_gate",
    "Validate a batch visual gate report",
    "Validate the collated output from a StudioMCP batch screenshot wrapper. Requires active-place preflight proof, image paths for every planned capture, and a passing playable-space review report.",
    {
      batch_report: reportSchema,
      plan: planSchema.optional().describe("Optional plan from roblox_plan_batch_visual_gate(format='json')."),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const out = validateBatchVisualGateReport(args.batch_report, args.plan);
      return rendered(out, args.format, formatBatchVisualGateValidation);
    }
  );
}
