import {
  asObject,
  callStudioTool,
  connectStudioMcp,
  expectedPlaceMatches,
  maybeSelectStudio,
  normalizePreflightPayload,
  preflightPassedFromPayload,
  responseJson,
  toolArgsForStep,
  writeImageContent,
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

export async function executeStudioMcpBatchVisualGate(plan, {
  command = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
  args = [],
  activePlaceName,
  placeId = 0,
  studioId,
  studioName,
} = {}) {
  const visualPlan = asObject(plan);
  const expectedNames = visualPlan.studio_preflight?.expected_place_names || [];
  const executionLog = [];
  const screenshots = [];
  const client = await connectStudioMcp({ command, args });
  try {
    const selection = await maybeSelectStudio(client, { studioId, studioName });
    if (selection) {
      executionLog.push({
        sequence: executionLog.length,
        tool: "set_active_studio",
        purpose: "Select the requested Studio instance before preflight.",
        ok: selection.selected === true,
        result: selection,
      });
    }

    let preflightPayload = {};
    try {
      const preflightResponse = await callStudioTool(client, visualPlan.studio_preflight?.studio_mcp_tool || "execute_luau", {
        code: visualPlan.studio_preflight?.code || "",
      });
      preflightPayload = responseJson(preflightResponse);
      executionLog.push({
        sequence: executionLog.length,
        tool: visualPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
        purpose: "Active-place preflight.",
        ok: preflightPassedFromPayload(preflightPayload),
        result: preflightPayload,
      });
    } catch (error) {
      preflightPayload = { ok: false, error: error.message };
      executionLog.push({
        sequence: executionLog.length,
        tool: visualPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
        purpose: "Active-place preflight.",
        ok: false,
        error: error.message,
      });
    }

    const preflight = normalizePreflightPayload(preflightPayload, {
      placeName: activePlaceName || visualPlan.target_place || "Unknown",
      placeId,
      expectedPlaceNames: expectedNames,
      transport: "studio_mcp_stdio",
    });

    if (preflight.passed) {
      for (const capture of visualPlan.capture_batch?.captures || []) {
        let capturePassed = true;
        let captureResponse = null;
        for (const step of capture.studio_mcp_steps || []) {
          try {
            const response = await callStudioTool(client, step.tool, toolArgsForStep(step));
            executionLog.push({
              sequence: executionLog.length,
              capture_id: capture.capture_id,
              tool: step.tool,
              purpose: step.purpose,
              ok: true,
              result: responseJson(response),
            });
            if (step.tool === "screen_capture") {
              await writeImageContent(response, capture.expected_image_path);
              captureResponse = response;
            }
          } catch (error) {
            capturePassed = false;
            executionLog.push({
              sequence: executionLog.length,
              capture_id: capture.capture_id,
              tool: step.tool,
              purpose: step.purpose,
              ok: false,
              error: error.message,
            });
          }
        }
        screenshots.push(normalizeLiveScreenshot(capture, captureResponse, capturePassed));
      }
    }

    const report = {
      ...asObject(visualPlan.report_template),
      project: visualPlan.project,
      target_place: visualPlan.target_place,
      active_place: {
        name: preflight.placeName,
        placeId: preflight.placeId,
        transport: "studio_mcp_stdio",
      },
      preflight,
      review_mode: visualPlan.review_mode,
      spaces_reviewed: Object.keys(visualPlan.review_plan?.required_by_space || {}),
      screenshots,
      findings: [],
      fixes: [],
      verdict: signedOffVerdict(visualPlan, preflight.passed && screenshots.every((shot) => shot.passed !== false)),
    };
    const validation = validateBatchVisualGateReport(report, visualPlan);
    return {
      schema: "roblox-studio-batch-adapter-result/v1",
      adapter: visualPlan.adapter || "studio_mcp_proxy",
      transport: "studio_mcp_stdio",
      artifact_root: visualPlan.artifact_root,
      report,
      execution_log: executionLog,
      validation,
    };
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
  const expectedNames = visualPlan.studio_preflight?.expected_place_names || [];
  const placeName = activePlaceName || visualPlan.target_place || "MockPlace.rbxl";
  const preflightPassed = expectedPlaceMatches(placeName, expectedNames);
  const failedCaptureIds = new Set(failCaptures);
  const captures = visualPlan.capture_batch?.captures || [];
  const executionLog = [];

  executionLog.push({
    sequence: 0,
    tool: visualPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
    purpose: "Active-place preflight.",
    ok: preflightPassed,
    result: {
      placeName,
      placeId,
      expectedPlaceNames: expectedNames,
    },
  });

  const screenshots = [];
  if (preflightPassed) {
    for (const capture of captures) {
      const failed = failedCaptureIds.has(capture.capture_id);
      for (const step of capture.studio_mcp_steps || []) {
        executionLog.push({
          sequence: executionLog.length,
          capture_id: capture.capture_id,
          tool: step.tool,
          purpose: step.purpose,
          ok: !failed,
          suggested_output_path: step.suggested_output_path || null,
        });
      }
      screenshots.push(normalizeCaptureResult(capture, !failed));
    }
  }

  const report = {
    ...asObject(visualPlan.report_template),
    project: visualPlan.project,
    target_place: visualPlan.target_place,
    active_place: {
      name: placeName,
      placeId,
      transport: "mock",
    },
    preflight: {
      passed: preflightPassed,
      ok: preflightPassed,
      placeName,
      placeId,
      expectedPlaceNames: expectedNames,
      transport: "mock",
    },
    review_mode: visualPlan.review_mode,
    spaces_reviewed: Object.keys(visualPlan.review_plan?.required_by_space || {}),
    screenshots,
    findings: [],
    fixes: [],
    verdict: signedOffVerdict(visualPlan, preflightPassed && failedCaptureIds.size === 0),
  };
  const validation = validateBatchVisualGateReport(report, visualPlan);

  return {
    schema: "roblox-studio-batch-adapter-result/v1",
    adapter: visualPlan.adapter || "studio_mcp_proxy",
    transport: "mock",
    artifact_root: visualPlan.artifact_root,
    report,
    execution_log: executionLog,
    validation,
  };
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
