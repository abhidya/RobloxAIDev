import { z } from "zod";
import { ANNOTATIONS, errorText, rendered, result, text, verdictOutputSchema } from "./registry.js";
import { passLabel, renderFindings } from "../proofBundle.js";

const publishAccessSchema = z.enum(["grantable", "open_use", "open_use_dependency", "restricted_denied", "unknown"]);
const publishPolicySchema = z.enum(["allow", "allow_external_open_use", "quarantine", "reject"]);
const probeSchema = z.enum(["not_run", "pass", "fail"]);
const publishPermissionDependencySchema = z.object({
  asset_id: z.number().optional(),
  assetId: z.number().optional(),
  type: z.string().optional(),
  access: publishAccessSchema.optional(),
  grantable_by_us: z.boolean().optional(),
  grantableByUs: z.boolean().optional(),
  experience_has_access: z.boolean().optional(),
  experienceHasAccess: z.boolean().optional(),
  status: z.enum(["pass", "quarantine", "reject", "unknown"]).optional(),
  evidence: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
const publishPermissionSchema = z.object({
  asset_id: z.number(),
  target_publisher: z.record(z.any()).optional().describe("Publisher proof target, e.g. {type:'group', id:'123'}"),
  target_experience_id: z.string().optional(),
  access: publishAccessSchema.describe("grantable = owned by target publisher; open_use/open_use_dependency = usable but not grantable; restricted_denied/unknown block release."),
  grantable_by_us: z.boolean().optional(),
  experience_has_access: z.boolean().optional(),
  publish_policy: publishPolicySchema.optional(),
  studio_insert_probe: probeSchema.optional(),
  save_reopen_probe: probeSchema.optional(),
  dependencies: z.array(publishPermissionDependencySchema).optional(),
  evidence: z.array(z.string()).optional(),
  notes: z.string().optional(),
  reviewer: z.string().optional(),
  source: z.string().optional(),
});

function normalizePermissionArgs(args) {
  return {
    targetPublisher: args.target_publisher ?? null,
    targetExperienceId: args.target_experience_id ?? null,
    access: args.access,
    grantableByUs: args.grantable_by_us ?? null,
    experienceHasAccess: args.experience_has_access ?? null,
    publishPolicy: args.publish_policy ?? null,
    studioInsertProbe: args.studio_insert_probe ?? "not_run",
    saveReopenProbe: args.save_reopen_probe ?? "not_run",
    dependencies: args.dependencies ?? [],
    evidence: args.evidence ?? [],
    notes: args.notes ?? null,
    reviewer: args.reviewer ?? null,
    source: args.source ?? "permission-audit",
  };
}

function publishValidationOptions(args) {
  return {
    mode: args.publish_permission_mode || args.mode || "grantable_or_open_use",
    requireStudioProbe: !!args.require_studio_probe,
    requireSaveReopen: !!args.require_save_reopen,
  };
}

function formatPublishPermissionValidation(validation) {
  const lines = [
    `${passLabel(validation.passed)} publish permissions for '${validation.project}' mode=${validation.mode}`,
    `palette=${validation.counts.paletteAssets} passed=${validation.counts.passed} failed=${validation.counts.failed} missing=${validation.counts.missing}`,
  ];
  lines.push(...renderFindings(validation));
  return lines.join("\n");
}

export function registerPolicyTools(server, { store }) {
  const { READ_LOCAL, WRITE_LOCAL } = ANNOTATIONS;
  server.registerTool(
    "roblox_record_asset_permission",
    {
      title: "Record an asset publish permission",
      description: "Record publish-permission proof for one asset: whether the target user/group can grant it, whether the target experience can load it, dependency access, and Studio/save-reopen probes. Use this before strict palette commits or release cache snapshots.",
      inputSchema: publishPermissionSchema.shape,
      annotations: WRITE_LOCAL,
    },
    async (args) => {
      await store.recordPublishPermission(args.asset_id, normalizePermissionArgs(args));
      const evaluation = store.evaluatePublishPermission(args.asset_id);
      return result(
        { assetId: args.asset_id, evaluation },
        `Recorded publish permission for ${args.asset_id}: ${evaluation.passed ? "publish-ready" : "not publish-ready"} (${evaluation.errors.join("; ") || "ok"}).`
      );
    }
  );

  server.registerTool(
    "roblox_record_asset_permissions",
    {
      title: "Record many asset publish permissions",
      description: "Record many asset publish-permission proofs in one call after a Creator Dashboard export or Studio permission audit.",
      inputSchema: { permissions: z.array(publishPermissionSchema).min(1).max(500) },
      annotations: WRITE_LOCAL,
    },
    async (args) => {
      for (const permission of args.permissions) {
        await store.recordPublishPermission(permission.asset_id, normalizePermissionArgs(permission));
      }
      return text(`Recorded ${args.permissions.length} publish permission record(s).`);
    }
  );

  server.registerTool(
    "roblox_get_asset_permission",
    {
      title: "Get an asset publish permission",
      description: "Get the latest publish-permission proof and evaluated release readiness for an asset id.",
      inputSchema: {
        asset_id: z.number(),
        publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
        require_studio_probe: z.boolean().optional(),
        require_save_reopen: z.boolean().optional(),
      },
      annotations: READ_LOCAL,
    },
    async (args) => {
      const permission = store.getPublishPermission(args.asset_id);
      const evaluation = store.evaluatePublishPermission(args.asset_id, publishValidationOptions(args));
      return result({ permission, evaluation });
    }
  );

  server.registerTool(
    "roblox_validate_publish_permissions",
    {
      title: "Validate palette publish permissions",
      description: "Validate that every asset in a committed palette has publish-permission proof before headless build, Studio insertion, save/reopen, or release. Use mode='grantable_only' when the palette must contain only assets the target publisher can grant, and mode='grantable_or_open_use' when Open Use external dependencies are allowed.",
      inputSchema: {
        project: z.string().optional().describe("Palette project name (default: prophunt)."),
        publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
        require_studio_probe: z.boolean().optional(),
        require_save_reopen: z.boolean().optional(),
        format: z.enum(["text", "json"]).optional(),
      },
      annotations: READ_LOCAL,
      outputSchema: verdictOutputSchema,
    },
    async (args) => {
      const out = store.validatePalettePublishPermissions(args.project || "prophunt", publishValidationOptions(args));
      return rendered(out, args.format, formatPublishPermissionValidation);
    }
  );

  server.registerTool(
    "roblox_commit_palette",
    {
      title: "Commit an asset to the palette",
      description: "Freeze the chosen asset for a slot into the project palette (also claims it). Pass require_publish_permission=true to block assets without publish-permission proof before they can enter a release palette.",
      inputSchema: {
        project: z.string(),
        slot: z.string(),
        asset_id: z.number(),
        name: z.string().optional(),
        require_publish_permission: z.boolean().optional(),
        publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
        require_studio_probe: z.boolean().optional(),
        require_save_reopen: z.boolean().optional(),
      },
      annotations: WRITE_LOCAL,
    },
    async (args) => {
      if (args.require_publish_permission) {
        const evaluation = store.evaluatePublishPermission(args.asset_id, publishValidationOptions(args));
        if (!evaluation.passed) {
          return errorText(`Refused to commit ${args.slot} -> ${args.asset_id}: publish permission gate failed (${evaluation.errors.join("; ")}). Record proof with roblox_record_asset_permission first.`);
        }
      }
      await store.commitPalette(args.project, args.slot, args.asset_id, args.name);
      return text(`Committed ${args.slot} -> ${args.asset_id} in '${args.project}' (and claimed it).`);
    }
  );

  server.registerTool(
    "roblox_get_palette",
    {
      title: "Get the committed palette",
      description: "Return the committed palette (slot -> chosen asset id) for a project, with per-asset publish readiness.",
      inputSchema: { project: z.string() },
      annotations: READ_LOCAL,
    },
    async (args) => {
      const palette = store.getPalette(args.project);
      const entries = Object.entries(palette);
      if (!entries.length) return text(`Palette '${args.project}' is empty.`);
      const textOut = `Palette '${args.project}':\n${entries.map(([slot, value]) => {
        const evaluation = store.evaluatePublishPermission(value.assetId);
        const publish = evaluation.passed ? "publish=pass" : `publish=fail:${evaluation.errors[0] || "unknown"}`;
        return `${slot}: ${value.assetId}${value.name ? ` (${value.name})` : ""} [${publish}]`;
      }).join("\n")}`;
      return result({ project: args.project, palette }, textOut);
    }
  );
}
