import { buildGameAssetCoverage } from "./gameCoverage.js";

export const DANGEROUS_SCRIPT_PATTERNS = [
  {
    id: "numeric_require",
    label: "require(assetId)",
    regex: /\brequire\s*\(\s*\d{5,}\s*\)/i,
    reason: "loads opaque third-party module code at runtime",
  },
  {
    id: "insert_service_load_asset",
    label: "InsertService:LoadAsset",
    regex: /\bInsertService\s*:\s*LoadAsset\s*\(/i,
    reason: "pulls new assets during runtime instead of from the reviewed fragment",
  },
  {
    id: "loadstring",
    label: "loadstring",
    regex: /\bloadstring\s*\(/i,
    reason: "executes dynamic code that cannot be reviewed in the fragment",
  },
  {
    id: "http_get_post",
    label: "HttpService request",
    regex: /\bHttpService\s*:\s*(GetAsync|PostAsync|RequestAsync)\s*\(/i,
    reason: "performs external network calls from imported content",
  },
];

export const OPEN_CLOUD_ENDPOINTS = [
  {
    name: "Creator Store search",
    method: "POST",
    url: "https://apis.roblox.com/toolbox-service/v2/assets:search",
    auth: "Roblox-authenticated client context; respect creator permissions and rate limits",
    purpose: "Find model/plugin/audio/image candidates before claiming and inspecting them.",
  },
  {
    name: "Toolbox asset metadata",
    method: "GET",
    url: "https://apis.roblox.com/toolbox-service/v2/assets/{assetId}",
    auth: "Roblox-authenticated client context",
    purpose: "Fetch current catalog metadata for a shortlisted Creator Store asset.",
  },
  {
    name: "Asset Delivery",
    method: "GET",
    url: "https://assetdelivery.roblox.com/v1/asset/?id={assetId}",
    auth: "Cookie/session when the asset requires ownership or permission",
    purpose: "Download model content as the same serialized rbxm/rbxl family parsed by Lune/rbx-dom.",
  },
  {
    name: "Open Cloud Assets",
    method: "POST/PATCH",
    url: "https://apis.roblox.com/assets/v1/assets",
    auth: "Open Cloud API key with asset scopes",
    purpose: "Upload or update owned assets used by generated games.",
  },
  {
    name: "Open Cloud place publish",
    method: "POST",
    url: "https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published",
    auth: "Open Cloud API key with universe/place publish scope",
    purpose: "Publish a generated rbxl after local validation and visual signoff.",
  },
];

export const VALIDATION_COMMANDS = [
  "lune run scripts/headless_place_insert_poc.luau",
  "lune run scripts/headless_place_verify_poc.luau work/headless-poc/Place1.headless-mutated.rbxl",
  "rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx",
  "cd asset-search-mcp && npm run gate:prop-hunt",
];

export const FRAGMENT_CONTRACT = {
  version: "roblox-fragment-manifest/v1",
  required_fields: [
    "fragment_id",
    "target_parent",
    "order_key",
    "single_root or roots[1]",
    "source_digest",
    "asset_ids",
    "identity_policy.referents",
    "identity_policy.unique_ids",
  ],
  identity_policy: {
    referents: "coordinator_remap",
    unique_ids: "strip | coordinator_generate",
    history_ids: "strip",
    parent_links: "coordinator_assigns_after_import",
  },
  disallowed_script_patterns: DANGEROUS_SCRIPT_PATTERNS.map((pattern) => ({
    id: pattern.id,
    label: pattern.label,
    reason: pattern.reason,
  })),
};

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "fragment";
}

function clampInt(value, min, max, fallback) {
  const n = Number.isInteger(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

function uniqueThemes(themes) {
  const seen = new Set();
  const out = [];
  for (const theme of themes || []) {
    const normalized = String(theme || "").trim();
    const key = normalized.toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

function coverageForFragment(coverage, group, theme = null) {
  return coverage.slots
    .filter((slot) => slot.group === group && (theme == null || slot.theme === theme))
    .map((slot) => ({ slot: slot.slot, query: slot.query, purpose: slot.purpose }));
}

function buildWorkPackets({ project, themes, includeLobby, maxFragments, coverage }) {
  const packets = [];
  let order = 0;
  if (includeLobby) {
    packets.push({
      fragment_id: `${slugify(project)}_lobby_shell`,
      role: "lobby-shell",
      target_parent: "Workspace",
      order_key: String(order++).padStart(3, "0") + "-lobby",
      output_model: `fragments/${slugify(project)}_lobby_shell.rbxm`,
      output_manifest: `fragments/${slugify(project)}_lobby_shell.manifest.json`,
      asset_slots: coverageForFragment(coverage, "lobby"),
      deliverables: [
        "One root Model containing lobby visual affordances only.",
        "Portal/NPC/shop/leaderboard assets arranged as an editable subtree.",
        "Manifest declaring asset ids, digest, identity policy, and any external anchors.",
      ],
    });
  }

  for (const theme of themes) {
    if (packets.length >= maxFragments) break;
    const slug = slugify(theme);
    packets.push({
      fragment_id: `${slugify(project)}_${slug}_room`,
      role: "themed-room",
      theme,
      target_parent: "Workspace.PropHuntRooms",
      order_key: String(order++).padStart(3, "0") + `-${slug}`,
      output_model: `fragments/${slug}.rbxm`,
      output_manifest: `fragments/${slug}.manifest.json`,
      asset_slots: coverageForFragment(coverage, "room", theme),
      deliverables: [
        "One root Model containing room shell, setpieces, hideables, host, portal marker, and ambience references.",
        "No gameplay authority scripts inside imported asset content unless explicitly reviewed.",
        "Manifest declaring the room spawn anchor and any references to shared lobby/session folders.",
      ],
    });
  }

  return packets.slice(0, maxFragments);
}

export function buildHeadlessAssemblyPlan({
  project = "prophunt",
  targetPlace = "Place1.rbxl",
  themes = [],
  includeLobby = true,
  maxFragments = 6,
} = {}) {
  const chosenThemes = uniqueThemes(themes).length
    ? uniqueThemes(themes)
    : ["medieval market", "sci-fi lab", "cozy cabin", "underwater reef", "space station"];
  const safeMax = clampInt(maxFragments, 1, 12, 6);
  const coverage = buildGameAssetCoverage({
    game: project,
    themes: chosenThemes,
    includeDefaults: false,
    includeLobby,
    maxThemes: safeMax,
  });
  const packets = buildWorkPackets({
    project,
    themes: chosenThemes,
    includeLobby,
    maxFragments: safeMax,
    coverage,
  });

  return {
    project,
    target_place: targetPlace,
    working_copy: `work/rojo-working/${targetPlace.replace(/\.rbxlx?$/i, "")}.working.rbxl`,
    rojo_build_output: "work/rojo-working/Place1.rojo-built.rbxlx",
    mode: "headless-fragment-fanout",
    endpoints: OPEN_CLOUD_ENDPOINTS,
    fragment_contract: FRAGMENT_CONTRACT,
    agent_work_packets: packets,
    coordinator_merge_steps: [
      "Copy the target place to a scratch rbxl before mutation.",
      "For each packet, validate the manifest before loading the rbxm subtree.",
      "Deserialize with Lune/rbx-dom and reject fragments with unresolved external references.",
      "Strip or regenerate UniqueId/HistoryId and remap all referents in coordinator-owned memory.",
      "Parent exactly one root model into the declared target_parent in deterministic order_key order.",
      "Resolve declared anchors by path/name after parenting; never trust raw parent links from agents.",
      "Write the merged rbxl, run Rojo/Lune validation, then open in Studio only for visual/player QA.",
    ],
    validation_commands: VALIDATION_COMMANDS,
    studio_gate: [
      "Use StudioMCP for final insertion checks only when direct file validation passes.",
      "Capture lobby, portal, and each room from player-height quadrant views.",
      "Run validate_prop_hunt_gate before claiming the asset palette is ready.",
    ],
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdentityPolicy(manifest) {
  const raw = asObject(manifest.identity_policy) || asObject(manifest.identityPolicy) || {};
  const uniqueIds = stringField(raw.unique_ids || raw.unique_id_policy || manifest.unique_id_policy) || "strip";
  const referents = stringField(raw.referents || raw.referent_policy || manifest.referents_remapped_by) || "";
  const historyIds = stringField(raw.history_ids || raw.history_id_policy || manifest.history_id_policy) || "strip";
  return {
    referents,
    unique_ids: uniqueIds,
    history_ids: historyIds,
  };
}

function collectScriptSources(manifest) {
  const sources = [];
  const scripts = Array.isArray(manifest.scripts) ? manifest.scripts : [];
  for (const script of scripts) {
    if (typeof script === "string") {
      sources.push({ label: "scripts[]", source: script });
    } else if (asObject(script) && typeof script.source === "string") {
      sources.push({ label: script.path || script.name || "scripts[].source", source: script.source });
    }
  }
  const scriptSources = asObject(manifest.script_sources) || asObject(manifest.scriptSources);
  if (scriptSources) {
    for (const [label, source] of Object.entries(scriptSources)) {
      if (typeof source === "string") sources.push({ label, source });
    }
  }
  return sources;
}

function approvedPatternIds(manifest) {
  const safety = asObject(manifest.safety) || {};
  const ids = [
    ...(Array.isArray(manifest.approved_dangerous_patterns) ? manifest.approved_dangerous_patterns : []),
    ...(Array.isArray(safety.approved_dangerous_patterns) ? safety.approved_dangerous_patterns : []),
  ];
  return new Set(ids.map(String));
}

export function validateFragmentManifest(manifest) {
  const errors = [];
  const warnings = [];
  const input = asObject(manifest);
  if (!input) {
    return {
      passed: false,
      errors: ["manifest must be a JSON object"],
      warnings,
      normalized: null,
    };
  }

  const fragmentId = stringField(input.fragment_id || input.fragmentId);
  const targetParent = stringField(input.target_parent || input.targetParent);
  const orderKey = stringField(input.order_key || input.orderKey);
  const sourceDigest = stringField(input.source_digest || input.sourceDigest);
  const roots = Array.isArray(input.roots) ? input.roots : [];
  const singleRoot = input.single_root === true || input.singleRoot === true || roots.length === 1;
  const assetIds = Array.isArray(input.asset_ids) ? input.asset_ids : Array.isArray(input.assetIds) ? input.assetIds : null;
  const identityPolicy = normalizeIdentityPolicy(input);

  if (!fragmentId) errors.push("fragment_id is required");
  if (!targetParent) errors.push("target_parent is required");
  if (!orderKey) errors.push("order_key is required");
  if (!sourceDigest) {
    errors.push("source_digest is required");
  } else if (!/^sha(1|256|512):/i.test(sourceDigest)) {
    warnings.push("source_digest should include an algorithm prefix such as sha256:");
  }
  if (!singleRoot) errors.push("fragment must declare single_root=true or exactly one root in roots[]");
  if (!assetIds) {
    errors.push("asset_ids array is required, even when empty for generated structural fragments");
  } else {
    const badAssets = assetIds.filter((id) => !(Number.isInteger(id) || (typeof id === "string" && /^\d+$/.test(id))));
    if (badAssets.length) errors.push(`asset_ids must contain numeric ids only: ${badAssets.join(", ")}`);
    if (assetIds.length === 0) warnings.push("asset_ids is empty; generated-only fragments still need source review");
  }

  if (identityPolicy.referents !== "coordinator_remap" && identityPolicy.referents !== "coordinator") {
    errors.push("identity_policy.referents must be coordinator_remap");
  }
  if (!["strip", "coordinator_generate"].includes(identityPolicy.unique_ids)) {
    errors.push("identity_policy.unique_ids must be strip or coordinator_generate");
  }
  if (identityPolicy.history_ids && !["strip", "coordinator_generate"].includes(identityPolicy.history_ids)) {
    errors.push("identity_policy.history_ids must be strip or coordinator_generate");
  }
  if (input.preserve_referents === true || input.raw_referents || input.referent_map || input.referents) {
    errors.push("raw referents/referent maps must not be preserved; coordinator remaps them after deserialize");
  }

  const externalAnchors = Array.isArray(input.external_anchors)
    ? input.external_anchors
    : Array.isArray(input.external_references)
      ? input.external_references
      : [];
  if ((input.uses_external_refs === true || input.usesExternalRefs === true) && externalAnchors.length === 0) {
    errors.push("external references must be declared in external_anchors/external_references");
  }

  const approved = approvedPatternIds(input);
  for (const script of collectScriptSources(input)) {
    for (const pattern of DANGEROUS_SCRIPT_PATTERNS) {
      if (pattern.regex.test(script.source)) {
        const message = `${script.label} matches ${pattern.label}: ${pattern.reason}`;
        if (approved.has(pattern.id)) {
          warnings.push(`approved dangerous script pattern: ${message}`);
        } else {
          errors.push(message);
        }
      }
    }
  }

  const normalized = {
    version: stringField(input.version) || FRAGMENT_CONTRACT.version,
    fragment_id: fragmentId,
    target_parent: targetParent,
    order_key: orderKey,
    single_root: singleRoot,
    roots: roots.length ? roots : input.root_name ? [input.root_name] : [],
    source_digest: sourceDigest,
    asset_ids: assetIds || [],
    external_anchors: externalAnchors,
    identity_policy: {
      referents: identityPolicy.referents || "coordinator_remap",
      unique_ids: identityPolicy.unique_ids,
      history_ids: identityPolicy.history_ids,
    },
  };

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

export function formatHeadlessAssemblyPlan(plan) {
  const lines = [
    `Headless assembly plan for '${plan.project}'`,
    `Target place: ${plan.target_place}`,
    `Working copy: ${plan.working_copy}`,
    `Rojo build output: ${plan.rojo_build_output}`,
    "",
    "Coordinator merge steps:",
  ];
  for (const step of plan.coordinator_merge_steps) lines.push(`- ${step}`);
  lines.push("", "Agent work packets:");
  for (const packet of plan.agent_work_packets) {
    lines.push("", `## ${packet.fragment_id}`);
    lines.push(`- role: ${packet.role}${packet.theme ? ` (${packet.theme})` : ""}`);
    lines.push(`- target_parent: ${packet.target_parent}`);
    lines.push(`- order_key: ${packet.order_key}`);
    lines.push(`- outputs: ${packet.output_model}, ${packet.output_manifest}`);
    lines.push("- asset slots:");
    for (const slot of packet.asset_slots) lines.push(`  - ${slot.slot}: ${slot.query}`);
  }
  lines.push("", "Manifest contract:");
  for (const field of plan.fragment_contract.required_fields) lines.push(`- required: ${field}`);
  lines.push(`- referents: ${plan.fragment_contract.identity_policy.referents}`);
  lines.push(`- unique ids: ${plan.fragment_contract.identity_policy.unique_ids}`);
  lines.push("", "Headless validation commands:");
  for (const command of plan.validation_commands) lines.push(`- ${command}`);
  lines.push("", "External endpoints to keep separated from Studio:");
  for (const endpoint of plan.endpoints) lines.push(`- ${endpoint.method} ${endpoint.url} (${endpoint.name})`);
  lines.push("", "Studio visual gate:");
  for (const gate of plan.studio_gate) lines.push(`- ${gate}`);
  return lines.join("\n");
}

export function formatFragmentManifestReport(result) {
  const lines = [result.passed ? "PASS fragment manifest" : "FAIL fragment manifest"];
  for (const error of result.errors) lines.push(`ERROR: ${error}`);
  for (const warning of result.warnings) lines.push(`WARN: ${warning}`);
  if (result.normalized) {
    lines.push("");
    lines.push(JSON.stringify(result.normalized, null, 2));
  }
  return lines.join("\n");
}
