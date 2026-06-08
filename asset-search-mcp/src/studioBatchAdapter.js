import {
  asObject,
  connectStudioMcp,
  responseJson,
  runMockStudioCaptureBatch,
  runStudioCaptureBatch,
} from "./studioMcpAdapterCore.js";
import { validateBatchVisualGateReport } from "./visualBatchGate.js";

function signedOffVerdict(plan, passed) {
  if (!passed) return "not_signed_off";
  return plan?.review_mode === "player_angle" ? "player_angle_signed_off" : "signed_off";
}

function mockAltText(capture) {
  const bits = [
    capture.capture_id,
    capture.kind,
    capture.space_id ? `space ${capture.space_id}` : "",
    capture.quadrant ? `quadrant ${capture.quadrant}` : "",
    capture.ui_state ? `UI ${capture.ui_state}` : "",
  ].filter(Boolean);
  return `Mock Studio capture: ${bits.join(", ")}.`;
}

function normalizeCaptureResult(capture, passed) {
  const contract = asObject(capture.result_contract);
  return {
    ...contract,
    capture_id: contract.capture_id || capture.capture_id,
    space_id: contract.space_id || capture.space_id,
    kind: contract.kind || capture.kind,
    quadrant: contract.quadrant ?? capture.quadrant ?? null,
    ui_state: contract.ui_state ?? capture.ui_state ?? null,
    image_path: contract.image_path || capture.expected_image_path,
    passed,
    alt_text: contract.alt_text || mockAltText(capture),
    findings: Array.isArray(contract.findings) ? contract.findings : [],
  };
}

// A null response (mock transport) folds back to the contract default, so live
// and mock captures share one normalizer.
function normalizeLiveScreenshot(capture, response, passed) {
  const payload = responseJson(response);
  const contract = normalizeCaptureResult(capture, passed);
  return {
    ...contract,
    image_path: payload.image_path || payload.imagePath || payload.path || contract.image_path,
    alt_text: payload.alt_text || payload.altText || contract.alt_text,
    passed: payload.passed !== false && passed,
    findings: Array.isArray(payload.findings) ? payload.findings : contract.findings,
  };
}

function screenshotsFromRun(run) {
  return run.captures.map(({ capture, response, passed }) => normalizeLiveScreenshot(capture, response, passed));
}

function buildBatchReport(visualPlan, { preflight, screenshots, transport }) {
  return {
    ...asObject(visualPlan.report_template),
    project: visualPlan.project,
    target_place: visualPlan.target_place,
    active_place: {
      name: preflight.placeName,
      placeId: preflight.placeId,
      transport,
    },
    preflight,
    review_mode: visualPlan.review_mode,
    spaces_reviewed: Object.keys(visualPlan.review_plan?.required_by_space || {}),
    screenshots,
    findings: [],
    fixes: [],
    verdict: signedOffVerdict(visualPlan, preflight.passed && screenshots.every((shot) => shot.passed !== false)),
  };
}

function batchResultEnvelope(visualPlan, transport, report, executionLog, validation) {
  return {
    schema: "roblox-studio-batch-adapter-result/v1",
    adapter: visualPlan.adapter || "studio_mcp_proxy",
    transport,
    artifact_root: visualPlan.artifact_root,
    report,
    execution_log: executionLog,
    validation,
  };
}

export async function executeStudioMcpBatchVisualGate(plan, {
  command = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
  args = [],
  activePlaceName,
  placeId = 0,
  studioId,
  studioName,
} = {}) {
  const visualPlan = asObject(plan);
  const client = await connectStudioMcp({ command, args });
  try {
    const run = await runStudioCaptureBatch(client, visualPlan, {
      activePlaceName,
      placeId,
      studioId,
      studioName,
      transport: "studio_mcp_stdio",
    });
    const report = buildBatchReport(visualPlan, {
      preflight: run.preflight,
      screenshots: screenshotsFromRun(run),
      transport: "studio_mcp_stdio",
    });
    return batchResultEnvelope(
      visualPlan,
      "studio_mcp_stdio",
      report,
      run.executionLog,
      validateBatchVisualGateReport(report, visualPlan),
    );
  } finally {
    await client.close?.();
  }
}

export function executeMockStudioBatchVisualGate(plan, {
  activePlaceName,
  placeId = 0,
  failCaptures = [],
} = {}) {
  const visualPlan = asObject(plan);
  const run = runMockStudioCaptureBatch(visualPlan, { activePlaceName, placeId, failCaptures });
  const report = buildBatchReport(visualPlan, {
    preflight: run.preflight,
    screenshots: screenshotsFromRun(run),
    transport: "mock",
  });
  return batchResultEnvelope(
    visualPlan,
    "mock",
    report,
    run.executionLog,
    validateBatchVisualGateReport(report, visualPlan),
  );
}

export function formatStudioBatchAdapterResult(result) {
  const lines = [
    `${result.validation.passed ? "PASS" : "FAIL"} Studio batch adapter`,
    `transport=${result.transport} captures=${result.report.screenshots.length} artifact_root=${result.artifact_root}`,
  ];
  for (const error of result.validation.errors || []) lines.push(`ERROR: ${error}`);
  for (const warning of result.validation.warnings || []) lines.push(`WARN: ${warning}`);
  return lines.join("\n");
}
