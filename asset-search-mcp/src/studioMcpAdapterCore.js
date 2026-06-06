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
