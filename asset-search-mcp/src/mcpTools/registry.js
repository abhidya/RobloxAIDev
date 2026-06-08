import { z } from "zod";

// Shared MCP tool registry — the one seam every tool cluster registers through.
//
// Before, index.js defined the response helpers (text/result/errorText) and the
// annotation presets, then threaded them into each cluster as parameters, and
// each cluster redefined its own `tool()` helper and repeated the same
// format-selector. That made index.js know what every cluster needed and let the
// error/result shapes drift. This module owns the wiring — response envelope,
// annotation presets, format selector, and the registrar factory — so clusters
// import one seam and stay focused on their domain.

// --- response envelope -------------------------------------------------------
export const text = (s) => ({ content: [{ type: "text", text: s }] });
/** Text + machine-readable structuredContent in one result. */
export const result = (obj, s) => ({ content: [{ type: "text", text: s ?? JSON.stringify(obj, null, 2) }], structuredContent: obj });
export const errorText = (s) => ({ isError: true, content: [{ type: "text", text: s }] });

// --- annotation presets (hints, not guarantees) ------------------------------
export const ANNOTATIONS = {
  READ_LOCAL: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  READ_NETWORK: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  WRITE_LOCAL: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  WRITE_DESTRUCTIVE: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};

// The format selector every planner/validator tool repeated: a structured-only
// result in JSON mode, structured + rendered human text otherwise.
export function rendered(out, format, render) {
  return result(out, format === "json" ? undefined : render(out));
}

// Registrar factory for the planner/validator clusters: bind a server and a
// default annotation preset once, then register tools with the same
// (title, description, inputSchema) shape instead of each cluster redefining it.
export function createToolRegistrar(server, annotations = ANNOTATIONS.READ_LOCAL) {
  return (name, title, description, inputSchema, handler) =>
    server.registerTool(name, { title, description, inputSchema, annotations }, handler);
}

// Shared input schemas for the validate_* tools. Reports/manifests stay
// schema-flexible, but an empty object fails fast at the boundary instead of
// producing a confusing downstream validator report. (Was duplicated per cluster.)
export const reportSchema = z.record(z.any()).refine(
  (value) => value && typeof value === "object" && Object.keys(value).length > 0,
  { message: "must be a non-empty object (pass the full report/manifest/receipt, not {})" },
);
export const planSchema = z.record(z.any());
