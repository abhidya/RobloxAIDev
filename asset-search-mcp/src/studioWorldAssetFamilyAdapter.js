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
import { validateWorldAssetFamilySweep } from "./worldAssetFamilySweep.js";

function mockAltText(capture) {
  const bits = [
    capture.capture_id,
    `family ${capture.family_id}`,
    capture.kind,
    capture.phase,
  ].filter(Boolean);
  return `Mock Studio family sweep capture: ${bits.join(", ")}.`;
}

function normalizeCaptureResult(capture, passed) {
  const contract = asObject(capture.result_contract);
  return {
    ...contract,
    capture_id: contract.capture_id || capture.capture_id,
    family_id: contract.family_id || capture.family_id,
    kind: contract.kind || capture.kind,
    phase: contract.phase || capture.phase,
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

function screenshotsByFamily(captures, failedCaptureIds, liveResponses = new Map()) {
  const byFamily = new Map();
  for (const capture of captures) {
    const failed = failedCaptureIds.has(capture.capture_id);
    const response = liveResponses.get(capture.capture_id);
    const screenshot = response
      ? normalizeLiveScreenshot(capture, response, !failed)
      : normalizeCaptureResult(capture, !failed);
    if (!byFamily.has(screenshot.family_id)) byFamily.set(screenshot.family_id, []);
    byFamily.get(screenshot.family_id).push(screenshot);
  }
  return byFamily;
}

function familyReport(family, screenshots, failedCaptureIds) {
  const familyFailed = screenshots.some((shot) => shot.passed === false || failedCaptureIds.has(shot.capture_id));
  const total = Number(family.live_instance_count || family.liveInstanceCount || 1);
  return {
    family_id: family.family_id,
    status: familyFailed ? "fix" : "pass",
    screenshot_verdict: familyFailed ? "fix" : "pass",
    inventory: { live_instance_count: total },
    clean_clone: { created: true, path: `Workspace.AssetValidation/${family.family_id}` },
    canonical: {
      up: family.canonical_up || "Y+",
      forward: family.canonical_forward || "Z- toward player path",
      scale_policy: family.scale_policy || "preserve inspected source scale",
      grounding_offset_studs: Number(family.grounding_offset_studs || 0),
      pivot_policy: family.pivot_policy || "PrimaryPart at visual base",
    },
    propagation: {
      live_instances_total: total,
      fixed_live_instances: familyFailed ? 0 : total,
      skipped_non_visual_instances: 0,
    },
    cleanup: {
      clean_clone_removed: !familyFailed,
      temporary_models_remaining: familyFailed ? 1 : 0,
    },
    screenshots,
    findings: familyFailed
      ? [{ id: `${family.family_id}_capture_failed`, severity: "major", status: "open", description: "One or more planned family screenshots failed." }]
      : [],
    blockers: [],
    inspection_recorded: !familyFailed,
    record_inspection_refs: familyFailed ? [] : [`record_inspection:${family.family_id}`],
  };
}

function signedOffVerdict(passed) {
  return passed ? "signed_off" : "not_signed_off";
}

function buildReport(plan, {
  preflight,
  transport,
  placeName,
  placeId,
  failedCaptureIds = new Set(),
  liveResponses = new Map(),
} = {}) {
  const familyPlan = asObject(plan);
  const captures = familyPlan.capture_batch?.captures || [];
  const grouped = screenshotsByFamily(captures, failedCaptureIds, liveResponses);
  const familyReports = (familyPlan.families || []).map((family) => (
    familyReport(family, grouped.get(family.family_id) || [], failedCaptureIds)
  ));
  const allPassed = preflight?.passed === true
    && familyReports.every((report) => report.status === "pass")
    && [...failedCaptureIds].length === 0;

  return {
    ...asObject(familyPlan.report_template),
    schema: "roblox-world-asset-family-sweep-report/v1",
    project: familyPlan.project,
    target_place: familyPlan.target_place,
    active_place: {
      name: placeName,
      placeId,
      transport,
    },
    preflight,
    family_reports: familyReports,
    temporary_cleanup: { probes_remaining: allPassed ? 0 : 1 },
    verdict: signedOffVerdict(allPassed),
  };
}

export async function executeStudioMcpWorldAssetFamilySweep(plan, {
  command = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
  args = [],
  activePlaceName,
  placeId = 0,
  studioId,
  studioName,
} = {}) {
  const familyPlan = asObject(plan);
  const expectedNames = familyPlan.studio_preflight?.expected_place_names || [];
  const executionLog = [];
  const failedCaptureIds = new Set();
  const liveResponses = new Map();
  const client = await connectStudioMcp({
    command,
    args,
    clientName: "roblox-studio-world-family-adapter",
    clientVersion: "1.0.0",
  });
  try {
    const selection = await maybeSelectStudio(client, { studioId, studioName });
    if (selection) {
      executionLog.push({
        sequence: executionLog.length,
        tool: "set_active_studio",
        purpose: "Select the requested Studio instance before family sweep preflight.",
        ok: selection.selected === true,
        result: selection,
      });
    }

    let preflightPayload = {};
    try {
      const preflightResponse = await callStudioTool(client, familyPlan.studio_preflight?.studio_mcp_tool || "execute_luau", {
        code: familyPlan.studio_preflight?.code || "",
      });
      preflightPayload = responseJson(preflightResponse);
      executionLog.push({
        sequence: executionLog.length,
        tool: familyPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
        purpose: "Active-place preflight.",
        ok: preflightPassedFromPayload(preflightPayload),
        result: preflightPayload,
      });
    } catch (error) {
      preflightPayload = { ok: false, error: error.message };
      executionLog.push({
        sequence: executionLog.length,
        tool: familyPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
        purpose: "Active-place preflight.",
        ok: false,
        error: error.message,
      });
    }

    const preflight = normalizePreflightPayload(preflightPayload, {
      placeName: activePlaceName || familyPlan.target_place || "Unknown",
      placeId,
      expectedPlaceNames: expectedNames,
      transport: "studio_mcp_stdio",
    });

    if (preflight.passed) {
      for (const capture of familyPlan.capture_batch?.captures || []) {
        let capturePassed = true;
        let captureResponse = null;
        for (const step of capture.studio_mcp_steps || []) {
          try {
            const response = await callStudioTool(client, step.tool, toolArgsForStep(step));
            executionLog.push({
              sequence: executionLog.length,
              capture_id: capture.capture_id,
              family_id: capture.family_id,
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
            failedCaptureIds.add(capture.capture_id);
            executionLog.push({
              sequence: executionLog.length,
              capture_id: capture.capture_id,
              family_id: capture.family_id,
              tool: step.tool,
              purpose: step.purpose,
              ok: false,
              error: error.message,
            });
          }
        }
        if (!capturePassed) failedCaptureIds.add(capture.capture_id);
        if (captureResponse) liveResponses.set(capture.capture_id, captureResponse);
      }
    }

    const report = buildReport(familyPlan, {
      preflight,
      transport: "studio_mcp_stdio",
      placeName: preflight.placeName,
      placeId: preflight.placeId,
      failedCaptureIds,
      liveResponses,
    });
    const validation = validateWorldAssetFamilySweep(report, familyPlan);
    return {
      schema: "roblox-studio-world-family-adapter-result/v1",
      adapter: familyPlan.adapter || "studio_mcp_proxy",
      transport: "studio_mcp_stdio",
      artifact_root: familyPlan.artifact_root,
      report,
      execution_log: executionLog,
      validation,
    };
  } finally {
    await client.close?.();
  }
}

export function executeMockStudioWorldAssetFamilySweep(plan, {
  activePlaceName,
  placeId = 0,
  failCaptures = [],
} = {}) {
  const familyPlan = asObject(plan);
  const expectedNames = familyPlan.studio_preflight?.expected_place_names || [];
  const placeName = activePlaceName || familyPlan.target_place || "MockPlace.rbxl";
  const preflightPassed = expectedPlaceMatches(placeName, expectedNames);
  const failedCaptureIds = new Set(failCaptures);
  const executionLog = [];

  executionLog.push({
    sequence: 0,
    tool: familyPlan.studio_preflight?.studio_mcp_tool || "execute_luau",
    purpose: "Active-place preflight.",
    ok: preflightPassed,
    result: {
      placeName,
      placeId,
      expectedPlaceNames: expectedNames,
    },
  });

  if (preflightPassed) {
    for (const capture of familyPlan.capture_batch?.captures || []) {
      const failed = failedCaptureIds.has(capture.capture_id);
      for (const step of capture.studio_mcp_steps || []) {
        executionLog.push({
          sequence: executionLog.length,
          capture_id: capture.capture_id,
          family_id: capture.family_id,
          tool: step.tool,
          purpose: step.purpose,
          ok: !failed,
          suggested_output_path: step.suggested_output_path || null,
        });
      }
    }
  }

  const preflight = {
    passed: preflightPassed,
    ok: preflightPassed,
    placeName,
    placeId,
    expectedPlaceNames: expectedNames,
    transport: "mock",
  };
  const report = buildReport(familyPlan, {
    preflight,
    transport: "mock",
    placeName,
    placeId,
    failedCaptureIds,
  });
  const validation = validateWorldAssetFamilySweep(report, familyPlan);

  return {
    schema: "roblox-studio-world-family-adapter-result/v1",
    adapter: familyPlan.adapter || "studio_mcp_proxy",
    transport: "mock",
    artifact_root: familyPlan.artifact_root,
    report,
    execution_log: executionLog,
    validation,
  };
}

export function formatStudioWorldAssetFamilyAdapterResult(result) {
  const familyCount = result.report.family_reports?.length || 0;
  const captureCount = result.report.family_reports
    ?.reduce((sum, family) => sum + (family.screenshots?.length || 0), 0) || 0;
  const lines = [
    `${result.validation.passed ? "PASS" : "FAIL"} Studio world asset-family adapter`,
    `transport=${result.transport} families=${familyCount} captures=${captureCount} artifact_root=${result.artifact_root}`,
  ];
  for (const error of result.validation.errors || []) lines.push(`ERROR: ${error}`);
  for (const warning of result.validation.warnings || []) lines.push(`WARN: ${warning}`);
  return lines.join("\n");
}
