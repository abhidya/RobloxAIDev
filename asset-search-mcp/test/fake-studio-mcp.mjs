#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axm8uoAAAAASUVORK5CYII=";
const placeName = process.env.FAKE_STUDIO_PLACE_NAME || "GroanTubeHero.rbxl";
const placeId = Number(process.env.FAKE_STUDIO_PLACE_ID || 123);

const server = new McpServer({ name: "fake-roblox-studio", version: "1.0.0" });
const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

server.tool(
  "list_roblox_studios",
  "List fake Studio instances.",
  {},
  async () => text({ studios: [{ id: "fake-studio-1", name: placeName, active: true }] })
);

server.tool(
  "set_active_studio",
  "Set fake active Studio instance.",
  { studio_id: z.string().optional(), id: z.string().optional() },
  async (args) => text({ ok: true, studio_id: args.studio_id || args.id || "fake-studio-1" })
);

server.tool(
  "execute_luau",
  "Execute fake Luau.",
  { code: z.string().optional() },
  async (args) => {
    const code = args.code || "";
    if (code.includes("expectedPlaceNames") || code.includes("placeName")) {
      return text({
        ok: true,
        placeName,
        placeId,
        expectedPlaceNames: [placeName, placeName.replace(/\.rbxlx?$/i, "")],
        workspaceChildren: 8,
        hasCurrentCamera: true,
      });
    }
    const match = code.match(/capture_id\s*=\s*["']([^"']+)["']/);
    return text({ ok: true, capture_id: match?.[1] || "camera_set" });
  }
);

server.tool(
  "screen_capture",
  "Return a tiny fake screenshot.",
  {},
  async () => ({
    content: [
      {
        type: "image",
        data: tinyPng,
        mimeType: "image/png",
      },
    ],
  })
);

await server.connect(new StdioServerTransport());
