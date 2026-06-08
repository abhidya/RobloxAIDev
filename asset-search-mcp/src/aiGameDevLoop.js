import { buildGameAssetCoverage } from "./gameCoverage.js";
import { buildHeadlessAssemblyPlan } from "./headlessPipeline.js";
import { buildBatchVisualGatePlan, validateBatchVisualGateReport } from "./visualBatchGate.js";

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "game";
}

function compactToolCall(name, args) {
  return { tool: name, arguments: args };
}

function requiredGameKitModules() {
  return [
    "RemoteBridge",
    "RateLimiter",
    "ServiceRegistry",
    "RoomQueue",
    "RoundPhaseMachine",
  ];
}

function loopArtifactPaths(project) {
  const slug = slugify(project);
  return {
    design_brief: `docs/generated-games/${slug}/brief.md`,
    asset_brain_snapshot: `asset-brain/v1/manifest.json`,
    gamekit_package: "packages/roblox-game-kit",
    headless_work_dir: `work/headless-poc/${slug}`,
    parser_writer_report: `docs/poc-results/${slug}-parser-writer-report.json`,
    studio_gate_report: `artifacts/visual-gates/${slug}/batch-report.json`,
    release_evidence: `docs/generated-games/${slug}/release-evidence.json`,
  };
}

export function buildAiGameDevLoopPlan({
  project = "roblox-ai-game",
  game = project,
  targetPlace = "Place1.rbxl",
  themes = [],
  includeDefaults = true,
  includeLobby = true,
  maxThemes = 6,
  maxFragments = 6,
  assemblyProfile,
  reviewMode = "player_angle",
  spaces = [],
  includeDefaultSpaces = true,
  artifactRoot,
  maxCaptures,
} = {}) {
  const coverage = buildGameAssetCoverage({
    game,
    themes,
    includeDefaults,
    includeLobby,
    maxThemes,
  });
  const headless = buildHeadlessAssemblyPlan({
    project,
    targetPlace,
    themes: coverage.roomThemes,
    includeLobby,
    maxFragments,
    assemblyProfile,
  });
  const visualGate = buildBatchVisualGatePlan({
    project,
    targetPlace,
    reviewMode,
    spaces,
    includeDefaults: includeDefaultSpaces,
    artifactRoot,
    maxCaptures,
  });
  const artifacts = loopArtifactPaths(project);

  return {
    schema: "roblox-ai-game-dev-loop/v1",
    project,
    game,
    target_place: targetPlace,
    objective: "Generate a Roblox game through asset brain planning, reusable GameKit source, headless Roblox file parsers/writers, and gated Studio proof.",
    principles: [
      "Studio is the gated validator, not the default construction surface.",
      "Asset brain stores metadata only; screenshots and Roblox binaries stay in artifact/scratch paths.",
      "GameKit carries reusable source modules; project adapters carry game-specific config, art policy, and UI rendering.",
      "Headless builders emit fragments and manifests; the coordinator owns identity, parent assignment, and final writes.",
      "Custom MCP tools plan and validate the loop so agents do not churn on ad hoc calls.",
    ],
    artifacts,
    custom_mcp: {
      server: "asset-search-mcp",
      planner_tool: "roblox_plan_ai_game_dev_loop",
      validator_tool: "roblox_validate_ai_game_dev_loop",
      supporting_tools: [
        "roblox_plan_project_template",
        "roblox_validate_project_template",
        "roblox_plan_game_asset_coverage",
        "roblox_preprocess_storyboard_asset_cache",
        "roblox_curate_assets",
        "roblox_claim_assets",
        "roblox_plan_asset_acquisition",
        "roblox_validate_asset_acquisition",
        "roblox_plan_asset_delivery",
        "roblox_validate_asset_delivery_receipt",
        "roblox_record_inspection",
        "roblox_commit_palette",
        "roblox_validate_publish_permissions",
        "roblox_plan_world_asset_family_sweep",
        "roblox_validate_world_asset_family_sweep",
        "roblox_plan_headless_assembly",
        "roblox_validate_fragment_manifest",
        "roblox_plan_coordinator_merge",
        "roblox_validate_coordinator_merge",
        "roblox_plan_batch_visual_gate",
        "roblox_validate_batch_visual_gate",
      ],
    },
    studio_adapter: {
      cli: "node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs",
      transports: ["mock", "studio_mcp_stdio"],
      purpose: "Consume a batch visual gate plan, execute Studio MCP steps serially, collate screenshots/alt text/execution logs, and return the report validated by roblox_validate_batch_visual_gate.",
    },
    phases: [
      {
        id: "brief_and_coverage",
        owner: "roblox-game-director",
        goal: "Convert the game idea into slots and acceptance screenshots.",
        tool_calls: [
          compactToolCall("roblox_plan_game_asset_coverage", {
            game,
            themes: coverage.roomThemes,
            include_defaults: false,
            include_lobby: includeLobby,
            format: "json",
          }),
        ],
        outputs: [artifacts.design_brief, "coverage slots"],
      },
      {
        id: "asset_brain",
        owner: "roblox-asset-brain",
        goal: "Warm/merge metadata, curate candidates, claim shortlists, and commit only proven palette assets.",
        tool_calls: [
          compactToolCall("roblox_preprocess_storyboard_asset_cache", {
            project,
            game,
            themes: coverage.roomThemes,
            include_defaults: false,
            include_lobby: includeLobby,
            warm_search_cache: false,
            format: "json",
          }),
          compactToolCall("roblox_curate_assets", {
            project,
            slots: coverage.slots.slice(0, 12).map((slot) => ({ slot: slot.slot, query: slot.query })),
            per_slot: 3,
            extensive: true,
          }),
          compactToolCall("roblox_plan_asset_acquisition", {
            project,
            slot: "<claimed-slot>",
            query: "<claimed-slot-query>",
            target_place: targetPlace,
            delivery_mode: "direct_or_studio_fallback",
            format: "json",
          }),
          compactToolCall("roblox_plan_asset_delivery", {
            project,
            slot: "<claimed-slot>",
            asset_id: "<claimed-asset-id>",
            format: "json",
          }),
        ],
        outputs: [artifacts.asset_brain_snapshot, "claims", "rejections", "asset acquisition plans", "inspection queue"],
      },
      {
        id: "gamekit_source",
        owner: "roblox-game-kit-librarian",
        goal: "Adopt reusable source modules before writing project-specific gameplay.",
        modules: requiredGameKitModules(),
        commands: [
          "node scripts/inventory_reusable_game_libraries.mjs",
          "npm --prefix asset-search-mcp run test:game-kit",
          "rojo build packages/roblox-game-kit/default.project.json -o /tmp/RobloxGameKit.rbxlx",
        ],
        outputs: [artifacts.gamekit_package, "project adapter stubs"],
      },
      {
        id: "parser_writer_generation",
        owner: "roblox-headless-merge-coordinator",
        goal: "Use Roblox file parsers/writers to produce a candidate place before Studio opens.",
        parser_writers: [
          {
            name: "Lune @lune/roblox",
            role: "POC and Luau-native place/model read-mutate-write coordinator",
            commands: [
              "lune run scripts/headless_place_insert_poc.luau",
              "lune run scripts/headless_fragment_merge.luau --place <working.rbxl> --out <candidate.rbxl> --fragment <fragment.manifest.json> --replace-existing",
              "lune run scripts/headless_place_verify_poc.luau <candidate.rbxl>",
            ],
          },
          {
            name: "Rojo",
            role: "Deterministic source tree to rbxlx/rbxmx assembly for project-owned content",
            commands: [
              "rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx",
              "rojo build packages/roblox-game-kit/default.project.json -o /tmp/RobloxGameKit.rbxlx",
            ],
          },
          {
            name: "rbx-dom",
            role: "Long-term production adapter and binary/XML format authority",
            commands: [
              "Future adapter: validate deterministic referent/UniqueId rewrites against rbx-dom semantics",
            ],
          },
        ],
        headless_plan: headless,
        outputs: [artifacts.headless_work_dir, artifacts.parser_writer_report],
      },
      {
        id: "gated_studio_batch",
        owner: "roblox-visual-gate-runner",
        goal: "Run Studio only after headless validation, then capture all planned screenshots as one batch.",
        studio_policy: {
          active_place_preflight_required: true,
          stop_when_place_mismatch: true,
          serial_screenshots: true,
          no_parallel_studio_agents: true,
        },
        commands: [
          "node asset-search-mcp/scripts/run-studio-batch-visual-gate.mjs --plan <batch-plan.json> --active-place <target_place> --json",
        ],
        batch_visual_gate_plan: visualGate,
        outputs: [artifacts.studio_gate_report],
      },
      {
        id: "release_verification",
        owner: "roblox-release-verifier",
        goal: "Validate every proof bundle before claiming the game is ready.",
        required_gates: [
          "asset_brain",
          "asset_delivery_or_studio_fallback",
          "gamekit_build",
          "parser_writer_generation",
          "fragment_manifest_validation",
          "batch_visual_gate",
          "publish_permission_or_explicit_nonrelease_scope",
        ],
        outputs: [artifacts.release_evidence],
      },
    ],
    coverage,
    headless_assembly_plan: headless,
    batch_visual_gate_plan: visualGate,
    validation_contract: {
      schema: "roblox-ai-game-dev-loop-report/v1",
      required_gate_ids: [
        "asset_brain",
        "gamekit_build",
        "parser_writer_generation",
        "fragment_manifest_validation",
        "custom_mcp_contract",
        "batch_visual_gate",
      ],
      validation_tool: "roblox_validate_ai_game_dev_loop",
    },
  };
}

function gatePassed(report, gateId) {
  const gate = report?.gates?.[gateId];
  return gate && gate.passed === true;
}

function gateArtifact(report, gateId) {
  const gate = report?.gates?.[gateId];
  return String(gate?.artifact_path || gate?.artifact || "").trim();
}

export function validateAiGameDevLoopReport(report, plan = null) {
  const errors = [];
  const warnings = [];
  const raw = report && typeof report === "object" && !Array.isArray(report) ? report : {};
  const expectedPlan = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : null;
  const requiredGateIds = expectedPlan?.validation_contract?.required_gate_ids || [
    "asset_brain",
    "gamekit_build",
    "parser_writer_generation",
    "fragment_manifest_validation",
    "custom_mcp_contract",
    "batch_visual_gate",
  ];

  if (raw.schema && raw.schema !== "roblox-ai-game-dev-loop-report/v1") {
    errors.push(`report schema must be roblox-ai-game-dev-loop-report/v1, got ${raw.schema}`);
  }
  if (!raw.gates || typeof raw.gates !== "object") {
    errors.push("gates object is required");
  }
  for (const gateId of requiredGateIds) {
    if (!gatePassed(raw, gateId)) {
      errors.push(`gate '${gateId}' must pass`);
    }
  }

  for (const gateId of ["asset_brain", "parser_writer_generation", "batch_visual_gate"]) {
    if (raw.gates?.[gateId] && !gateArtifact(raw, gateId)) {
      warnings.push(`gate '${gateId}' should record an artifact_path`);
    }
  }

  const customTools = raw.gates?.custom_mcp_contract?.tools || raw.custom_mcp_tools || [];
  for (const requiredTool of [
    "roblox_plan_ai_game_dev_loop",
    "roblox_validate_ai_game_dev_loop",
    "roblox_plan_project_template",
    "roblox_validate_project_template",
    "roblox_plan_asset_acquisition",
    "roblox_validate_asset_acquisition",
    "roblox_plan_asset_delivery",
    "roblox_validate_asset_delivery_receipt",
    "roblox_plan_world_asset_family_sweep",
    "roblox_validate_world_asset_family_sweep",
    "roblox_plan_batch_visual_gate",
    "roblox_validate_batch_visual_gate",
    "roblox_plan_coordinator_merge",
    "roblox_validate_coordinator_merge",
  ]) {
    if (!customTools.includes(requiredTool)) {
      errors.push(`custom MCP proof must include tool '${requiredTool}'`);
    }
  }

  const batchReport = raw.gates?.batch_visual_gate?.batch_report || raw.batch_visual_gate_report;
  const batchPlan = raw.gates?.batch_visual_gate?.plan || expectedPlan?.batch_visual_gate_plan;
  if (!batchReport) {
    errors.push("batch_visual_gate.batch_report is required");
  } else {
    const batchValidation = validateBatchVisualGateReport(batchReport, batchPlan);
    if (!batchValidation.passed) {
      for (const error of batchValidation.errors) {
        errors.push(`batch visual gate: ${error}`);
      }
    }
  }

  const blockers = Array.isArray(raw.open_blockers) ? raw.open_blockers : [];
  if (blockers.length) {
    errors.push(`open blockers remain: ${blockers.join("; ")}`);
  }

  return {
    schema: "roblox-ai-game-dev-loop-validation/v1",
    passed: errors.length === 0,
    project: raw.project || expectedPlan?.project || "unknown",
    counts: {
      required_gates: requiredGateIds.length,
      gates_passed: requiredGateIds.filter((gateId) => gatePassed(raw, gateId)).length,
      warnings: warnings.length,
      errors: errors.length,
    },
    errors,
    warnings,
  };
}

export function formatAiGameDevLoopPlan(plan) {
  const lines = [
    `Roblox AI game-dev loop for '${plan.project}'`,
    `target=${plan.target_place} phases=${plan.phases.length}`,
    "",
    "Principles:",
    ...plan.principles.map((item) => `- ${item}`),
    "",
    "Custom MCP:",
    `- planner=${plan.custom_mcp.planner_tool}`,
    `- validator=${plan.custom_mcp.validator_tool}`,
    `- supporting=${plan.custom_mcp.supporting_tools.join(", ")}`,
    "",
    "Phases:",
  ];
  for (const phase of plan.phases) {
    lines.push(`- ${phase.id}: ${phase.goal}`);
  }
  lines.push("", "Parser/writer path:");
  for (const adapter of plan.phases.find((phase) => phase.id === "parser_writer_generation")?.parser_writers || []) {
    lines.push(`- ${adapter.name}: ${adapter.role}`);
  }
  lines.push("", "Studio gate:");
  lines.push(`- adapter=${plan.studio_adapter.cli}`);
  lines.push(`- captures=${plan.batch_visual_gate_plan.capture_batch.captures.length}`);
  lines.push(`- artifact_root=${plan.batch_visual_gate_plan.artifact_root}`);
  return lines.join("\n");
}

export function formatAiGameDevLoopValidation(result) {
  const lines = [
    `${result.passed ? "PASS" : "FAIL"} Roblox AI game-dev loop '${result.project}'`,
    `gates=${result.counts.gates_passed}/${result.counts.required_gates} warnings=${result.counts.warnings} errors=${result.counts.errors}`,
  ];
  if (result.errors.length) {
    lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  }
  if (result.warnings.length) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}
