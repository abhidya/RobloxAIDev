import {
  buildPlayableSpaceReviewPlan,
  formatPlayableSpaceReviewValidation,
  validatePlayableSpaceReview,
} from "./playableSpaceReview.js";

const DEFAULT_ADAPTER = "studio_mcp_proxy";
const ADAPTERS = new Set(["studio_mcp_proxy", "manual_studio_mcp"]);

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "visual_gate";
}

function vec(value) {
  const source = value || {};
  return {
    x: Number(source.x || 0),
    y: Number(source.y || 0),
    z: Number(source.z || 0),
  };
}

function vectorLua(value) {
  const v = vec(value);
  return `Vector3.new(${v.x}, ${v.y}, ${v.z})`;
}

function cameraLua(capture) {
  return [
    "local camera = workspace.CurrentCamera",
    "if not camera then return { ok = false, error = 'workspace.CurrentCamera missing' } end",
    "camera.CameraType = Enum.CameraType.Scriptable",
    `camera.CFrame = CFrame.lookAt(${vectorLua(capture.camera_position)}, ${vectorLua(capture.look_at_position)})`,
    "task.wait(0.15)",
    `return { ok = true, capture_id = ${JSON.stringify(capture.capture_id)}, camera = tostring(camera.CFrame) }`,
  ].join("\n");
}

function preflightLua(expectedPlaceNames) {
  const expected = JSON.stringify(expectedPlaceNames || []);
  return [
    `local expected = ${expected}`,
    "local placeName = game.Name",
    "local lowerPlaceName = string.lower(placeName)",
    "local match = #expected == 0",
    "for _, name in ipairs(expected) do",
    "  local key = string.lower(tostring(name))",
    "  if key ~= '' and string.find(lowerPlaceName, key, 1, true) then",
    "    match = true",
    "  end",
    "end",
    "return {",
    "  ok = match,",
    "  placeName = placeName,",
    "  placeId = game.PlaceId,",
    "  expectedPlaceNames = expected,",
    "  workspaceChildren = #workspace:GetChildren(),",
    "  hasCurrentCamera = workspace.CurrentCamera ~= nil,",
    "}",
  ].join("\n");
}

function expectedPlaceNames(targetPlace) {
  const raw = String(targetPlace || "").trim();
  if (!raw) return [];
  const base = raw.replace(/\.(rbxlx?|place)$/i, "");
  return [...new Set([raw, base].filter(Boolean))];
}

function normalizeAdapter(adapter) {
  const normalized = slugify(adapter || DEFAULT_ADAPTER);
  return ADAPTERS.has(normalized) ? normalized : DEFAULT_ADAPTER;
}

function screenshotPath(artifactRoot, captureId) {
  return `${artifactRoot}/screenshots/${captureId}.png`;
}

function captureInstruction(capture, index, artifactRoot) {
  return {
    sequence: index + 1,
    capture_id: capture.capture_id,
    space_id: capture.space_id,
    kind: capture.kind,
    quadrant: capture.quadrant || null,
    ui_state: capture.ui_state || null,
    camera_position: capture.camera_position,
    look_at_position: capture.look_at_position,
    expected_image_path: screenshotPath(artifactRoot, capture.capture_id),
    studio_mcp_steps: [
      {
        tool: "execute_luau",
        purpose: "Set the edit camera to the exact planned view.",
        code: cameraLua(capture),
      },
      {
        tool: "screen_capture",
        purpose: "Capture the current Studio viewport after the camera settles.",
        capture_id: capture.capture_id,
        suggested_output_path: screenshotPath(artifactRoot, capture.capture_id),
      },
    ],
    result_contract: {
      capture_id: capture.capture_id,
      space_id: capture.space_id,
      kind: capture.kind,
      quadrant: capture.quadrant || null,
      ui_state: capture.ui_state || null,
      image_path: screenshotPath(artifactRoot, capture.capture_id),
      passed: false,
      alt_text: "",
      findings: [],
    },
  };
}

export function buildBatchVisualGatePlan({
  project = "prophunt",
  targetPlace = "Place1.rbxl",
  reviewMode = "full",
  spaces = [],
  includeDefaults = true,
  adapter = DEFAULT_ADAPTER,
  artifactRoot,
  maxCaptures,
} = {}) {
  const reviewPlan = buildPlayableSpaceReviewPlan({
    project,
    spaces,
    includeDefaults,
    reviewMode,
    format: "json",
  });
  const root = artifactRoot || `artifacts/visual-gates/${slugify(project)}`;
  const captures = Number.isInteger(maxCaptures)
    ? reviewPlan.captures.slice(0, Math.max(1, maxCaptures))
    : reviewPlan.captures;
  const expectedNames = expectedPlaceNames(targetPlace);
  const captureBatch = captures.map((capture, index) => captureInstruction(capture, index, root));

  return {
    schema: "roblox-studio-batch-visual-gate/v1",
    project,
    target_place: targetPlace,
    review_mode: reviewPlan.review_mode,
    adapter: normalizeAdapter(adapter),
    artifact_root: root,
    agent_call_reduction: {
      model: "one MCP plan call, one wrapper execution, one validation call",
      serial_studio_steps: 1 + captureBatch.length * 2,
      reason: "Studio remains serial, but the agent no longer decides each camera and screenshot call interactively.",
    },
    studio_preflight: {
      required: true,
      expected_place_names: expectedNames,
      studio_mcp_tool: "execute_luau",
      code: preflightLua(expectedNames),
      failure_rule: "Stop the batch when the active Studio place does not match target_place.",
    },
    capture_batch: {
      serial: true,
      retry_policy: {
        max_retries_per_capture: 1,
        retry_same_camera: true,
        fail_batch_on_missing_image: true,
      },
      captures: captureBatch,
    },
    collation: {
      manifest_path: `${root}/batch-manifest.json`,
      contact_sheet_path: `${root}/contact-sheet.png`,
      accessibility_index_path: `${root}/alt-text.json`,
      required_image_fields: ["capture_id", "image_path", "alt_text", "passed"],
    },
    review_plan: {
      ...reviewPlan,
      captures,
    },
    report_template: {
      batch_id: `${slugify(project)}_${slugify(targetPlace)}`,
      project,
      target_place: targetPlace,
      active_place: null,
      preflight: {
        passed: false,
        placeName: null,
        placeId: null,
      },
      spaces_reviewed: Object.keys(reviewPlan.required_by_space || {}),
      screenshots: captureBatch.map((item) => item.result_contract),
      findings: [],
      fixes: [],
      verdict: reviewPlan.review_mode === "player_angle" ? "not_signed_off" : "not_signed_off",
    },
    validation: {
      mcp_tool: "validate_batch_visual_gate",
      rule: "The batch only passes when active-place preflight passes, every planned screenshot has an image path, and validate_playable_space_review passes.",
    },
  };
}

function normalizeScreenshotResult(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    capture_id: String(raw.capture_id || raw.captureId || raw.id || "").trim(),
    image_path: String(raw.image_path || raw.imagePath || raw.path || "").trim(),
    alt_text: String(raw.alt_text || raw.altText || "").trim(),
    passed: raw.passed !== false,
  };
}

export function validateBatchVisualGateReport(batchReport, plan) {
  const errors = [];
  const warnings = [];
  const raw = batchReport && typeof batchReport === "object" && !Array.isArray(batchReport)
    ? batchReport
    : null;
  if (!raw) {
    return { passed: false, errors: ["batch_report must be a JSON object"], warnings, playable_space: null };
  }

  const reviewReport = raw.review_report || raw.report || raw;
  const reviewPlan = plan?.review_plan || plan;
  const preflight = raw.preflight || reviewReport.preflight || {};
  if (preflight.passed !== true && preflight.ok !== true) {
    errors.push("active-place preflight did not pass");
  }

  const plannedCaptures = plan?.capture_batch?.captures || plan?.captures || [];
  const plannedIds = new Set(plannedCaptures.map((capture) => capture.capture_id).filter(Boolean));
  const screenshots = Array.isArray(reviewReport.screenshots) ? reviewReport.screenshots.map(normalizeScreenshotResult) : [];
  const screenshotIds = new Set(screenshots.map((shot) => shot.capture_id).filter(Boolean));
  if (!screenshots.length) errors.push("screenshots array is required and must not be empty");

  for (const plannedId of plannedIds) {
    if (!screenshotIds.has(plannedId)) errors.push(`planned capture '${plannedId}' is missing from the report`);
  }
  for (const screenshot of screenshots) {
    if (!screenshot.capture_id) errors.push("every batch screenshot needs capture_id");
    if (!screenshot.image_path) errors.push(`${screenshot.capture_id || "screenshot"} is missing image_path`);
    if (screenshot.passed === false) errors.push(`${screenshot.capture_id || "screenshot"} did not pass visual review`);
    if (!screenshot.alt_text) warnings.push(`${screenshot.capture_id || "screenshot"} is missing alt_text`);
  }

  const playable = validatePlayableSpaceReview(reviewReport, reviewPlan);
  for (const error of playable.errors) errors.push(error);
  for (const warning of playable.warnings) warnings.push(warning);

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    playable_space: playable,
    counts: {
      planned_captures: plannedIds.size,
      screenshots: screenshots.length,
      findings: Array.isArray(reviewReport.findings) ? reviewReport.findings.length : 0,
    },
  };
}

export function formatBatchVisualGatePlan(plan) {
  const lines = [
    `Batch visual gate for '${plan.project}'`,
    `target=${plan.target_place} mode=${plan.review_mode} adapter=${plan.adapter}`,
    `captures=${plan.capture_batch.captures.length} artifact_root=${plan.artifact_root}`,
    "",
    "Preflight:",
    `- expected place names: ${plan.studio_preflight.expected_place_names.join(", ") || "(any)"}`,
    `- failure rule: ${plan.studio_preflight.failure_rule}`,
    "",
    "Capture batch:",
  ];
  for (const capture of plan.capture_batch.captures) {
    const detail = capture.quadrant ? ` quadrant=${capture.quadrant}` : capture.ui_state ? ` ui=${capture.ui_state}` : "";
    lines.push(`- ${capture.sequence}. ${capture.capture_id}: ${capture.kind}${detail} -> ${capture.expected_image_path}`);
  }
  lines.push("", "Collation:");
  lines.push(`- manifest: ${plan.collation.manifest_path}`);
  lines.push(`- contact sheet: ${plan.collation.contact_sheet_path}`);
  lines.push(`- alt text: ${plan.collation.accessibility_index_path}`);
  lines.push("", "Validation:");
  lines.push(`- ${plan.validation.rule}`);
  return lines.join("\n");
}

export function formatBatchVisualGateValidation(result) {
  const lines = [result.passed ? "PASS batch visual gate" : "FAIL batch visual gate"];
  lines.push(`captures=${result.counts?.screenshots || 0}/${result.counts?.planned_captures || 0} findings=${result.counts?.findings || 0}`);
  for (const error of result.errors || []) lines.push(`ERROR: ${error}`);
  for (const warning of result.warnings || []) lines.push(`WARN: ${warning}`);
  if (result.playable_space) {
    lines.push("");
    lines.push(formatPlayableSpaceReviewValidation(result.playable_space));
  }
  return lines.join("\n");
}
