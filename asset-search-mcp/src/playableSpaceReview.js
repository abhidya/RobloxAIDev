import { createFindings, passLabel, renderFindings, sealVerdict } from "./proofBundle.js";

const DEFAULT_RUBRIC = [
  "theme_accuracy",
  "asset_density",
  "orientation",
  "scale",
  "navigation",
  "collision_playability",
  "hide_and_seek_quality",
  "multiplayer_flow",
  "ui_ux",
  "performance_safety",
  "legacy_asset_pollution",
];

const DEFAULT_SPACES = [
  {
    id: "lobby",
    name: "Lobby Spawn And Portals",
    type: "lobby",
    center: { x: 0, y: 3, z: -36 },
    size: { x: 64, y: 10, z: 34 },
    entry: { x: 0, y: 7, z: -56 },
    look_at: { x: 0, y: 3, z: -24 },
    quadrants: ["spawn", "medieval_portal", "scifi_portal", "cabin_portal"],
    ui_states: ["lobby", "queue_prompt"],
  },
  {
    id: "medieval_market",
    name: "Medieval Market",
    type: "prop_hunt_room",
    center: { x: -107, y: 3, z: 20 },
    size: { x: 116, y: 22, z: 77 },
    entry: { x: -154, y: 7, z: -48 },
    look_at: { x: -105, y: 3, z: 6 },
    quadrants: ["nw", "ne", "sw", "se"],
    ui_states: ["room_queue", "hiding", "hunting", "round_end"],
  },
  {
    id: "scifi_lab",
    name: "Sci-Fi Lab",
    type: "prop_hunt_room",
    center: { x: 0, y: 3, z: 20 },
    size: { x: 92, y: 22, z: 77 },
    entry: { x: -35, y: 7, z: 8 },
    look_at: { x: 5, y: 4, z: 42 },
    quadrants: ["nw", "ne", "sw", "se"],
    ui_states: ["room_queue", "hiding", "hunting", "round_end"],
  },
  {
    id: "cozy_cabin",
    name: "Cozy Cabin",
    type: "prop_hunt_room",
    center: { x: 108, y: 3, z: 8 },
    size: { x: 106, y: 22, z: 77 },
    entry: { x: 60, y: 7, z: -52 },
    look_at: { x: 110, y: 4, z: 12 },
    quadrants: ["nw", "ne", "sw", "se"],
    ui_states: ["room_queue", "hiding", "hunting", "round_end"],
  },
];

const REQUIRED_CAPTURE_KINDS = [
  "overhead",
  "entry",
  "player_height_quadrant",
  "reverse",
];

const PLAYER_ANGLE_CAPTURE_KINDS = [
  "player_height_quadrant",
];

const REVIEW_MODES = new Set(["full", "player_angle"]);

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "space";
}

function normalizeReviewMode(value) {
  const mode = slugify(value || "full");
  return REVIEW_MODES.has(mode) ? mode : "full";
}

function vec(value, fallback) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: Number(source?.x ?? fallback.x),
    y: Number(source?.y ?? fallback.y),
    z: Number(source?.z ?? fallback.z),
  };
}

function normalizeSpace(space, index) {
  const id = slugify(space.id || space.name || `space_${index + 1}`);
  const center = vec(space.center, { x: index * 80, y: 3, z: 0 });
  const size = vec(space.size, { x: 60, y: 20, z: 60 });
  const entry = vec(space.entry, { x: center.x, y: center.y + 4, z: center.z - size.z / 2 - 14 });
  const lookAt = vec(space.look_at || space.lookAt, center);
  const quadrants = Array.isArray(space.quadrants) && space.quadrants.length
    ? space.quadrants.map((q) => slugify(q))
    : ["nw", "ne", "sw", "se"];
  const uiStates = Array.isArray(space.ui_states || space.uiStates)
    ? (space.ui_states || space.uiStates).map((state) => slugify(state))
    : [];
  return {
    id,
    name: String(space.name || id),
    type: String(space.type || "playable_space"),
    center,
    size,
    entry,
    look_at: lookAt,
    quadrants,
    ui_states: uiStates,
  };
}

function cameraForQuadrant(space, quadrant) {
  const sx = space.size.x / 2;
  const sz = space.size.z / 2;
  const map = {
    nw: { x: -0.42, z: -0.42 },
    ne: { x: 0.42, z: -0.42 },
    sw: { x: -0.42, z: 0.42 },
    se: { x: 0.42, z: 0.42 },
    spawn: { x: 0, z: -0.42 },
    medieval_portal: { x: -0.32, z: -0.08 },
    scifi_portal: { x: 0, z: -0.08 },
    cabin_portal: { x: 0.32, z: -0.08 },
  };
  const factor = map[quadrant] || { x: 0, z: 0 };
  return {
    x: Math.round((space.center.x + sx * factor.x) * 100) / 100,
    y: Math.round((space.center.y + 4) * 100) / 100,
    z: Math.round((space.center.z + sz * factor.z) * 100) / 100,
  };
}

function reverseFor(space, from) {
  return {
    x: Math.round((space.center.x - (from.x - space.center.x) * 0.65) * 100) / 100,
    y: from.y,
    z: Math.round((space.center.z - (from.z - space.center.z) * 0.65) * 100) / 100,
  };
}

function capture(id, spaceId, kind, cameraPosition, lookAtPosition, extra = {}) {
  return {
    capture_id: id,
    space_id: spaceId,
    kind,
    camera_position: cameraPosition,
    look_at_position: lookAtPosition,
    ...extra,
  };
}

export function buildPlayableSpaceReviewPlan({
  project = "prophunt",
  spaces = [],
  includeDefaults = true,
  reviewMode = "full",
  mode = undefined,
  format = "text",
} = {}) {
  const normalizedReviewMode = normalizeReviewMode(mode || reviewMode);
  const requiredCaptureKinds = normalizedReviewMode === "player_angle"
    ? PLAYER_ANGLE_CAPTURE_KINDS
    : REQUIRED_CAPTURE_KINDS;
  const sourceSpaces = spaces.length
    ? spaces
    : includeDefaults
      ? DEFAULT_SPACES
      : [];
  const normalizedSpaces = sourceSpaces.map(normalizeSpace);
  const captures = [];
  const requiredBySpace = {};

  for (const space of normalizedSpaces) {
    requiredBySpace[space.id] = {
      required_kinds: [...requiredCaptureKinds],
      quadrants: [...space.quadrants],
      ui_states: normalizedReviewMode === "player_angle" ? [] : [...space.ui_states],
      review_mode: normalizedReviewMode,
    };
    if (normalizedReviewMode !== "player_angle") {
      captures.push(capture(
        `${project}_${space.id}_overhead`,
        space.id,
        "overhead",
        { x: space.center.x, y: space.center.y + Math.max(55, space.size.y + 35), z: space.center.z },
        space.center,
      ));
      captures.push(capture(
        `${project}_${space.id}_entry`,
        space.id,
        "entry",
        space.entry,
        space.look_at,
      ));
    }
    for (const quadrant of space.quadrants) {
      const playerView = cameraForQuadrant(space, quadrant);
      captures.push(capture(
        `${project}_${space.id}_${quadrant}_player`,
        space.id,
        "player_height_quadrant",
        playerView,
        space.center,
        { quadrant },
      ));
      if (normalizedReviewMode !== "player_angle") {
        captures.push(capture(
          `${project}_${space.id}_${quadrant}_reverse`,
          space.id,
          "reverse",
          reverseFor(space, playerView),
          playerView,
          { quadrant },
        ));
      }
    }
    if (normalizedReviewMode !== "player_angle") {
      for (const state of space.ui_states) {
        captures.push(capture(
          `${project}_${space.id}_${state}_ui`,
          space.id,
          "ui_state",
          space.entry,
          space.look_at,
          { ui_state: state },
        ));
      }
    }
  }

  return {
    project,
    review_mode: normalizedReviewMode,
    spaces: normalizedSpaces,
    rubric: DEFAULT_RUBRIC,
    captures,
    required_by_space: requiredBySpace,
    report_contract: {
      required_fields: [
        "project",
        "spaces_reviewed",
        "screenshots",
        "findings",
        "fixes",
        "verdict",
      ],
      verdicts: normalizedReviewMode === "player_angle"
        ? ["player_angle_signed_off", "signed_off_with_risks", "not_signed_off"]
        : ["signed_off", "signed_off_with_risks", "not_signed_off"],
      finding_severities: ["info", "minor", "major", "blocker"],
      rule: "Any unresolved major/blocker finding means not_signed_off.",
    },
    next: [
      "Capture screenshots sequentially with StudioMCP screen_capture.",
      "Review each screenshot against the rubric before the next edit.",
      "Fix blockers and recapture the same capture_id or a *_recap capture.",
      "Audit for legacy generated filler such as ImportedDressingVisual, ImportedFoodVisual, VisibleRainVolume, and debug placeholders.",
      "Run roblox_validate_playable_space_review before calling the game visually signed off.",
    ],
    format,
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => slugify(value)).filter(Boolean);
}

function normalizeScreenshot(screenshot) {
  const raw = asObject(screenshot) || {};
  return {
    capture_id: String(raw.capture_id || raw.captureId || raw.id || "").trim(),
    space_id: slugify(raw.space_id || raw.spaceId || raw.space || ""),
    kind: slugify(raw.kind || raw.type || ""),
    quadrant: raw.quadrant ? slugify(raw.quadrant) : null,
    ui_state: raw.ui_state || raw.uiState ? slugify(raw.ui_state || raw.uiState) : null,
    passed: raw.passed !== false,
    recaptured_from: raw.recaptured_from || raw.recapturedFrom || null,
  };
}

function normalizeFinding(finding) {
  const raw = asObject(finding) || {};
  return {
    id: String(raw.id || raw.finding_id || raw.findingId || "").trim(),
    space_id: slugify(raw.space_id || raw.spaceId || raw.space || ""),
    severity: slugify(raw.severity || "major"),
    status: slugify(raw.status || (raw.resolved ? "resolved" : "open")),
    description: String(raw.description || raw.summary || raw.issue || "").trim(),
    screenshot_id: String(raw.screenshot_id || raw.screenshotId || raw.capture_id || raw.captureId || "").trim(),
  };
}

function inferSpacesFromReport(rawReport) {
  const reviewed = normalizeIdList(rawReport.spaces_reviewed || rawReport.spacesReviewed);
  const screenshots = Array.isArray(rawReport.screenshots)
    ? rawReport.screenshots.map(normalizeScreenshot)
    : [];
  const bySpace = new Map();
  for (const id of reviewed) bySpace.set(id, new Set());
  for (const shot of screenshots) {
    if (!shot.space_id) continue;
    if (!bySpace.has(shot.space_id)) bySpace.set(shot.space_id, new Set());
    if (shot.kind === "player_height_quadrant" && shot.quadrant) {
      bySpace.get(shot.space_id).add(shot.quadrant);
    }
  }
  return [...bySpace.entries()].map(([id, quadrants]) => ({
    id,
    name: id.replace(/_/g, " "),
    quadrants: quadrants.size ? [...quadrants] : undefined,
    ui_states: [],
  }));
}

export function buildPlanForReviewReport(report, explicitPlan, {
  project = "prophunt",
  reviewMode,
} = {}) {
  if (explicitPlan) return explicitPlan;
  const rawReport = asObject(report) || {};
  const reportProject = rawReport.project || project;
  const requestedReviewMode = reviewMode || rawReport.review_mode || rawReport.reviewMode || rawReport.mode;
  const explicitSpaces = Array.isArray(rawReport.spaces) ? rawReport.spaces : [];
  const reportSpaces = inferSpacesFromReport(rawReport);
  const shouldInferSpaces = explicitSpaces.length > 0
    || (reportSpaces.length > 0 && (requestedReviewMode || reportProject !== "prophunt"));
  const inferredSpaces = explicitSpaces.length ? explicitSpaces : shouldInferSpaces ? reportSpaces : [];
  return buildPlayableSpaceReviewPlan({
    project: reportProject,
    spaces: inferredSpaces,
    includeDefaults: inferredSpaces.length === 0,
    reviewMode: requestedReviewMode || (slugify(rawReport.verdict) === "player_angle_signed_off" ? "player_angle" : "full"),
  });
}

export function validatePlayableSpaceReview(report, plan) {
  const verdictFindings = createFindings();
  const { errors, warnings } = verdictFindings;
  const rawReport = asObject(report);
  if (!rawReport) {
    return { passed: false, errors: ["report must be a JSON object"], warnings, counts: {} };
  }
  const reviewPlan = buildPlanForReviewReport(rawReport, plan);
  const requiredBySpace = reviewPlan.required_by_space || {};
  const screenshots = Array.isArray(rawReport.screenshots)
    ? rawReport.screenshots.map(normalizeScreenshot)
    : [];
  const findings = Array.isArray(rawReport.findings)
    ? rawReport.findings.map(normalizeFinding)
    : [];
  const spacesReviewed = normalizeIdList(rawReport.spaces_reviewed || rawReport.spacesReviewed);

  if (!Array.isArray(rawReport.screenshots)) errors.push("screenshots array is required");
  if (!Array.isArray(rawReport.findings)) errors.push("findings array is required, even when empty");
  if (!Array.isArray(rawReport.fixes)) errors.push("fixes array is required, even when empty");
  if (!rawReport.verdict) errors.push("verdict is required");

  const screenshotsBySpace = new Map();
  for (const screenshot of screenshots) {
    if (!screenshot.capture_id) errors.push("every screenshot needs capture_id");
    if (!screenshot.space_id) errors.push(`${screenshot.capture_id || "screenshot"} is missing space_id`);
    if (!screenshot.kind) errors.push(`${screenshot.capture_id || "screenshot"} is missing kind`);
    if (!screenshotsBySpace.has(screenshot.space_id)) screenshotsBySpace.set(screenshot.space_id, []);
    screenshotsBySpace.get(screenshot.space_id).push(screenshot);
  }

  for (const [spaceId, required] of Object.entries(requiredBySpace)) {
    if (!spacesReviewed.includes(spaceId)) {
      errors.push(`space '${spaceId}' is not listed in spaces_reviewed`);
    }
    const shots = screenshotsBySpace.get(spaceId) || [];
    for (const kind of required.required_kinds || REQUIRED_CAPTURE_KINDS) {
      if (!shots.some((shot) => shot.kind === kind)) {
        errors.push(`space '${spaceId}' is missing required '${kind}' screenshot`);
      }
    }
    for (const quadrant of required.quadrants || []) {
      if (!shots.some((shot) => shot.kind === "player_height_quadrant" && shot.quadrant === quadrant)) {
        errors.push(`space '${spaceId}' is missing player-height quadrant '${quadrant}'`);
      }
    }
  }

  const screenshotIds = new Set(screenshots.map((shot) => shot.capture_id).filter(Boolean));
  for (const finding of findings) {
    if (!finding.description) warnings.push(`${finding.id || "finding"} has no description`);
    if (finding.screenshot_id && !screenshotIds.has(finding.screenshot_id)) {
      warnings.push(`${finding.id || "finding"} references unknown screenshot '${finding.screenshot_id}'`);
    }
    if (["major", "blocker"].includes(finding.severity) && !["resolved", "accepted_risk"].includes(finding.status)) {
      errors.push(`unresolved ${finding.severity} finding '${finding.id || finding.description}'`);
    }
  }

  const verdict = slugify(rawReport.verdict);
  const allowedVerdicts = Array.isArray(reviewPlan.report_contract?.verdicts)
    ? reviewPlan.report_contract.verdicts
    : ["signed_off", "signed_off_with_risks", "not_signed_off"];
  if (!allowedVerdicts.includes(verdict)) {
    errors.push(`verdict must be ${allowedVerdicts.join(", ")}`);
  }
  if (verdict === "player_angle_signed_off" && reviewPlan.review_mode !== "player_angle") {
    errors.push("player_angle_signed_off requires a player_angle review plan");
  }
  if (["signed_off", "player_angle_signed_off"].includes(verdict) && errors.length) {
    errors.push(`${verdict} verdict is invalid while required evidence/errors are present`);
  }
  if (verdict === "signed_off_with_risks") {
    const unresolvedBlocker = findings.some((finding) => finding.severity === "blocker" && !["resolved", "accepted_risk"].includes(finding.status));
    if (unresolvedBlocker) errors.push("signed_off_with_risks cannot include unresolved blockers");
  }

  return sealVerdict(verdictFindings, {
    fields: { verdict, review_mode: reviewPlan.review_mode || "full" },
    counts: {
      spaces_required: Object.keys(requiredBySpace).length,
      spaces_reviewed: spacesReviewed.length,
      screenshots: screenshots.length,
      findings: findings.length,
    },
  });
}

export function formatPlayableSpaceReviewPlan(plan) {
  const lines = [
    `Playable-space review plan for '${plan.project}'`,
    `mode=${plan.review_mode || "full"}`,
    "",
    "Rubric:",
  ];
  for (const item of plan.rubric) lines.push(`- ${item}`);
  lines.push("", "Capture queue:");
  for (const captureItem of plan.captures) {
    const detail = captureItem.quadrant ? ` quadrant=${captureItem.quadrant}` : captureItem.ui_state ? ` ui=${captureItem.ui_state}` : "";
    lines.push(`- ${captureItem.capture_id}: ${captureItem.kind}${detail} space=${captureItem.space_id}`);
  }
  lines.push("", "Report contract:");
  for (const field of plan.report_contract.required_fields) lines.push(`- required: ${field}`);
  lines.push("", "Next:");
  for (const step of plan.next) lines.push(`- ${step}`);
  return lines.join("\n");
}

export function formatPlayableSpaceReviewValidation(result) {
  const lines = [
    `${passLabel(result.passed)} playable-space review`,
    `mode=${result.review_mode || "full"} spaces=${result.counts.spaces_reviewed || 0}/${result.counts.spaces_required || 0} screenshots=${result.counts.screenshots || 0} findings=${result.counts.findings || 0} verdict=${result.verdict || "unknown"}`,
  ];
  lines.push(...renderFindings(result, { style: "inline" }));
  return lines.join("\n");
}
