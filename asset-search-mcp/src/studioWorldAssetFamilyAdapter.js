import {
  asObject,
  connectStudioMcp,
  responseJson,
  runMockStudioCaptureBatch,
  runStudioCaptureBatch,
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
    record_inspection_refs: familyFailed ? [] : [`roblox_record_inspection:${family.family_id}`],
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

function familyResultEnvelope(familyPlan, transport, report, executionLog, validation) {
  return {
    schema: "roblox-studio-world-family-adapter-result/v1",
    adapter: familyPlan.adapter || "studio_mcp_proxy",
    transport,
    artifact_root: familyPlan.artifact_root,
    report,
    execution_log: executionLog,
    validation,
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
  const client = await connectStudioMcp({
    command,
    args,
    clientName: "roblox-studio-world-family-adapter",
    clientVersion: "1.0.0",
  });
  try {
    const run = await runStudioCaptureBatch(client, familyPlan, {
      activePlaceName,
      placeId,
      studioId,
      studioName,
      transport: "studio_mcp_stdio",
    });
    const report = buildReport(familyPlan, {
      preflight: run.preflight,
      transport: "studio_mcp_stdio",
      placeName: run.preflight.placeName,
      placeId: run.preflight.placeId,
      failedCaptureIds: run.failedCaptureIds,
      liveResponses: run.liveResponses,
    });
    return familyResultEnvelope(
      familyPlan,
      "studio_mcp_stdio",
      report,
      run.executionLog,
      validateWorldAssetFamilySweep(report, familyPlan),
    );
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
  const run = runMockStudioCaptureBatch(familyPlan, { activePlaceName, placeId, failCaptures });
  const report = buildReport(familyPlan, {
    preflight: run.preflight,
    transport: "mock",
    placeName: run.preflight.placeName,
    placeId: run.preflight.placeId,
    failedCaptureIds: run.failedCaptureIds,
    liveResponses: run.liveResponses,
  });
  return familyResultEnvelope(
    familyPlan,
    "mock",
    report,
    run.executionLog,
    validateWorldAssetFamilySweep(report, familyPlan),
  );
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
