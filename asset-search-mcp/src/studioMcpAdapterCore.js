import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function expectedPlaceMatches(activePlaceName, expectedNames) {
  const active = String(activePlaceName || "").toLowerCase();
  if (!Array.isArray(expectedNames) || expectedNames.length === 0) return true;
  return expectedNames.some((name) => {
    const expected = String(name || "").toLowerCase();
    return expected && active.includes(expected);
  });
}

export function responseText(response) {
  return (response?.content || [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function responseJson(response) {
  const text = responseText(response);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export function toolArgsForStep(step) {
  if (step.arguments && typeof step.arguments === "object" && !Array.isArray(step.arguments)) return step.arguments;
  if (step.tool === "execute_luau") return { code: step.code || "" };
  return {};
}

export async function writeImageContent(response, outputPath) {
  const image = (response?.content || []).find((item) => item.type === "image" && item.data);
  if (!image || !outputPath) return null;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(image.data, "base64"));
  return outputPath;
}

export function preflightPassedFromPayload(payload) {
  return payload.ok === true || payload.passed === true || payload.success === true;
}

export function normalizePreflightPayload(payload, fallback) {
  const passed = preflightPassedFromPayload(payload);
  return {
    passed,
    ok: passed,
    placeName: payload.placeName || payload.place_name || fallback.placeName,
    placeId: payload.placeId || payload.place_id || fallback.placeId,
    expectedPlaceNames: payload.expectedPlaceNames || payload.expected_place_names || fallback.expectedPlaceNames,
    transport: fallback.transport,
    raw: payload.text ? payload.text.slice(0, 1000) : undefined,
  };
}

export async function callStudioTool(client, tool, args) {
  return await client.callTool({ name: tool, arguments: args });
}

export async function connectStudioMcp({
  command,
  args = [],
  clientName = "roblox-studio-batch-adapter",
  clientVersion = "1.0.0",
}) {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: clientName, version: clientVersion });
  await client.connect(transport);
  return client;
}

export async function maybeSelectStudio(client, { studioId, studioName } = {}) {
  if (!studioId && !studioName) return null;
  const listed = await callStudioTool(client, "list_roblox_studios", {});
  const payload = responseJson(listed);
  const studios = Array.isArray(payload) ? payload : Array.isArray(payload.studios) ? payload.studios : [];
  const match = studios.find((studio) => {
    const id = studio.id || studio.studio_id || studio.instanceId;
    const name = studio.name || studio.placeName || studio.place_name;
    return (studioId && String(id) === String(studioId))
      || (studioName && String(name || "").toLowerCase().includes(String(studioName).toLowerCase()));
  });
  if (!match) {
    return { selected: false, studios };
  }
  const id = match.id || match.studio_id || match.instanceId;
  let selected = null;
  try {
    selected = await callStudioTool(client, "set_active_studio", { studio_id: id });
  } catch {
    selected = await callStudioTool(client, "set_active_studio", { id });
  }
  return { selected: true, studio: match, result: responseJson(selected) };
}

// One execution-log entry for a capture step. family_id is included only when the
// capture carries one, so the batch gate and the family sweep keep their exact
// log shapes from a single driver.
function captureLogBase(capture, step) {
  const base = { capture_id: capture.capture_id };
  if (capture.family_id != null) base.family_id = capture.family_id;
  base.tool = step.tool;
  base.purpose = step.purpose;
  return base;
}

// Deep Studio capture driver — the seam every Studio gate adapter sits behind.
// Owns the serial select -> preflight -> capture loop over a connected StudioMCP
// client: studio selection, active-place preflight, per-capture step execution,
// screenshot writes, per-capture pass/fail, live-response collection, and the
// execution log. Adapters supply only the plan and shape their own report from
// the returned run record { preflight, executionLog, captures, failedCaptureIds,
// liveResponses }, where captures is [{ capture, passed, response }].
export async function runStudioCaptureBatch(client, plan, {
  activePlaceName,
  placeId = 0,
  studioId,
  studioName,
  transport = "studio_mcp_stdio",
} = {}) {
  const sourcePlan = asObject(plan);
  const expectedNames = sourcePlan.studio_preflight?.expected_place_names || [];
  const executionLog = [];
  const captures = [];
  const failedCaptureIds = new Set();
  const liveResponses = new Map();

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

  const preflightTool = sourcePlan.studio_preflight?.studio_mcp_tool || "execute_luau";
  let preflightPayload = {};
  try {
    const preflightResponse = await callStudioTool(client, preflightTool, {
      code: sourcePlan.studio_preflight?.code || "",
    });
    preflightPayload = responseJson(preflightResponse);
    executionLog.push({
      sequence: executionLog.length,
      tool: preflightTool,
      purpose: "Active-place preflight.",
      ok: preflightPassedFromPayload(preflightPayload),
      result: preflightPayload,
    });
  } catch (error) {
    preflightPayload = { ok: false, error: error.message };
    executionLog.push({
      sequence: executionLog.length,
      tool: preflightTool,
      purpose: "Active-place preflight.",
      ok: false,
      error: error.message,
    });
  }

  const preflight = normalizePreflightPayload(preflightPayload, {
    placeName: activePlaceName || sourcePlan.target_place || "Unknown",
    placeId,
    expectedPlaceNames: expectedNames,
    transport,
  });

  if (preflight.passed) {
    for (const capture of sourcePlan.capture_batch?.captures || []) {
      let capturePassed = true;
      let captureResponse = null;
      for (const step of capture.studio_mcp_steps || []) {
        try {
          const response = await callStudioTool(client, step.tool, toolArgsForStep(step));
          executionLog.push({
            sequence: executionLog.length,
            ...captureLogBase(capture, step),
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
            ...captureLogBase(capture, step),
            ok: false,
            error: error.message,
          });
        }
      }
      if (!capturePassed) failedCaptureIds.add(capture.capture_id);
      if (captureResponse) liveResponses.set(capture.capture_id, captureResponse);
      captures.push({ capture, passed: capturePassed, response: captureResponse });
    }
  }

  return { preflight, executionLog, captures, failedCaptureIds, liveResponses };
}

// Mock counterpart to runStudioCaptureBatch. Same run record, no live client:
// preflight is decided by expected-place matching and per-capture failure is
// driven by failCaptures. Used by the offline mock transports and tests.
export function runMockStudioCaptureBatch(plan, {
  activePlaceName,
  placeId = 0,
  failCaptures = [],
  transport = "mock",
} = {}) {
  const sourcePlan = asObject(plan);
  const expectedNames = sourcePlan.studio_preflight?.expected_place_names || [];
  const placeName = activePlaceName || sourcePlan.target_place || "MockPlace.rbxl";
  const preflightPassed = expectedPlaceMatches(placeName, expectedNames);
  const failedCaptureIds = new Set(failCaptures);
  const executionLog = [];

  executionLog.push({
    sequence: 0,
    tool: sourcePlan.studio_preflight?.studio_mcp_tool || "execute_luau",
    purpose: "Active-place preflight.",
    ok: preflightPassed,
    result: {
      placeName,
      placeId,
      expectedPlaceNames: expectedNames,
    },
  });

  const captures = [];
  if (preflightPassed) {
    for (const capture of sourcePlan.capture_batch?.captures || []) {
      const failed = failedCaptureIds.has(capture.capture_id);
      for (const step of capture.studio_mcp_steps || []) {
        executionLog.push({
          sequence: executionLog.length,
          ...captureLogBase(capture, step),
          ok: !failed,
          suggested_output_path: step.suggested_output_path || null,
        });
      }
      captures.push({ capture, passed: !failed, response: null });
    }
  }

  const preflight = {
    passed: preflightPassed,
    ok: preflightPassed,
    placeName,
    placeId,
    expectedPlaceNames: expectedNames,
    transport,
  };
  return { preflight, executionLog, captures, failedCaptureIds, liveResponses: new Map() };
}
