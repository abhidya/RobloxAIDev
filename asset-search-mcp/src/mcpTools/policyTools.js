import { z } from "zod";

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

function formatPublishPermissionValidation(result) {
  const head = `${result.passed ? "PASS" : "FAIL"} publish permissions for '${result.project}' mode=${result.mode}`;
  const counts = `palette=${result.counts.paletteAssets} passed=${result.counts.passed} failed=${result.counts.failed} missing=${result.counts.missing}`;
  const lines = [head, counts];
  if (result.errors.length) {
    lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  }
  if (result.warnings.length) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

export function registerPolicyTools(server, { store, text }) {
  server.tool(
    "record_asset_permission",
    "Record publish-permission proof for one asset: whether the target user/group can grant it, whether the target experience can load it, dependency access, and Studio/save-reopen probes. Use this before strict palette commits or release cache snapshots.",
    publishPermissionSchema.shape,
    async (args) => {
      await store.recordPublishPermission(args.asset_id, normalizePermissionArgs(args));
      const evaluation = store.evaluatePublishPermission(args.asset_id);
      return text(`Recorded publish permission for ${args.asset_id}: ${evaluation.passed ? "publish-ready" : "not publish-ready"} (${evaluation.errors.join("; ") || "ok"}).`);
    }
  );

  server.tool(
    "record_asset_permissions",
    "Record many asset publish-permission proofs in one call after a Creator Dashboard export or Studio permission audit.",
    { permissions: z.array(publishPermissionSchema).min(1).max(500) },
    async (args) => {
      for (const permission of args.permissions) {
        await store.recordPublishPermission(permission.asset_id, normalizePermissionArgs(permission));
      }
      return text(`Recorded ${args.permissions.length} publish permission record(s).`);
    }
  );

  server.tool(
    "get_asset_permission",
    "Get the latest publish-permission proof and evaluated release readiness for an asset id.",
    {
      asset_id: z.number(),
      publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
      require_studio_probe: z.boolean().optional(),
      require_save_reopen: z.boolean().optional(),
    },
    async (args) => {
      const permission = store.getPublishPermission(args.asset_id);
      const evaluation = store.evaluatePublishPermission(args.asset_id, publishValidationOptions(args));
      return text(JSON.stringify({ permission, evaluation }, null, 2));
    }
  );

  server.tool(
    "validate_publish_permissions",
    "Validate that every asset in a committed palette has publish-permission proof before headless build, Studio insertion, save/reopen, or release. Use mode='grantable_only' when the palette must contain only assets the target publisher can grant, and mode='grantable_or_open_use' when Open Use external dependencies are allowed.",
    {
      project: z.string().optional().describe("Palette project name (default: prophunt)."),
      publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
      require_studio_probe: z.boolean().optional(),
      require_save_reopen: z.boolean().optional(),
      format: z.enum(["text", "json"]).optional(),
    },
    async (args) => {
      const result = store.validatePalettePublishPermissions(args.project || "prophunt", publishValidationOptions(args));
      return text(args.format === "json" ? JSON.stringify(result, null, 2) : formatPublishPermissionValidation(result));
    }
  );

  server.tool(
    "commit_palette",
    "Freeze the chosen asset for a slot into the project palette (also claims it). Pass require_publish_permission=true to block assets without publish-permission proof before they can enter a release palette.",
    {
      project: z.string(),
      slot: z.string(),
      asset_id: z.number(),
      name: z.string().optional(),
      require_publish_permission: z.boolean().optional(),
      publish_permission_mode: z.enum(["grantable_only", "grantable_or_open_use"]).optional(),
      require_studio_probe: z.boolean().optional(),
      require_save_reopen: z.boolean().optional(),
    },
    async (args) => {
      if (args.require_publish_permission) {
        const evaluation = store.evaluatePublishPermission(args.asset_id, publishValidationOptions(args));
        if (!evaluation.passed) {
          return text(`Refused to commit ${args.slot} -> ${args.asset_id}: publish permission gate failed (${evaluation.errors.join("; ")}).`);
        }
      }
      await store.commitPalette(args.project, args.slot, args.asset_id, args.name);
      return text(`Committed ${args.slot} -> ${args.asset_id} in '${args.project}' (and claimed it).`);
    }
  );

  server.tool(
    "get_palette",
    "Return the committed palette (slot -> chosen asset id) for a project.",
    { project: z.string() },
    async (args) => {
      const palette = store.getPalette(args.project);
      const entries = Object.entries(palette);
      if (!entries.length) return text(`Palette '${args.project}' is empty.`);
      return text(`Palette '${args.project}':\n${entries.map(([slot, value]) => {
        const evaluation = store.evaluatePublishPermission(value.assetId);
        const publish = evaluation.passed ? "publish=pass" : `publish=fail:${evaluation.errors[0] || "unknown"}`;
        return `${slot}: ${value.assetId}${value.name ? ` (${value.name})` : ""} [${publish}]`;
      }).join("\n")}`);
    }
  );
}
