import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "roblox-ai-game";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const REQUIRED_TEMPLATE_PATHS = [
  "README.md",
  "CONTEXT.md",
  "default.project.json",
  ".gitignore",
  "docs/brief.md",
  "docs/e2e-loop.md",
  "asset-brain/v1/manifest.json",
  "prompts/README.md",
  "scripts/run_ai_game_dev_pocs.mjs",
  "src/shared/init.luau",
  "src/server/init.server.luau",
  "src/client/init.client.luau",
];

const DEFAULT_TEMPLATE_GATES = [
  "plan_project_template",
  "validate_project_template",
  "plan_ai_game_dev_loop",
  "plan_asset_delivery",
  "validate_asset_delivery_receipt",
  "plan_coordinator_merge",
  "validate_coordinator_merge",
  "plan_world_asset_family_sweep",
  "validate_world_asset_family_sweep",
  "plan_batch_visual_gate",
  "validate_batch_visual_gate",
  "validate_ai_game_dev_loop",
];

function templateFiles({ project, game, targetPlace, themes, outputRoot }) {
  const themeList = themes.length ? themes : ["starter lobby", "first playable room"];
  return [
    {
      path: "README.md",
      role: "operator_start",
      content: `# ${game}\n\nGenerated Roblox AI game workspace for ${project}.\n\n## First commands\n\n\`\`\`bash\nnpm --prefix asset-search-mcp test\nnode scripts/run_ai_game_dev_pocs.mjs\nnode asset-search-mcp/scripts/run-headless-coordinator.mjs --adapter lune --place work/headless-poc/${targetPlace} --out work/headless-poc/${slugify(project)}.candidate.rbxl --fragment work/headless-poc/generated-headless-marker.manifest.json --replace-existing --json\nnode asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs --plan work/visual-gate/batch-plan.json --transport mock --json\n\`\`\`\n\nKeep Roblox binaries, screenshots, credentials, and Studio state out of asset-brain metadata.\n`,
    },
    {
      path: "CONTEXT.md",
      role: "domain_language",
      content: `# ${game} Context\n\n- Project: ${project}\n- Target place: ${targetPlace}\n- Themes: ${themeList.join(", ")}\n- Asset brain: metadata only\n- Coordinator: owns referents, UniqueIds, HistoryIds, parent assignment, and final writes\n- Studio: gated validator for screenshots, playtest, and unavoidable insertion fallback\n`,
    },
    {
      path: "default.project.json",
      role: "rojo_project",
      content: `${JSON.stringify({
        name: project,
        tree: {
          $className: "DataModel",
          ReplicatedStorage: {
            Shared: {
              $path: "src/shared",
            },
          },
          ServerScriptService: {
            Server: {
              $path: "src/server",
            },
          },
          StarterPlayer: {
            StarterPlayerScripts: {
              Client: {
                $path: "src/client",
              },
            },
          },
        },
      }, null, 2)}\n`,
    },
    {
      path: ".gitignore",
      role: "safety",
      content: `work/\nartifacts/\n*.rbxl\n*.rbxlx\n*.rbxm\n*.rbxmx\n*.png\n*.jpg\n*.jpeg\n*.webp\n.env\n`,
    },
    {
      path: "docs/brief.md",
      role: "brief",
      content: `# Brief\n\nGame: ${game}\n\nThemes:\n\n${themeList.map((theme) => `- ${theme}`).join("\n")}\n\nAcceptance proof starts with a generated asset coverage plan, direct delivery receipts or Studio fallback proof, headless coordinator report, and batch visual gate report.\n`,
    },
    {
      path: "docs/e2e-loop.md",
      role: "loop_contract",
      content: `# E2E Loop\n\n1. plan_project_template and validate_project_template\n2. plan_ai_game_dev_loop\n3. preprocess_storyboard_asset_cache\n4. plan_asset_acquisition\n5. plan_asset_delivery and validate_asset_delivery_receipt\n6. plan_headless_assembly\n7. plan_coordinator_merge and validate_coordinator_merge\n8. plan_world_asset_family_sweep and validate_world_asset_family_sweep\n9. plan_batch_visual_gate and validate_batch_visual_gate\n10. validate_ai_game_dev_loop\n`,
    },
    {
      path: "asset-brain/v1/manifest.json",
      role: "asset_brain",
      content: `${JSON.stringify({
        schema: "roblox-project-asset-brain/v1",
        project,
        generatedFrom: "RobloxAIDev project template",
        policy: {
          metadataOnly: true,
          noBinaries: true,
          noScreenshots: true,
          noCredentials: true,
        },
        themes: themeList,
        pagesLayout: {
          assets: "asset-brain/v1/assets/by-id/{shard}/{assetId}.json",
          permissions: "asset-brain/v1/permissions/by-asset/{shard}/{assetId}.json",
          palettes: "asset-brain/v1/palettes/{project}.json",
        },
      }, null, 2)}\n`,
    },
    {
      path: "prompts/README.md",
      role: "prompt_lanes",
      content: `# Prompt Lanes\n\n- roblox-game-director: owns brief and acceptance proof.\n- roblox-asset-brain: owns metadata, claims, rejections, permissions.\n- roblox-headless-merge-coordinator: owns fragments, identity, and candidate place writes.\n- roblox-visual-gate-runner: owns Studio screenshot proof.\n\n## Shared Stop Rule\n\nDo not claim readiness until validate_ai_game_dev_loop passes.\n`,
    },
    {
      path: "scripts/run_ai_game_dev_pocs.mjs",
      role: "verification",
      content: `#!/usr/bin/env node\nconst proof = {\n  schema: "generated-roblox-ai-game-poc/v1",\n  project: ${JSON.stringify(project)},\n  target_place: ${JSON.stringify(targetPlace)},\n  required_commands: [\n    "npm --prefix asset-search-mcp test",\n    "node asset-search-mcp/scripts/run-asset-delivery.mjs --asset-id <id> --json",\n    "node asset-search-mcp/scripts/run-headless-coordinator.mjs --adapter lune --place <working.rbxl> --out <candidate.rbxl> --fragment <fragment.manifest.json> --json",\n    "node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs --plan <batch-plan.json> --transport mock --json"\n  ]\n};\nconsole.log(JSON.stringify(proof, null, 2));\n`,
    },
    {
      path: "src/shared/init.luau",
      role: "source_stub",
      content: "--!strict\n\nreturn {}\n",
    },
    {
      path: "src/server/init.server.luau",
      role: "source_stub",
      content: "--!strict\n\nreturn {}\n",
    },
    {
      path: "src/client/init.client.luau",
      role: "source_stub",
      content: "--!strict\n\nreturn {}\n",
    },
  ];
}

function luauArray(values) {
  return `{ ${values.map((value) => JSON.stringify(value)).join(", ")} }`;
}

function normalizedTemplateFiles(options) {
  const themes = asArray(options.themes).map(String).filter(Boolean);
  return templateFiles({ ...options, themes }).map((file) => {
    if (file.path === "src/shared/init.luau") {
      return {
        ...file,
        content: `--!strict\n\nreturn {\n\tProject = ${JSON.stringify(options.project)},\n\tThemes = ${luauArray(themes.length ? themes : ["starter lobby", "first playable room"])},\n}\n`,
      };
    }
    return file;
  });
}

export function buildProjectTemplatePlan({
  project = "roblox-ai-game",
  game = project,
  targetPlace = "Place1.rbxl",
  themes = [],
  outputRoot,
} = {}) {
  const slug = slugify(project);
  const root = outputRoot || `work/generated-games/${slug}`;
  const options = {
    project: slug,
    game,
    targetPlace,
    themes,
    outputRoot: root,
  };
  const files = normalizedTemplateFiles(options);
  return {
    schema: "roblox-ai-game-project-template-plan/v1",
    project: slug,
    game,
    target_place: targetPlace,
    output_root: root,
    files: files.map((file) => ({
      path: file.path,
      role: file.role,
      bytes: Buffer.byteLength(file.content),
    })),
    gates: [...DEFAULT_TEMPLATE_GATES],
    safety: {
      gitignore_blocks_binaries: true,
      asset_brain_metadata_only: true,
      credentials_from_environment_only: true,
    },
    materialize_command: `node asset-search-mcp/scripts/generate-project-template.mjs --project ${slug} --out-root ${root}`,
    _contents: files,
  };
}

export async function materializeProjectTemplate(plan) {
  const root = plan.output_root;
  const written = [];
  for (const file of asArray(plan._contents)) {
    const filePath = path.join(root, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
    written.push({
      path: file.path,
      role: file.role,
      bytes: Buffer.byteLength(file.content),
    });
  }
  return {
    schema: "roblox-ai-game-project-template-report/v1",
    project: plan.project,
    output_root: root,
    written,
    gates: plan.gates,
    safety: plan.safety,
    passed: true,
    blockers: [],
  };
}

export async function validateProjectTemplateReport(report, plan = null) {
  const errors = [];
  const warnings = [];
  const raw = report && typeof report === "object" && !Array.isArray(report) ? report : {};
  const expected = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  const root = raw.output_root || expected.output_root;
  if (raw.schema !== "roblox-ai-game-project-template-report/v1") {
    errors.push("report schema must be roblox-ai-game-project-template-report/v1");
  }
  if (raw.passed !== true) errors.push("template report must have passed=true");
  if (!root) errors.push("output_root is required");
  const written = asArray(raw.written);
  const expectedFiles = asArray(expected.files).length
    ? asArray(expected.files)
    : REQUIRED_TEMPLATE_PATHS.map((filePath) => ({ path: filePath }));
  const writtenPaths = new Set(written.map((file) => file.path));
  for (const file of expectedFiles) {
    if (!writtenPaths.has(file.path)) errors.push(`expected file missing from report: ${file.path}`);
  }
  const expectedGates = asArray(expected.gates).length ? asArray(expected.gates) : DEFAULT_TEMPLATE_GATES;
  for (const gate of expectedGates) {
    if (!asArray(raw.gates).includes(gate)) errors.push(`template report missing gate ${gate}`);
  }
  if (root) {
    for (const file of expectedFiles) {
      const fullPath = path.join(root, file.path);
      try {
        const info = await stat(fullPath);
        if (!info.isFile()) errors.push(`${file.path} is not a file`);
        const text = await readFile(fullPath, "utf8");
        if (!text.trim()) errors.push(`${file.path} is empty`);
      } catch {
        errors.push(`expected file not written: ${file.path}`);
      }
    }
  }
  if (!raw.safety?.asset_brain_metadata_only) errors.push("template safety must keep asset brain metadata-only");
  if (!raw.safety?.credentials_from_environment_only) errors.push("template safety must keep credentials environment-only");
  if (!writtenPaths.has(".gitignore")) warnings.push("template should include .gitignore");
  for (const blocker of asArray(raw.blockers)) errors.push(`template blocker remains: ${blocker}`);
  return {
    schema: "roblox-ai-game-project-template-validation/v1",
    passed: errors.length === 0,
    project: raw.project || expected.project || "unknown",
    errors,
    warnings,
    counts: {
      files: written.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function publicProjectTemplatePlan(plan) {
  const { _contents, ...publicPlan } = plan;
  return publicPlan;
}

export function formatProjectTemplatePlan(plan) {
  return [
    `Project template '${plan.project}'`,
    `out=${plan.output_root} files=${plan.files.length}`,
    "Gates:",
    ...plan.gates.map((gate) => `- ${gate}`),
    "Files:",
    ...plan.files.map((file) => `- ${file.path} (${file.role})`),
  ].join("\n");
}

export function formatProjectTemplateValidation(result) {
  const lines = [
    `${result.passed ? "PASS" : "FAIL"} project template '${result.project}'`,
    `files=${result.counts.files} warnings=${result.counts.warnings} errors=${result.counts.errors}`,
  ];
  if (result.errors.length) lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}
